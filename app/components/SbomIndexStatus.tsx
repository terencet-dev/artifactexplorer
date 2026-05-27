'use client';

import React from 'react';
import type { CrawlProgress } from '@/app/hooks/useSbomCrawl';

// The meta API response shape
export interface SbomIndexMeta {
  status: string;
  progress: number;
  eta?: string;
  reposScanned: number;
  totalRepos: number;
  packagesIndexed: number;
  sbomsFound: number;
  lastUpdated: string | null;
  isReindex?: boolean;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SbomIndexStatusProps {
  /** Server-side meta for public pre-indexed registries (MCR). */
  serverMeta?: SbomIndexMeta | null;
  /** Client-side crawl progress for private registries. */
  crawlProgress?: CrawlProgress | null;
  /** Whether the client-side crawl is active. */
  isCrawling?: boolean;
  /** Callback to start the on-demand crawl. */
  onStartCrawl?: () => void;
  /** Callback to cancel the on-demand crawl. */
  onCancelCrawl?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SbomIndexStatus({
  serverMeta,
  crawlProgress,
  isCrawling,
  onStartCrawl,
  onCancelCrawl,
}: SbomIndexStatusProps) {
  // --- Server-side index status (MCR / public) ---
  if (serverMeta) {
    return <ServerIndexBanner meta={serverMeta} />;
  }

  // --- Client-side crawl status (private) ---
  if (crawlProgress) {
    return (
      <ClientCrawlBanner
        progress={crawlProgress}
        isCrawling={!!isCrawling}
        onStart={onStartCrawl}
        onCancel={onCancelCrawl}
      />
    );
  }

  // --- Not indexed, offer to start ---
  if (onStartCrawl) {
    return (
      <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-700 dark:text-gray-300 font-medium">
              This registry hasn&apos;t been indexed for SBOM search yet.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Start indexing to search packages across all repositories.
            </p>
          </div>
          <button
            onClick={onStartCrawl}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium whitespace-nowrap"
          >
            Start Indexing
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Server-side index banner (MCR pre-built index)
// ---------------------------------------------------------------------------

function ServerIndexBanner({ meta }: { meta: SbomIndexMeta }) {
  switch (meta.status) {
    case 'complete':
      return (
        <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-800/50 dark:text-green-300">
              Indexed
            </span>
            <span className="text-green-700 dark:text-green-300 text-sm">
              {meta.totalRepos.toLocaleString()} repos &middot;{' '}
              {meta.packagesIndexed.toLocaleString()} packages &middot;{' '}
              Last updated {formatTimeAgo(meta.lastUpdated ?? '')}
            </span>
          </div>
        </div>
      );

    case 'indexing':
      if (meta.isReindex) {
        return (
          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-800/50 dark:text-blue-300">
                    Reindexing
                  </span>
                  <span className="text-blue-700 dark:text-blue-300 text-sm">
                    Updating index &mdash; all {meta.packagesIndexed.toLocaleString()} packages remain searchable
                    {meta.eta && <> &middot; {meta.eta} remaining</>}
                  </span>
                </div>
                <span className="text-sm text-blue-600 dark:text-blue-400">
                  {Math.round(meta.progress)}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-blue-100 dark:bg-blue-800/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${meta.progress}%` }}
                />
              </div>
            </div>
          </div>
        );
      }
      return (
        <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-800/50 dark:text-amber-300">
                  Indexing
                </span>
                <span className="text-amber-700 dark:text-amber-300 text-sm">
                  {meta.reposScanned.toLocaleString()} of {meta.totalRepos.toLocaleString()} repos scanned
                  {meta.eta && <> &middot; {meta.eta} remaining</>}
                </span>
              </div>
              <span className="text-sm text-amber-600 dark:text-amber-400">
                {Math.round(meta.progress)}%
              </span>
            </div>
            <div className="h-1.5 w-full bg-amber-100 dark:bg-amber-800/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${meta.progress}%` }}
              />
            </div>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              You can search what&apos;s indexed so far. Results may be partial.
            </p>
          </div>
        </div>
      );

    case 'stale':
      return (
        <div className="mb-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-yellow-700 dark:text-yellow-300 text-sm">
              ⚠️ SBOM index is outdated (last updated {formatTimeAgo(meta.lastUpdated ?? '')}). Results may be incomplete.
            </span>
          </div>
        </div>
      );

    case 'unavailable':
    default:
      return (
        <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
          <span className="text-gray-600 dark:text-gray-400 text-sm">
            SBOM index not yet available. Indexing will begin shortly.
          </span>
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Client-side crawl banner (private registries)
// ---------------------------------------------------------------------------

function ClientCrawlBanner({
  progress,
  isCrawling,
  onStart,
  onCancel,
}: {
  progress: CrawlProgress;
  isCrawling: boolean;
  onStart?: () => void;
  onCancel?: () => void;
}) {
  if (progress.phase === 'idle' && onStart) {
    return (
      <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
        <div className="flex items-center justify-between">
          <span className="text-gray-700 dark:text-gray-300 text-sm">
            This registry hasn&apos;t been indexed yet.
          </span>
          <button
            onClick={onStart}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            Start Indexing
          </button>
        </div>
      </div>
    );
  }

  if (progress.phase === 'complete') {
    return (
      <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
        <span className="text-green-700 dark:text-green-300 text-sm">
          Indexing complete — {progress.reposScanned.toLocaleString()} repos scanned,{' '}
          {progress.sbomsFound.toLocaleString()} SBOMs found,{' '}
          {progress.matchCount.toLocaleString()} matches.
        </span>
      </div>
    );
  }

  if (progress.phase === 'cancelled') {
    return (
      <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
        <div className="flex items-center justify-between">
          <span className="text-gray-600 dark:text-gray-400 text-sm">
            Indexing cancelled ({progress.reposScanned}/{progress.totalRepos} repos).
          </span>
          {onStart && (
            <button
              onClick={onStart}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              Resume
            </button>
          )}
        </div>
      </div>
    );
  }

  if (progress.phase === 'error') {
    return (
      <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <div className="flex items-center justify-between">
          <span className="text-red-700 dark:text-red-300 text-sm">
            Indexing error: {progress.error || 'Unknown error'}
          </span>
          {onStart && (
            <button
              onClick={onStart}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // Active crawl
  const pct =
    progress.totalRepos > 0
      ? Math.round((progress.reposScanned / progress.totalRepos) * 100)
      : 0;

  return (
    <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <div className="text-blue-700 dark:text-blue-300 text-sm font-medium">
            Scanning{' '}
            <span className="font-mono bg-blue-100 dark:bg-blue-800/50 px-1.5 py-0.5 rounded text-xs">
              {progress.currentRepo || '...'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-blue-600 dark:text-blue-400">
              {progress.reposScanned}/{progress.totalRepos} repos &middot;{' '}
              {progress.sbomsFound} SBOMs &middot;{' '}
              {progress.matchCount} matches
            </span>
            {onCancel && isCrawling && (
              <button
                onClick={onCancel}
                className="px-3 py-1 text-sm text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 rounded hover:bg-blue-100 dark:hover:bg-blue-800/50 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="h-1.5 w-full bg-blue-100 dark:bg-blue-800/30 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        {progress.rateLimitWarning && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠️ Rate limited — slowing down to avoid throttling.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(isoDate: string): string {
  if (!isoDate) return 'never';
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
