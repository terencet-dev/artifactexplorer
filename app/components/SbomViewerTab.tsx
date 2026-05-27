'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Referrer, Registry, SbomPackage } from '@/app/types/registry';
import { formatSize } from '@/app/utils/format';
import { getCredential } from '@/app/utils/credentialStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortColumn = keyof SbomPackage;
type SortDir = 'asc' | 'desc';
type ViewState = 'loading' | 'success' | 'partial' | 'error';

interface SbomViewerTabProps {
  referrer: Referrer;
  activeRegistry: Registry;
  repositoryName: string;
}

const PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SbomViewerTab({
  referrer,
  activeRegistry,
  repositoryName,
}: SbomViewerTabProps) {
  // Data state
  const [packages, setPackages] = useState<SbomPackage[]>([]);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [format, setFormat] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [partialReason, setPartialReason] = useState('');
  const [sbomSize, setSbomSize] = useState<number>(0);

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [streamProgress, setStreamProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // -------------------------------------------------------------------------
  // Fetch & stream SBOM data
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!referrer?.digest || !activeRegistry) return;

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      setViewState('loading');
      setPackages([]);
      setStreamProgress(0);
      setErrorMessage('');

      try {
        // 1. Resolve credentials
        let credentials: { username?: string; password?: string } | undefined;
        if (activeRegistry.type === 'authenticated' && typeof window !== 'undefined') {
          const creds = getCredential(activeRegistry);
          if (creds?.username && creds?.password) {
            credentials = { username: creds.username, password: creds.password };
          }
        }

        // 2. Parse the SBOM via the self-contained parse route
        //    (route handles manifest fetch + blob fetch internally)
        const parseBody = {
          registry: activeRegistry.server,
          registryId: activeRegistry.id || activeRegistry.server,
          repositoryName,
          artifactDigest: referrer.digest,
          artifactType: referrer.artifactType,
          credentials,
        };

        const res = await fetch('/api/registry/blob/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parseBody),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          // Try to read the error message from the NDJSON response
          let errMsg = `Parse request failed: ${res.status}`;
          try {
            const errText = await res.text();
            const errJson = JSON.parse(errText.trim());
            if (errJson.reason) errMsg = errJson.reason;
          } catch { /* ignore */ }
          setViewState('error');
          setErrorMessage(errMsg);
          return;
        }

        // 3. Read the NDJSON stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const accumulatedPackages: SbomPackage[] = [];
        let finalStateSet = false; // track if partial/error already set

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // keep the incomplete last line

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);

              if (parsed.meta) {
                setFormat(parsed.format || '');
                setDocumentName(parsed.documentName || '');
                if (parsed.layerSize) setSbomSize(parsed.layerSize);
                continue;
              }

              if (parsed.partial) {
                setPartialReason(parsed.reason || 'timeout');
                setViewState('partial');
                finalStateSet = true;
                continue;
              }

              if (parsed.error) {
                setViewState('error');
                setErrorMessage(parsed.reason || 'Unknown parse error');
                finalStateSet = true;
                continue;
              }

              // It's a package line
              accumulatedPackages.push(parsed as SbomPackage);

              // Update state periodically (every 500 packages) to show progress
              if (accumulatedPackages.length % 500 === 0) {
                setPackages([...accumulatedPackages]);
                setStreamProgress(accumulatedPackages.length);
              }
            } catch {
              // skip malformed lines
            }
          }
        }

        // Process remaining buffer
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.partial) {
              setPartialReason(parsed.reason || 'timeout');
              setViewState('partial');
              finalStateSet = true;
            } else if (parsed.error) {
              setViewState('error');
              setErrorMessage(parsed.reason || 'Unknown parse error');
              finalStateSet = true;
            } else if (!parsed.meta) {
              accumulatedPackages.push(parsed as SbomPackage);
            }
          } catch {
            // ignore
          }
        }

        // Final state update
        setPackages([...accumulatedPackages]);
        setStreamProgress(accumulatedPackages.length);

        // Use the local flag instead of React state (avoids stale closure)
        if (!finalStateSet) {
          setViewState(accumulatedPackages.length > 0 ? 'success' : 'error');
          if (accumulatedPackages.length === 0) {
            setErrorMessage('No packages found in this SBOM');
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setViewState('error');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load SBOM');
      }
    })();

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referrer?.digest, activeRegistry?.server, repositoryName]);

  // -------------------------------------------------------------------------
  // Download handler
  // -------------------------------------------------------------------------

  const handleDownload = useCallback(async () => {
    if (!activeRegistry) return;
    setDownloading(true);

    try {
      let credentials: { username?: string; password?: string } | undefined;
      if (activeRegistry.type === 'authenticated' && typeof window !== 'undefined') {
        const creds = getCredential(activeRegistry);
        if (creds?.username && creds?.password) {
          credentials = { username: creds.username, password: creds.password };
        }
      }

      const isCycloneDx =
        referrer.artifactType?.includes('cyclonedx') ?? false;
      const ext = isCycloneDx ? '.cdx.json' : '.spdx.json';
      const filename = `${repositoryName.replace(/\//g, '-')}-${referrer.digest.slice(0, 16)}${ext}`;

      const res = await fetch('/api/registry/blob/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registry: activeRegistry.server,
          registryId: activeRegistry.id || activeRegistry.server,
          repositoryName,
          artifactDigest: referrer.digest,
          filename,
          credentials,
        }),
      });

      if (!res.ok) {
        throw new Error(`Download failed: ${res.status}`);
      }

      // Stream the response into a blob and download
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      alert('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  }, [activeRegistry, repositoryName, referrer]);

  // -------------------------------------------------------------------------
  // Filtering, sorting, pagination
  // -------------------------------------------------------------------------

  const filteredPackages = useMemo(() => {
    if (!searchQuery.trim()) return packages;
    const q = searchQuery.toLowerCase();
    return packages.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.version.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q) ||
        p.namespace.toLowerCase().includes(q) ||
        p.license.toLowerCase().includes(q) ||
        p.publisher.toLowerCase().includes(q) ||
        p.purl.toLowerCase().includes(q)
    );
  }, [packages, searchQuery]);

  const sortedPackages = useMemo(() => {
    const sorted = [...filteredPackages];
    sorted.sort((a, b) => {
      const aVal = (a[sortColumn] || '').toLowerCase();
      const bVal = (b[sortColumn] || '').toLowerCase();
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredPackages, sortColumn, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedPackages.length / PAGE_SIZE));
  const pagedPackages = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedPackages.slice(start, start + PAGE_SIZE);
  }, [sortedPackages, currentPage]);

  // Reset page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const handleSort = useCallback(
    (col: SortColumn) => {
      if (sortColumn === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortColumn(col);
        setSortDir('asc');
      }
    },
    [sortColumn]
  );

  const sortIcon = (col: SortColumn) => {
    if (sortColumn !== col) return '↕';
    return sortDir === 'asc' ? '↑' : '↓';
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Loading state
  if (viewState === 'loading' && packages.length === 0) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 dark:border-blue-400" />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Loading SBOM...{streamProgress > 0 && ` ${streamProgress.toLocaleString()} packages parsed`}
          </span>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-3/4" />
          <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-full" />
          <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-5/6" />
          <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-2/3" />
        </div>
      </div>
    );
  }

  // Error state (no packages at all)
  if (viewState === 'error' && packages.length === 0) {
    return (
      <div className="p-4 space-y-4">
        <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-md">
          <p className="mb-3">Error: {errorMessage}</p>
          <p className="text-sm mb-3">You can still download the raw SBOM file below.</p>
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
        >
          <DownloadIcon />
          {downloading ? 'Downloading...' : `Download SBOM${sbomSize > 0 ? ` (${formatSize(sbomSize)})` : ''}`}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Stats header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {format && (
            <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
              {format.toUpperCase()}
            </span>
          )}
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {packages.length.toLocaleString()} packages
          </span>
          {sbomSize > 0 && (
            <span className="text-sm text-gray-500 dark:text-gray-500">
              · {formatSize(sbomSize)}
            </span>
          )}
          {documentName && (
            <span className="text-sm text-gray-500 dark:text-gray-500 truncate max-w-xs" title={documentName}>
              · {documentName}
            </span>
          )}
        </div>

        {/* Partial result banner */}
        {viewState === 'partial' && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md text-sm text-yellow-800 dark:text-yellow-300">
            <p className="font-medium">Partial Results</p>
            <p>
              Showing {packages.length.toLocaleString()} packages — the SBOM was too large to fully
              parse within the server time limit. Download the full SBOM below.
              Upgrading your hosting plan increases parsing capacity.
            </p>
          </div>
        )}

        {/* Search + Download row */}
        <div className="flex items-center gap-3">
          <Input
            type="text"
            placeholder="Search packages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 placeholder:text-gray-500 dark:placeholder:text-gray-400 text-gray-900 dark:text-gray-100"
            aria-label="Search in SBOM packages"
          />
          <button
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors whitespace-nowrap flex-shrink-0"
              title="Download raw SBOM file"
            >
              <DownloadIcon />
              {downloading ? 'Downloading...' : 'Download'}
            </button>
        </div>

        {/* Result count */}
        {searchQuery.trim() && (
          <p className="text-xs text-gray-500 dark:text-gray-500">
            {filteredPackages.length.toLocaleString()} of {packages.length.toLocaleString()} packages match
          </p>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm table-fixed">
          <thead className="sticky top-0 bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700">
            <tr>
              {(['name', 'namespace', 'version', 'publisher', 'purl', 'license'] as SortColumn[]).map(
                (col) => {
                  const labels: Record<string, string> = {
                    name: 'Name', namespace: 'Namespace', version: 'Version',
                    publisher: 'Publisher', purl: 'PURL', license: 'License',
                  };
                  const widths: Record<string, string> = {
                    name: 'w-[22%]', namespace: 'w-[18%]', version: 'w-[12%]',
                    publisher: 'w-[14%]', purl: 'w-[22%]', license: 'w-[12%]',
                  };
                  return (
                    <th
                      key={col}
                      className={`${col === 'name' ? 'pl-4 pr-2' : 'px-2'} py-2 text-left font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-200 select-none whitespace-nowrap ${widths[col]}`}
                      onClick={() => handleSort(col)}
                    >
                      {labels[col]}{' '}
                      <span className="text-xs opacity-60">{sortIcon(col)}</span>
                    </th>
                  );
                }
              )}
            </tr>
          </thead>
          <tbody>
            {pagedPackages.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-8 text-center text-gray-500 dark:text-gray-500">
                  {searchQuery.trim() ? 'No packages match your search' : 'No packages found'}
                </td>
              </tr>
            ) : (
              pagedPackages.map((pkg, idx) => (
                <tr
                  key={`${pkg.name}-${pkg.version}-${idx}`}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-slate-800/50"
                >
                  <td className="pl-4 pr-2 py-1.5 font-mono text-sm text-gray-900 dark:text-gray-200 break-words">
                    {pkg.name}
                  </td>
                  <td className="px-2 py-1.5 text-sm text-gray-600 dark:text-gray-400 break-words">
                    {pkg.namespace || <span className="text-gray-400 dark:text-gray-600">—</span>}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-sm text-gray-700 dark:text-gray-300 break-words">
                    {pkg.version || <span className="text-gray-400 dark:text-gray-600">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-sm text-gray-600 dark:text-gray-400 break-words">
                    {pkg.publisher || <span className="text-gray-400 dark:text-gray-600">—</span>}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs text-gray-500 dark:text-gray-500 break-all">
                    {pkg.purl || <span className="text-gray-400 dark:text-gray-600">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-sm text-gray-600 dark:text-gray-400 break-words">
                    {pkg.license && pkg.license !== 'NOASSERTION'
                      ? pkg.license
                      : <span className="text-gray-400 dark:text-gray-600">—</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <span className="text-xs text-gray-500 dark:text-gray-500">
            Page {currentPage} of {totalPages.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30 text-gray-600 dark:text-gray-400"
            >
              First
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30 text-gray-600 dark:text-gray-400"
            >
              Prev
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30 text-gray-600 dark:text-gray-400"
            >
              Next
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30 text-gray-600 dark:text-gray-400"
            >
              Last
            </button>
          </div>
        </div>
      )}

      {/* Streaming progress indicator while loading more */}
      {viewState === 'loading' && packages.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 dark:border-blue-400" />
          <span className="text-xs text-blue-700 dark:text-blue-300">
            Streaming... {streamProgress.toLocaleString()} packages parsed so far
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function DownloadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
