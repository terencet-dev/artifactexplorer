'use client';

import React, { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import ExportModal, { type ExportOptions, type ExportField } from './ExportModal';
import { buildCsv, downloadCsv } from '@/app/utils/csvUtils';

interface EolSearchMatch {
  registryId: string;
  repo: string;
  tag: string;
  digest: string;
  eolDate: string;
  daysUntil: number;
  status: 'expired' | 'warning' | 'upcoming';
  hasSboms?: boolean;
}

interface EolSearchResultsProps {
  registryId: string;
  onViewSboms?: (repo: string, tag: string) => void;
}

type EolFilter = 'all' | 'expired' | 'warning' | 'upcoming';
type SortField = 'repo' | 'tag' | 'eolDate' | 'status';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 50;

export default function EolSearchResults({ registryId, onViewSboms }: EolSearchResultsProps) {
  const [results, setResults] = useState<EolSearchMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [filter, setFilter] = useState<EolFilter>('all');
  const [repoFilter, setRepoFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [offset, setOffset] = useState(0);
  const [sortField, setSortField] = useState<SortField>('eolDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showExportModal, setShowExportModal] = useState(false);

  const search = useCallback(async (newOffset = 0, newSortField?: SortField, newSortDir?: SortDir) => {
    setLoading(true);
    setOffset(newOffset);
    const sf = newSortField ?? sortField;
    const sd = newSortDir ?? sortDir;
    try {
      const params = new URLSearchParams({
        registryId,
        status: filter,
        limit: String(PAGE_SIZE),
        offset: String(newOffset),
        sort: sf,
        order: sd,
      });
      if (repoFilter.trim()) params.set('repo', repoFilter.trim());
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);

      const res = await fetch(`/api/sbom-index/eol?${params}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results ?? []);
        setTotal(data.total ?? 0);
      }
    } catch (err) {
      console.error('EOL search error:', err);
    } finally {
      setLoading(false);
      setHasSearched(true);
    }
  }, [registryId, filter, repoFilter, fromDate, toDate, sortField, sortDir]);

  const handleFilterChange = (newFilter: EolFilter) => {
    setFilter(newFilter);
    if (newFilter !== 'all') {
      setFromDate('');
      setToDate('');
    }
  };

  const clearFilters = () => {
    setFilter('all');
    setRepoFilter('');
    setFromDate('');
    setToDate('');
    setSortField('eolDate');
    setSortDir('asc');
    setResults([]);
    setTotal(0);
    setHasSearched(false);
    setOffset(0);
  };

  const handleSort = (field: SortField) => {
    const newDir = sortField === field ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
    setSortField(field);
    setSortDir(newDir);
    if (hasSearched) search(0, field, newDir);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const hasActiveFilters = filter !== 'all' || repoFilter.trim() || fromDate || toDate;

  // --- EOL field definitions for export ---
  const eolExportFields: ExportField[] = useMemo(() => [
    { key: 'repo', label: 'Repository' },
    { key: 'tag', label: 'Tag' },
    { key: 'eolDate', label: 'EOL Date' },
    { key: 'status', label: 'Status' },
    { key: 'daysUntil', label: 'Days Until EOL' },
  ], []);

  const eolMatchToRow = useCallback((r: EolSearchMatch, fields: string[]): string[] => {
    const all: Record<string, string> = {
      repo: r.repo, tag: r.tag, eolDate: r.eolDate,
      status: r.status, daysUntil: String(r.daysUntil),
    };
    return fields.map(k => all[k] ?? '');
  }, []);

  const handleExport = useCallback(async (options: ExportOptions, onProgress: (pct: number) => void) => {
    const { scope, rangeStart, rangeEnd, selectedFields } = options;
    const fieldLabels = eolExportFields.filter(f => selectedFields.includes(f.key)).map(f => f.label);
    const filename = `eol-annotations-${new Date().toISOString().split('T')[0]}.csv`;

    if (scope === 'current') {
      onProgress(100);
      const rows = results.map(r => eolMatchToRow(r, selectedFields));
      downloadCsv(buildCsv(fieldLabels, rows), filename);
      return;
    }

    // Server-side multi-page export
    const allRows: string[][] = [];
    const FETCH_LIMIT = 200;
    const startPage = scope === 'range' ? (rangeStart ?? 1) : 1;
    const endPage = scope === 'range' ? (rangeEnd ?? totalPages) : totalPages;
    const startOffset = (startPage - 1) * PAGE_SIZE;
    const totalRowsNeeded = (endPage - startPage + 1) * PAGE_SIZE;
    const totalFetches = Math.ceil(totalRowsNeeded / FETCH_LIMIT);
    let fetchesDone = 0;

    for (let off = startOffset; off < startOffset + totalRowsNeeded; off += FETCH_LIMIT) {
      const params = new URLSearchParams({
        registryId,
        status: filter,
        limit: String(FETCH_LIMIT),
        offset: String(off),
        sort: sortField,
        order: sortDir,
      });
      if (repoFilter.trim()) params.set('repo', repoFilter.trim());
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);

      const res = await fetch(`/api/sbom-index/eol?${params}`);
      if (res.ok) {
        const data = await res.json();
        const batch: EolSearchMatch[] = data.results ?? [];
        for (const r of batch) {
          allRows.push(eolMatchToRow(r, selectedFields));
        }
      }
      fetchesDone++;
      onProgress(Math.round((fetchesDone / totalFetches) * 100));
    }

    downloadCsv(buildCsv(fieldLabels, allRows), filename);
  }, [results, totalPages, registryId, filter, repoFilter, fromDate, toDate, sortField, sortDir, eolExportFields, eolMatchToRow]);

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return <span className="opacity-30 ml-1">↕</span>;
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const statusBadge = (status: EolSearchMatch['status'], daysUntil: number) => {
    const configs = {
      expired: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', label: 'Expired' },
      warning: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400', label: 'Warning' },
      upcoming: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', label: 'Upcoming' },
    };
    const c = configs[status];
    const dayText = daysUntil < 0 ? `${Math.abs(daysUntil)}d ago` : daysUntil === 0 ? 'Today' : `${daysUntil}d`;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
        {c.label}
        <span className="opacity-70">({dayText})</span>
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Filter controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm text-gray-500 dark:text-gray-400 mr-1">Filter:</span>
        {(['all', 'expired', 'warning', 'upcoming'] as EolFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => handleFilterChange(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              filter === f
                ? 'bg-blue-100 dark:bg-blue-900 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200'
                : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-700'
            }`}
          >
            {f === 'all' ? 'All' : f === 'expired' ? 'Expired' : f === 'warning' ? '≤30 days' : 'Upcoming'}
          </button>
        ))}
      </div>

      {/* Repo filter + date range */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Repository filter</label>
          <input
            type="text"
            value={repoFilter}
            onChange={(e) => setRepoFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search(0); }}
            placeholder="e.g., dotnet/runtime"
            className="w-full px-3 py-2 text-sm border rounded-md bg-white dark:bg-slate-800 border-gray-200 dark:border-gray-700"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">From</label>
          <input
            type={fromDate ? 'date' : 'text'}
            value={fromDate}
            placeholder="Select date"
            onFocus={(e) => { e.currentTarget.type = 'date'; }}
            onBlur={(e) => { if (!e.currentTarget.value) e.currentTarget.type = 'text'; }}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-3 py-2 text-sm border rounded-md bg-white dark:bg-slate-800 border-gray-200 dark:border-gray-700 w-36"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">To</label>
          <input
            type={toDate ? 'date' : 'text'}
            value={toDate}
            placeholder="Select date"
            onFocus={(e) => { e.currentTarget.type = 'date'; }}
            onBlur={(e) => { if (!e.currentTarget.value) e.currentTarget.type = 'text'; }}
            onChange={(e) => setToDate(e.target.value)}
            className="px-3 py-2 text-sm border rounded-md bg-white dark:bg-slate-800 border-gray-200 dark:border-gray-700 w-36"
          />
        </div>
        <button
          onClick={() => search(0)}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded-md text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-600 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Results */}
      {hasSearched && results.length === 0 && !loading && (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
          No EOL annotations found matching your filters.
        </p>
      )}

      {results.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()} results
            </div>
            <button
              onClick={() => setShowExportModal(true)}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300"
            >
              Export CSV
            </button>
          </div>

          <div className="overflow-x-auto border rounded-lg dark:border-gray-700">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800 border-b dark:border-gray-700">
                <tr>
                  <th onClick={() => handleSort('repo')} className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-white select-none">
                    Repository{sortIcon('repo')}
                  </th>
                  <th onClick={() => handleSort('tag')} className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-white select-none">
                    Tag{sortIcon('tag')}
                  </th>
                  <th onClick={() => handleSort('eolDate')} className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-white select-none">
                    EOL Date{sortIcon('eolDate')}
                  </th>
                  <th onClick={() => handleSort('status')} className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-white select-none">
                    Status{sortIcon('status')}
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {results.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2">
                      <Link
                        href={`/registry/${encodeURIComponent(r.repo)}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-xs font-mono"
                      >
                        {r.repo}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/registry/${encodeURIComponent(r.repo)}/tags/${encodeURIComponent(r.tag)}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-xs font-mono"
                      >
                        {r.tag}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-300">{r.eolDate}</td>
                    <td className="px-4 py-2">{statusBadge(r.status, r.daysUntil)}</td>
                    <td className="px-4 py-2">
                      {onViewSboms && r.hasSboms !== false && (
                        <button
                          onClick={() => onViewSboms(r.repo, r.tag)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          View SBOMs
                        </button>
                      )}
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
                <button
                  onClick={() => search(0)}
                  disabled={offset === 0 || loading}
                  className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-gray-700 dark:text-gray-300"
                >
                  First
                </button>
                <button
                  onClick={() => search(offset - PAGE_SIZE)}
                  disabled={offset === 0 || loading}
                  className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-gray-700 dark:text-gray-300"
                >
                  Prev
                </button>
                <button
                  onClick={() => search(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total || loading}
                  className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-gray-700 dark:text-gray-300"
                >
                  Next
                </button>
                <button
                  onClick={() => search((totalPages - 1) * PAGE_SIZE)}
                  disabled={currentPage === totalPages || loading}
                  className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-gray-700 dark:text-gray-300"
                >
                  Last
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {!hasSearched && !loading && (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
          Select a filter and click Search to find EOL annotations.
        </p>
      )}

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        mode="eol"
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={PAGE_SIZE}
        fields={eolExportFields}
        onExport={handleExport}
      />
    </div>
  );
}
