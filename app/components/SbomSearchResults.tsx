'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import type { SbomSearchMatch } from '@/app/utils/sbomIndexDb';
import ExportModal, { type ExportOptions, type ExportField } from './ExportModal';
import { csvEscape, buildCsv, downloadCsv } from '@/app/utils/csvUtils';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SearchStats {
  estimatedTotal: number;
  repoCount: number;
  tagCount: number;
  isEstimate: boolean;
}

interface SbomSearchResultsProps {
  matches: SbomSearchMatch[];
  searchQuery: string;
  isSearching?: boolean;
  hasSearched?: boolean;
  /** Server-side total count (when using Postgres pagination) */
  total?: number;
  /** Server-side search stats (estimated total, unique repos/tags on page) */
  stats?: SearchStats;
  /** Page size for server-side pagination */
  pageSize?: number;
  /** Current offset for server-side pagination */
  offset?: number;
  /** Callback when page changes (server-side pagination) */
  onPageChange?: (offset: number) => void;
  /** Callback when sort changes (server-side sorting) */
  onSortChange?: (sort: string, order: 'asc' | 'desc') => void;
  /** Current server-side sort field */
  serverSort?: string;
  /** Current server-side sort direction */
  serverOrder?: 'asc' | 'desc';
  /** Parameters needed for multi-page server-side export */
  exportFetchParams?: {
    q: string;
    field: string;
    registryId: string;
    repo?: string;
    tag?: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

type SortKey =
  | 'name'
  | 'namespace'
  | 'version'
  | 'publisher'
  | 'purl'
  | 'license'
  | 'repo'
  | 'tag';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SbomSearchResults({
  matches,
  searchQuery,
  isSearching,
  hasSearched,
  total,
  stats,
  pageSize = PAGE_SIZE,
  offset = 0,
  onPageChange,
  onSortChange,
  serverSort,
  serverOrder,
  exportFetchParams,
}: SbomSearchResultsProps) {
  const useServerPagination = total !== undefined && onPageChange !== undefined;
  const useServerSort = !!onSortChange;
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [showExportModal, setShowExportModal] = useState(false);

  const handleSort = (key: SortKey) => {
    if (useServerSort) {
      const newOrder = serverSort === key ? (serverOrder === 'asc' ? 'desc' : 'asc') : 'desc';
      onSortChange(key, newOrder);
    } else {
      if (sortKey === key) setSortAsc(!sortAsc);
      else { setSortKey(key); setSortAsc(false); }
    }
  };

  const activeSortKey = useServerSort ? (serverSort as SortKey) ?? 'name' : sortKey;
  const activeSortAsc = useServerSort ? serverOrder !== 'desc' : sortAsc;

  // Deduplicate and compute summary stats
  const { sorted, repoCount, tagCount } = useMemo(() => {
    const seen = new Set<string>();
    const deduped: SbomSearchMatch[] = [];
    for (const m of matches) {
      const key = `${m.package.purl || m.package.name}|${m.repo}|${m.tag}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(m);
      }
    }

    const repos = new Set(deduped.map((m) => m.repo));
    const tags = new Set(deduped.map((m) => `${m.repo}:${m.tag}`));

    // If server-side sort is active, don't re-sort client-side
    if (useServerSort) {
      return { sorted: deduped, repoCount: repos.size, tagCount: tags.size };
    }

    const sorted = [...deduped].sort((a, b) => {
      let av: string, bv: string;
      if (sortKey === 'repo') {
        av = a.repo;
        bv = b.repo;
      } else if (sortKey === 'tag') {
        av = a.tag;
        bv = b.tag;
      } else {
        av = (a.package as unknown as Record<string, string>)[sortKey] ?? '';
        bv = (b.package as unknown as Record<string, string>)[sortKey] ?? '';
      }
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    return { sorted, repoCount: repos.size, tagCount: tags.size };
  }, [matches, sortKey, sortAsc, useServerSort]);

  const displayCount = useServerPagination ? total : sorted.length;
  const currentPage = useServerPagination
    ? Math.floor(offset / pageSize) + 1
    : page;

  // Use real total from server aggregate, fallback to total
  const effectiveTotal = useServerPagination
    ? (total && total > 0 ? total : (stats?.estimatedTotal && stats.estimatedTotal > 0 ? stats.estimatedTotal : sorted.length))
    : sorted.length;
  const totalPages = Math.max(1, useServerPagination
    ? Math.ceil(effectiveTotal / pageSize)
    : Math.ceil(sorted.length / PAGE_SIZE));
  const paged = useServerPagination
    ? sorted // Server already paginated
    : sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page when results change
  React.useEffect(() => {
    setPage(1);
  }, [matches.length, sortKey, sortAsc]);

  // --- SBOM field definitions for export ---
  const sbomExportFields: ExportField[] = useMemo(() => [
    { key: 'name', label: 'Package Name' },
    { key: 'namespace', label: 'Namespace' },
    { key: 'version', label: 'Version' },
    { key: 'publisher', label: 'Publisher' },
    { key: 'purl', label: 'PURL' },
    { key: 'license', label: 'License' },
    { key: 'repo', label: 'Repository' },
    { key: 'tag', label: 'Tag' },
    { key: 'registry', label: 'Registry' },
  ], []);

  const matchToRow = useCallback((m: SbomSearchMatch, fields: string[]): string[] => {
    const all: Record<string, string> = {
      name: m.package.name, namespace: m.package.namespace, version: m.package.version,
      publisher: m.package.publisher, purl: m.package.purl, license: m.package.license,
      repo: m.repo, tag: m.tag, registry: m.registryServer,
    };
    return fields.map(k => all[k] ?? '');
  }, []);

  const handleExport = useCallback(async (options: ExportOptions, onProgress: (pct: number) => void) => {
    const { scope, rangeStart, rangeEnd, selectedFields } = options;
    const fieldLabels = sbomExportFields.filter(f => selectedFields.includes(f.key)).map(f => f.label);
    const filename = `sbom-search-results-${new Date().toISOString().slice(0, 10)}.csv`;

    if (scope === 'current' || !useServerPagination) {
      // Export from in-memory data
      let data: SbomSearchMatch[];
      if (scope === 'all' && !useServerPagination) {
        data = sorted;
      } else if (scope === 'range' && !useServerPagination && rangeStart && rangeEnd) {
        data = sorted.slice((rangeStart - 1) * PAGE_SIZE, rangeEnd * PAGE_SIZE);
      } else {
        data = paged;
      }
      onProgress(100);
      const rows = data.map(m => matchToRow(m, selectedFields));
      downloadCsv(buildCsv(fieldLabels, rows), filename);
      return;
    }

    // Server-side multi-page export
    const allRows: string[][] = [];
    const FETCH_LIMIT = 200;
    let startPage: number, endPage: number;
    if (scope === 'all') {
      startPage = 1;
      endPage = totalPages;
    } else {
      startPage = rangeStart ?? 1;
      endPage = rangeEnd ?? totalPages;
    }
    const startOffset = (startPage - 1) * pageSize;
    const totalRows = (endPage - startPage + 1) * pageSize;
    const totalFetches = Math.ceil(totalRows / FETCH_LIMIT);
    let fetchesDone = 0;

    for (let off = startOffset; off < startOffset + totalRows; off += FETCH_LIMIT) {
      const params = new URLSearchParams({
        q: exportFetchParams?.q ?? searchQuery,
        field: exportFetchParams?.field ?? 'all',
        registryId: exportFetchParams?.registryId ?? '',
        limit: String(FETCH_LIMIT),
        offset: String(off),
        sort: serverSort ?? 'name',
        order: serverOrder ?? 'asc',
      });
      if (exportFetchParams?.repo) params.set('repo', exportFetchParams.repo);
      if (exportFetchParams?.tag) params.set('tag', exportFetchParams.tag);

      const res = await fetch(`/api/sbom-index/search?${params}`);
      if (res.ok) {
        const data = await res.json();
        const results: SbomSearchMatch[] = data.results ?? [];
        for (const m of results) {
          allRows.push(matchToRow(m, selectedFields));
        }
      }
      fetchesDone++;
      onProgress(Math.round((fetchesDone / totalFetches) * 100));
    }

    downloadCsv(buildCsv(fieldLabels, allRows), filename);
  }, [sorted, paged, useServerPagination, totalPages, pageSize, searchQuery, serverSort, serverOrder, exportFetchParams, sbomExportFields, matchToRow]);

  // Skeleton loading state
  if (isSearching && sorted.length === 0) {
    const columns = ['Package Name', 'Namespace', 'Version', 'Publisher', 'PURL', 'License', 'Repository', 'Tag'];
    const widths = ['15%', '10%', '8%', '10%', '22%', '8%', '17%', '10%'];
    return (
      <div className="mt-4">
        <div className="h-4 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-3" />
        <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
          <table className="w-full table-fixed divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                {columns.map((col, i) => (
                  <th key={i} style={{ width: widths[i] }} className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
              {Array.from({ length: 10 }).map((_, i) => (
                <tr key={i}>
                  {widths.map((w, j) => (
                    <td key={j} className="px-3 py-2">
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" style={{ width: `${50 + (i * j * 7) % 40}%` }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (sorted.length === 0 && !isSearching) {
    if (!hasSearched) return null;
    if (total === -1) {
      return (
        <div className="text-center py-12">
          <p className="text-yellow-600 dark:text-yellow-400 font-medium mb-2">Search timed out</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            The query &ldquo;{searchQuery}&rdquo; matched too many results. Try a more specific search or use a field filter
            (e.g., <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">name:openssl</code> or <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">namespace:azurelinux</code>).
          </p>
        </div>
      );
    }
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        No SBOM packages found matching &ldquo;{searchQuery || 'your filters'}&rdquo;
      </div>
    );
  }

  // Format the display total
  const formatTotal = () => {
    if (total !== undefined && total > 0) {
      return <><strong>{total.toLocaleString()}</strong></>;
    }
    if (stats?.estimatedTotal && stats.estimatedTotal > 0) {
      return <><strong>{stats.estimatedTotal.toLocaleString()}</strong></>;
    }
    return <><strong>{paged.length}</strong></>;
  };

  // Use server stats if available, otherwise page-level stats
  const displayRepos = stats?.repoCount && stats.repoCount > 0 ? stats.repoCount : repoCount;
  const displayTags = stats?.tagCount && stats.tagCount > 0 ? stats.tagCount : tagCount;

  return (
    <div>
      {/* Summary bar */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {useServerPagination ? (
            <>
              Found {formatTotal()} package
              {(total !== 1) ? 's' : ''} across{' '}
              <strong>{displayRepos.toLocaleString()}</strong> repo
              {displayRepos !== 1 ? 's' : ''}{displayTags > 0 && <> and{' '}
              <strong>{displayTags.toLocaleString()}</strong> tag
              {displayTags !== 1 ? 's' : ''}</>}
              {totalPages > 1 && <>{' '}(page {currentPage} of {totalPages.toLocaleString()})</>}
            </>
          ) : (
            <>
              Found <strong>{displayCount.toLocaleString()}</strong> package
              {displayCount !== 1 ? 's' : ''} across{' '}
              <strong>{repoCount.toLocaleString()}</strong> repo
              {repoCount !== 1 ? 's' : ''} and{' '}
              <strong>{tagCount.toLocaleString()}</strong> tag
              {tagCount !== 1 ? 's' : ''}
            </>
          )}
          {isSearching && (
            <span className="ml-2 text-blue-600 dark:text-blue-400 animate-pulse">
              (still searching...)
            </span>
          )}
        </p>
        <button
          onClick={() => setShowExportModal(true)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300"
        >
          Export CSV
        </button>
      </div>

      {/* Results table */}
      <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
        <table className="w-full table-fixed divide-y divide-gray-200 dark:divide-gray-700 text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/50">
            <tr>
              {(
                [
                  ['name', 'Package Name', 'w-[15%]'],
                  ['namespace', 'Namespace', 'w-[10%]'],
                  ['version', 'Version', 'w-[8%]'],
                  ['publisher', 'Publisher', 'w-[10%]'],
                  ['purl', 'PURL', 'w-[22%]'],
                  ['license', 'License', 'w-[8%]'],
                  ['repo', 'Repository', 'w-[17%]'],
                  ['tag', 'Tag', 'w-[10%]'],
                ] as [SortKey, string, string][]
              ).map(([key, label, widthClass]) => (
                <th
                  key={key}
                  className={`${widthClass} px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none`}
                  onClick={() => handleSort(key)}
                >
                  {label}
                  {activeSortKey === key && (
                    <span className="ml-1">{activeSortAsc ? '▲' : '▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
            {paged.map((m, idx) => (
              <tr
                key={`${m.package.purl || m.package.name}-${m.repo}-${m.tag}-${idx}`}
                className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <td className="px-3 py-2 break-words font-medium text-gray-900 dark:text-gray-100">
                  <Highlight text={m.package.name} query={searchQuery} />
                </td>
                <td className="px-3 py-2 break-words text-gray-600 dark:text-gray-400">
                  <Highlight text={m.package.namespace} query={searchQuery} />
                </td>
                <td className="px-3 py-2 break-words text-gray-600 dark:text-gray-400">
                  <Highlight text={m.package.version} query={searchQuery} />
                </td>
                <td className="px-3 py-2 break-words text-gray-600 dark:text-gray-400">
                  <Highlight text={m.package.publisher} query={searchQuery} />
                </td>
                <td className="px-3 py-2 break-all text-gray-600 dark:text-gray-400">
                  <Highlight text={m.package.purl} query={searchQuery} />
                </td>
                <td className="px-3 py-2 break-words text-gray-600 dark:text-gray-400">
                  {m.package.license}
                </td>
                <td className="px-3 py-2 break-words">
                  <Link
                    href={`/registry/${encodeURIComponent(m.repo)}?registry=${m.registryId}`}
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {m.repo}
                  </Link>
                </td>
                <td className="px-3 py-2 break-words">
                  <Link
                    href={`/registry/${encodeURIComponent(m.repo)}/tags/${encodeURIComponent(m.tag)}?registry=${m.registryId}`}
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {m.tag}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex gap-1">
            <PaginationBtn onClick={() => {
              if (useServerPagination) onPageChange(0);
              else setPage(1);
            }} disabled={currentPage === 1}>
              First
            </PaginationBtn>
            <PaginationBtn onClick={() => {
              if (useServerPagination) onPageChange(Math.max(0, offset - pageSize));
              else setPage(page - 1);
            }} disabled={currentPage === 1}>
              Prev
            </PaginationBtn>
            <PaginationBtn onClick={() => {
              if (useServerPagination) onPageChange(offset + pageSize);
              else setPage(page + 1);
            }} disabled={currentPage === totalPages}>
              Next
            </PaginationBtn>
            <PaginationBtn onClick={() => {
              if (useServerPagination) onPageChange((totalPages - 1) * pageSize);
              else setPage(totalPages);
            }} disabled={currentPage === totalPages}>
              Last
            </PaginationBtn>
          </div>
        </div>
      )}

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        mode="sbom"
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={useServerPagination ? pageSize : PAGE_SIZE}
        fields={sbomExportFields}
        onExport={handleExport}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;

  const lower = text.toLowerCase();
  const lowerQ = query.toLowerCase();
  const idx = lower.indexOf(lowerQ);
  if (idx === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-amber-200 dark:bg-amber-700/60 rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

function PaginationBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-gray-700 dark:text-gray-300"
    >
      {children}
    </button>
  );
}


