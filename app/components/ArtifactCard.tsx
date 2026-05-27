'use client';

import React, { useState } from 'react';
import { Referrer } from '@/app/types/registry';
import { formatSize } from '@/app/utils/format';
import CopyButton from '@/app/components/CopyButton';
import { isSbomArtifact } from '@/app/utils/constants';

/** Number of artifacts shown per page within each type group. */
const PAGE_SIZE = 10;

interface ArtifactCardProps {
  referrer: Referrer;
  artifactTypeLabel: string;
  onClick: (referrer: Referrer) => void;
  registryServer?: string;
  repositoryName: string;
}

/**
 * Format bytes to a human-readable size string.
 */
function formatBytes(bytes: number): string {
  return formatSize(bytes, { zeroLabel: '0 B' });
}

/**
 * Truncate a digest for display (e.g. "sha256:abcdef12…").
 */
function truncateDigest(digest: string): string {
  if (!digest) return '';
  const parts = digest.split(':');
  if (parts.length === 2 && parts[1].length > 12) {
    return `${parts[0]}:${parts[1].substring(0, 12)}…`;
  }
  return digest;
}


export default function ArtifactCard({
  referrer,
  artifactTypeLabel,
  onClick,
  registryServer,
  repositoryName,
}: ArtifactCardProps) {
  const referrerUri = referrer.reference || (registryServer ? `${registryServer}/${repositoryName}@${referrer.digest}` : referrer.digest);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(referrer)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(referrer);
        }
      }}
      className="w-full text-left p-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-lg
                 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md
                 transition-all duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900"
      aria-label={`View manifest for ${artifactTypeLabel} artifact ${truncateDigest(referrer.digest)}`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: info */}
        <div className="min-w-0 flex-1">
          {/* Type badge */}
          <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 mb-2">
            {artifactTypeLabel}
          </span>

          {/* Digest — full width */}
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-sm text-gray-800 dark:text-gray-200 break-all" title={referrer.digest}>
              {referrer.digest}
            </span>
            {/* Copy button — CopyButton handles stopPropagation internally */}
            <CopyButton
              text={referrerUri}
              label="Copy referrer URI to clipboard"
              size={14}
              className="text-gray-500 dark:text-gray-400 flex-shrink-0"
            />
          </div>

          {/* Size — for SBOMs show layer size from annotations or manifest, not descriptor size */}
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {(() => {
              // For SBOMs the referrer descriptor size is the manifest size (tiny),
              // not the actual SBOM blob size. Show the blob size if available
              // from the layers, otherwise show the descriptor size.
              if (isSbomArtifact(referrer.artifactType)) {
                // The real SBOM size is available once the user opens the panel.
                // On the card, show descriptor size with a note that it's the
                // manifest size, or just show a generic label.
                return formatBytes(referrer.size);
              }
              return formatBytes(referrer.size);
            })()}
          </span>

          {/* Annotations preview — filter out noisy/internal annotations */}
          {referrer.annotations && Object.keys(referrer.annotations).length > 0 && (() => {
            const HIDDEN_ANNOTATION_KEYS = [
              'org.opencontainers.image.created',
            ];
            const HIDDEN_ANNOTATION_PATTERNS = [
              /thumbprint/i,
              /vnd\.microsoft\.artifact\.lifecycle\./i,
            ];
            const filteredEntries = Object.entries(referrer.annotations!).filter(
              ([key]) => {
                if (HIDDEN_ANNOTATION_KEYS.includes(key)) return false;
                if (HIDDEN_ANNOTATION_PATTERNS.some(p => p.test(key))) return false;
                return true;
              }
            );
            if (filteredEntries.length === 0) return null;
            return (
              <div className="mt-2 flex flex-wrap gap-1">
                {filteredEntries.slice(0, 3).map(([key, value]) => (
                  <span key={key} className="inline-block text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded truncate max-w-[200px]" title={`${key}: ${value}`}>
                    {key.split('.').pop()}: {value.length > 30 ? value.substring(0, 30) + '…' : value}
                  </span>
                ))}
                {filteredEntries.length > 3 && (
                  <span className="inline-block text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                    +{filteredEntries.length - 3} more
                  </span>
                )}
              </div>
            );
          })()}
        </div>

        {/* Right: chevron indicator */}
        <div className="flex-shrink-0 mt-1 text-gray-400 dark:text-gray-500">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a group of ArtifactCards grouped by artifact type, with a header for each group.
 * Supports filtering via a search query.
 */
export function ArtifactCardList({
  referrers,
  getArtifactTypeLabel,
  searchQuery,
  onCardClick,
  registryServer,
  repositoryName,
}: {
  referrers: Referrer[];
  getArtifactTypeLabel: (type: string | undefined) => string;
  searchQuery: string;
  onCardClick: (referrer: Referrer) => void;
  registryServer?: string;
  repositoryName: string;
}) {
  // Group referrers by artifactType
  const referrersByType: Record<string, Referrer[]> = {};
  referrers.forEach((ref) => {
    const type = ref.artifactType || ref.mediaType || 'unknown';
    if (!referrersByType[type]) {
      referrersByType[type] = [];
    }
    referrersByType[type].push(ref);
  });

  // Filter by search query
  const filteredGroups: Record<string, Referrer[]> = {};
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    for (const [type, refs] of Object.entries(referrersByType)) {
      const label = getArtifactTypeLabel(type);
      const matchingRefs = refs.filter((ref) => {
        const typeMatch = type.toLowerCase().includes(q) || label.toLowerCase().includes(q);
        const digestMatch = ref.digest.toLowerCase().includes(q);
        const annotationMatch = ref.annotations
          ? Object.entries(ref.annotations).some(
              ([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q)
            )
          : false;
        return typeMatch || digestMatch || annotationMatch;
      });
      if (matchingRefs.length > 0) {
        filteredGroups[type] = matchingRefs;
      }
    }
  } else {
    Object.assign(filteredGroups, referrersByType);
  }

  const groupEntries = Object.entries(filteredGroups);

  if (groupEntries.length === 0) {
    return (
      <div className="p-6 bg-white dark:bg-slate-800 rounded-md border border-gray-200 dark:border-gray-700 text-center">
        <p className="text-gray-500 dark:text-gray-400">
          {searchQuery.trim() ? 'No artifacts matching your search.' : 'No supply chain artifacts found.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groupEntries.map(([type, refs]) => {
        const label = getArtifactTypeLabel(type);
        return (
          <PaginatedGroup
            key={type}
            type={type}
            label={label}
            refs={refs}
            onCardClick={onCardClick}
            registryServer={registryServer}
            repositoryName={repositoryName}
          />
        );
      })}
    </div>
  );
}

/**
 * A single artifact-type group with its own pagination controls.
 */
function PaginatedGroup({
  type,
  label,
  refs,
  onCardClick,
  registryServer,
  repositoryName,
}: {
  type: string;
  label: string;
  refs: Referrer[];
  onCardClick: (referrer: Referrer) => void;
  registryServer?: string;
  repositoryName: string;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(refs.length / PAGE_SIZE);
  const paged = refs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div>
      {/* Group header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">{label}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">({type})</span>
        <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">{refs.length} artifact{refs.length !== 1 ? 's' : ''}</span>
      </div>
      {/* Cards */}
      <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
        {paged.map((ref, i) => (
          <ArtifactCard
            key={`${ref.digest}-${page * PAGE_SIZE + i}`}
            referrer={ref}
            artifactTypeLabel={label}
            onClick={onCardClick}
            registryServer={registryServer}
            repositoryName={repositoryName}
          />
        ))}
      </div>
      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600
                       text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-800
                       hover:bg-gray-50 dark:hover:bg-slate-700
                       disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous page"
          >
            &larr; Prev
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600
                       text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-800
                       hover:bg-gray-50 dark:hover:bg-slate-700
                       disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Next page"
          >
            Next &rarr;
          </button>
        </div>
      )}
    </div>
  );
}
