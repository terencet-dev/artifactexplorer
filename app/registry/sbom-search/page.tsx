'use client';

/**
 * SBOM Search page — `/registry/sbom-search`
 *
 * - MCR (public): server-side search via /api/sbom-index/search (Postgres).
 * - Private registries: on-demand client-side crawl with IndexedDB.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import SbomIndexStatus from '@/app/components/SbomIndexStatus';
import SbomSearchResults from '@/app/components/SbomSearchResults';
import { useSbomCrawl } from '@/app/hooks/useSbomCrawl';
import {
  searchPackages as searchIndexedDb,
  type SbomSearchMatch,
} from '@/app/utils/sbomIndexDb';
import type { Registry } from '@/app/types/registry';
import registryService from '@/app/services/registryService';
import { KNOWN_PUBLIC_REGISTRIES } from '@/app/utils/constants';
import { isSbomSearchVisible } from '@/app/utils/sbomFeatureFlag';

type SearchField = 'all' | 'name' | 'namespace' | 'version' | 'publisher' | 'purl' | 'license';

interface SbomIndexMeta {
  status: string;
  progress: number;
  eta?: string;
  reposScanned: number;
  totalRepos: number;
  packagesIndexed: number;
  sbomsFound: number;
  lastUpdated: string | null;
}

const FIELD_OPTIONS: { value: SearchField; label: string }[] = [
  { value: 'all', label: 'All Fields' },
  { value: 'name', label: 'Name' },
  { value: 'namespace', label: 'Namespace' },
  { value: 'version', label: 'Version' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'purl', label: 'PURL' },
  { value: 'license', label: 'License' },
];

const MCR_REGISTRY_ID = 'mcr-microsoft-com';
const PAGE_SIZE = 50;

export default function SbomSearchPage() {
  const router = useRouter();

  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  useEffect(() => { setFeatureEnabled(isSbomSearchVisible()); }, []);

  const [registries, setRegistries] = useState<Registry[]>([]);
  const [selectedRegistry, setSelectedRegistry] = useState<Registry | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('all');
  const [repoFilter, setRepoFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [results, setResults] = useState<SbomSearchMatch[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [searchOffset, setSearchOffset] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const [serverMeta, setServerMeta] = useState<SbomIndexMeta | null>(null);

  const isPublicRegistry = selectedRegistry
    ? KNOWN_PUBLIC_REGISTRIES.includes(selectedRegistry.server)
    : false;
  const metaPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const crawl = useSbomCrawl({
    registry: isPublicRegistry ? null : selectedRegistry,
    searchQuery,
    searchField,
    repoFilter,
  });

  useEffect(() => {
    const allRegs = registryService.getAllRegistries();
    setRegistries(allRegs);
    const mcr = allRegs.find((r) => r.server === 'mcr.microsoft.com');
    setSelectedRegistry(mcr ?? allRegs[0] ?? null);
  }, []);

  const fetchMeta = useCallback(async () => {
    if (!selectedRegistry || !isPublicRegistry) { setServerMeta(null); return; }
    try {
      const res = await fetch(`/api/sbom-index/meta?registry=${encodeURIComponent(selectedRegistry.server)}`);
      if (res.ok) setServerMeta(await res.json());
    } catch { /* ignore */ }
  }, [selectedRegistry, isPublicRegistry]);

  useEffect(() => {
    fetchMeta();
    metaPollTimer.current = setInterval(() => {
      if (serverMeta?.status === 'indexing') fetchMeta();
    }, 30_000);
    return () => { if (metaPollTimer.current) clearInterval(metaPollTimer.current); };
  }, [fetchMeta, serverMeta?.status]);

  const handleSearch = useCallback(async (offset = 0) => {
    if (!searchQuery.trim()) { setResults([]); setTotalResults(0); return; }

    setIsSearching(true);
    setHasSearched(true);
    setSearchOffset(offset);

    try {
      if (isPublicRegistry) {
        const params = new URLSearchParams({
          q: searchQuery, field: searchField, registryId: MCR_REGISTRY_ID,
          limit: String(PAGE_SIZE), offset: String(offset),
        });
        if (repoFilter.trim()) params.set('repo', repoFilter.trim());
        if (tagFilter.trim()) params.set('tag', tagFilter.trim());

        const res = await fetch(`/api/sbom-index/search?${params}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results ?? []);
          setTotalResults(data.total ?? 0);
        }
      } else {
        const registryId = selectedRegistry?.id || selectedRegistry?.server || MCR_REGISTRY_ID;
        let localMatches = await searchIndexedDb(searchQuery, searchField, registryId);
        if (repoFilter.trim()) {
          const lf = repoFilter.toLowerCase().trim();
          localMatches = localMatches.filter((m) => m.repo.toLowerCase().includes(lf));
        }
        if (tagFilter.trim()) {
          const lt = tagFilter.toLowerCase().trim();
          localMatches = localMatches.filter((m) => m.tag.toLowerCase().includes(lt));
        }
        setResults(localMatches);
        setTotalResults(localMatches.length);
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchField, selectedRegistry, repoFilter, tagFilter, isPublicRegistry]);

   
  useEffect(() => { if (searchQuery.trim() && hasSearched) handleSearch(0); }, [repoFilter, tagFilter]);

  const combinedResults = !isPublicRegistry && crawl.matches.length > 0
    ? [...results, ...crawl.matches] : results;

  const handlePageChange = useCallback((newOffset: number) => { handleSearch(newOffset); }, [handleSearch]);

  if (featureEnabled === false) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">SBOM Search</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">SBOM search is not enabled on this deployment.</p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            To enable, set the <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm">DATABASE_URL</code> and <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm">CRON_SECRET</code> environment variables.
          </p>
        </div>
      </div>
    );
  }

  if (featureEnabled === null) {
    return (<div className="max-w-7xl mx-auto px-4 py-12"><div className="text-center text-gray-500 dark:text-gray-400">Loading...</div></div>);
  }

  if (registries.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">SBOM Search</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">Connect a registry to start searching SBOM packages.</p>
          <button onClick={() => router.push('/connect')} className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">Connect Registry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">SBOM Search</h1>
      </div>

      <div className="mb-4">
        <span className="text-sm text-gray-500 dark:text-gray-400">Registry: </span>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedRegistry?.server || 'mcr.microsoft.com'}</span>
      </div>

      {isPublicRegistry ? (
        <SbomIndexStatus serverMeta={serverMeta} />
      ) : (
        <SbomIndexStatus crawlProgress={crawl.progress} isCrawling={crawl.isRunning} onStartCrawl={crawl.start} onCancelCrawl={crawl.cancel} />
      )}

      <div className="mb-6 p-5 w-full bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg space-y-4">
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Package Search</label>
          <div className="flex gap-2 w-full">
            <select value={searchField} onChange={(e) => setSearchField(e.target.value as SearchField)} className="w-36 shrink-0 px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500">
              {FIELD_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
            </select>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(0); }} placeholder="Search packages..." className="flex-1 min-w-0 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            <button onClick={() => handleSearch(0)} disabled={!searchQuery.trim() || isSearching} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-sm whitespace-nowrap">
              {isSearching ? 'Searching...' : 'Search SBOMs'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-gray-400 dark:text-gray-500">Add filter:</span>
            {['name:', 'namespace:', 'version:', 'publisher:', 'purl:', 'license:'].map((prefix) => (
              <button key={prefix} onClick={() => setSearchQuery((q) => q ? `${q.trimEnd()} ${prefix}` : prefix)} className="px-2 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-gray-600 dark:text-gray-300 hover:text-blue-700 dark:hover:text-blue-300 rounded font-mono cursor-pointer transition-colors">{prefix}</button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Use the same filter multiple times for OR matching (e.g. <code className="font-mono">publisher:val1 publisher:val2</code>). Different filters combine with AND.
          </p>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700" />

        <div className="space-y-2">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Filter by Repository &amp; Tag</label>
          <div className="flex gap-2 w-full">
            <div className="relative flex-1 min-w-0">
              <input type="text" value={repoFilter} onChange={(e) => setRepoFilter(e.target.value)} placeholder="Repository name..." className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              {repoFilter && (<button onClick={() => setRepoFilter('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label="Clear repo filter"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg></button>)}
            </div>
            <div className="relative flex-1 min-w-0">
              <input type="text" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} placeholder="Tag name..." className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              {tagFilter && (<button onClick={() => setTagFilter('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label="Clear tag filter"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg></button>)}
            </div>
            {(results.length > 0 || repoFilter || tagFilter || searchQuery) && (
              <button onClick={() => { setRepoFilter(''); setTagFilter(''); setSearchQuery(''); setResults([]); setTotalResults(0); setHasSearched(false); }} className="shrink-0 px-3 py-2 text-xs border border-gray-300 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-600 transition-colors">Clear filters</button>
            )}
          </div>
        </div>
      </div>

      <SbomSearchResults
        matches={combinedResults}
        searchQuery={searchQuery}
        isSearching={isSearching || crawl.isRunning}
        hasSearched={hasSearched}
        total={isPublicRegistry ? totalResults : undefined}
        pageSize={PAGE_SIZE}
        offset={searchOffset}
        onPageChange={isPublicRegistry ? handlePageChange : undefined}
      />
    </div>
  );
}
