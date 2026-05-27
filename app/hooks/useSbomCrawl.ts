/**
 * Client-side on-demand SBOM crawl hook for private/authenticated registries.
 *
 * Orchestrates a progressive crawl: catalog → tags → referrers → SBOM parse.
 * Results are stored in IndexedDB (`sbomIndexDb`) and matches surfaced in
 * real-time so the user sees results as repos are scanned.
 *
 * For public registries the pre-built Vercel Blob index should be used
 * instead — this hook is the **fallback** when no server-side index exists.
 */

'use client';

import { useState, useRef, useCallback } from 'react';
import type { Registry, SbomPackage } from '@/app/types/registry';
import {
  discoverSbomReferrers,
  bulkGetTags,
} from '@/app/actions/sbomSearch';
import {
  putSbomRecord,
  hasSbomRecord,
  type SbomRecord,
  type SbomSearchMatch,
} from '@/app/utils/sbomIndexDb';
import { RateLimitTracker } from '@/app/utils/rateLimiter';
import registryService from '@/app/services/registryService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CrawlPhase =
  | 'idle'
  | 'catalog'
  | 'tags'
  | 'referrers'
  | 'parsing'
  | 'complete'
  | 'cancelled'
  | 'error';

export interface CrawlProgress {
  phase: CrawlPhase;
  currentRepo: string;
  reposScanned: number;
  totalRepos: number;
  tagsScanned: number;
  sbomsFound: number;
  sbomsIndexed: number;
  matchCount: number;
  error?: string;
  rateLimitWarning?: boolean;
}

interface UseSbomCrawlProps {
  registry: Registry | null;
  searchQuery: string;
  searchField?: 'name' | 'namespace' | 'version' | 'publisher' | 'purl' | 'license' | 'all';
  repoFilter?: string;
}

interface UseSbomCrawlReturn {
  progress: CrawlProgress;
  matches: SbomSearchMatch[];
  start: () => void;
  cancel: () => void;
  isRunning: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_BATCH_SIZE = 10;
const TAG_BATCH_SIZE = 5;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSbomCrawl({
  registry,
  searchQuery,
  searchField = 'all',
  repoFilter,
}: UseSbomCrawlProps): UseSbomCrawlReturn {
  const [progress, setProgress] = useState<CrawlProgress>({
    phase: 'idle',
    currentRepo: '',
    reposScanned: 0,
    totalRepos: 0,
    tagsScanned: 0,
    sbomsFound: 0,
    sbomsIndexed: 0,
    matchCount: 0,
  });
  const [matches, setMatches] = useState<SbomSearchMatch[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const isRunningRef = useRef(false);
  const rateLimiter = useRef(new RateLimitTracker());

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    isRunningRef.current = false;
    setProgress((prev) => ({ ...prev, phase: 'cancelled' }));
  }, []);

  const start = useCallback(async () => {
    if (!registry || isRunningRef.current) return;

    // Reset
    abortRef.current = new AbortController();
    isRunningRef.current = true;
    rateLimiter.current.clear();
    setMatches([]);
    setProgress({
      phase: 'catalog',
      currentRepo: '',
      reposScanned: 0,
      totalRepos: 0,
      tagsScanned: 0,
      sbomsFound: 0,
      sbomsIndexed: 0,
      matchCount: 0,
    });

    const lowerQuery = searchQuery.toLowerCase().trim();
    const registryId = registry.id || registry.server;
    const credentials =
      registry.type === 'authenticated'
        ? { username: registry.username, password: registry.password }
        : undefined;

    try {
      // --- Phase 1: Catalog ---
      let repos: string[];
      try {
        const catalog = await registryService.getCatalog(registry, 5000, 1);
        repos = catalog.repositories ?? [];
      } catch {
        setProgress((p) => ({ ...p, phase: 'error', error: 'Failed to fetch catalog' }));
        isRunningRef.current = false;
        return;
      }

      // Apply repo filter
      if (repoFilter) {
        const lower = repoFilter.toLowerCase();
        repos = repos.filter((r) => r.toLowerCase().includes(lower));
      }

      setProgress((p) => ({ ...p, phase: 'tags', totalRepos: repos.length }));

      if (abortRef.current?.signal.aborted) return;

      // --- Phase 2–4: Process repos in batches ---
      let totalMatches = 0;

      for (let i = 0; i < repos.length; i += REPO_BATCH_SIZE) {
        if (abortRef.current?.signal.aborted) break;

        // Rate-limit check
        const rl = rateLimiter.current.shouldWait(registryId);
        if (rl.wait) {
          setProgress((p) => ({ ...p, rateLimitWarning: true }));
          await sleep(rl.delayMs);
        }

        const batch = repos.slice(i, i + REPO_BATCH_SIZE);

        await Promise.allSettled(
          batch.map(async (repo) => {
            if (abortRef.current?.signal.aborted) return;

            setProgress((p) => ({ ...p, currentRepo: repo }));

            // Get tags
            const tagsResult = await bulkGetTags(
              registry.server,
              repo,
              registryId,
              credentials,
            );

            if (tagsResult.retryAfter) {
              rateLimiter.current.record429(registryId, tagsResult.retryAfter);
              return;
            }
            if (!tagsResult.success || tagsResult.tags.length === 0) return;

            rateLimiter.current.recordSuccess(registryId);

            // Process tags in sub-batches
            for (let t = 0; t < tagsResult.tags.length; t += TAG_BATCH_SIZE) {
              if (abortRef.current?.signal.aborted) break;

              const tagBatch = tagsResult.tags.slice(t, t + TAG_BATCH_SIZE);

              await Promise.allSettled(
                tagBatch.map(async (tag) => {
                  if (abortRef.current?.signal.aborted) return;

                  const refResult = await discoverSbomReferrers(
                    registry.server,
                    repo,
                    tag,
                    registryId,
                    credentials,
                  );

                  if (refResult.retryAfter) {
                    rateLimiter.current.record429(registryId, refResult.retryAfter);
                    return;
                  }
                  if (!refResult.success || refResult.referrers.length === 0) return;

                  rateLimiter.current.recordSuccess(registryId);

                  // Parse each SBOM referrer
                  for (const ref of refResult.referrers) {
                    if (abortRef.current?.signal.aborted) return;

                    const recordId = `${registryId}:${ref.digest}`;
                    const alreadyCached = await hasSbomRecord(registryId, ref.digest);

                    let packages: SbomPackage[] = [];

                    if (!alreadyCached) {
                      // Parse via the existing blob/parse route
                      try {
                        packages = await parseSbomViaApi(
                          registry.server,
                          registryId,
                          repo,
                          ref.digest,
                          credentials,
                        );
                      } catch {
                        continue;
                      }

                      // Store in IndexedDB
                      const record: SbomRecord = {
                        id: recordId,
                        blobDigest: ref.digest,
                        repo,
                        tag,
                        registryServer: registry.server,
                        registryId,
                        packages,
                        timestamp: new Date().toISOString(),
                      };
                      await putSbomRecord(record);

                      setProgress((p) => ({
                        ...p,
                        sbomsFound: p.sbomsFound + 1,
                        sbomsIndexed: p.sbomsIndexed + 1,
                      }));
                    }

                    // Check for matches
                    if (lowerQuery) {
                      // If cached, we didn't load packages — search will find them
                      // For newly parsed, check now
                      if (packages.length > 0) {
                        for (const pkg of packages) {
                          if (matchesPkg(pkg, lowerQuery, searchField)) {
                            totalMatches++;
                            setMatches((prev) => [
                              ...prev,
                              {
                                package: pkg,
                                repo,
                                tag,
                                registryServer: registry.server,
                                registryId,
                              },
                            ]);
                          }
                        }
                        setProgress((p) => ({ ...p, matchCount: totalMatches }));
                      }
                    }
                  }

                  setProgress((p) => ({
                    ...p,
                    tagsScanned: p.tagsScanned + 1,
                  }));
                }),
              );
            }
          }),
        );

        setProgress((p) => ({
          ...p,
          reposScanned: Math.min(i + batch.length, repos.length),
        }));
      }

      setProgress((p) => ({ ...p, phase: 'complete' }));
    } catch (err) {
      if (!abortRef.current?.signal.aborted) {
        setProgress((p) => ({
          ...p,
          phase: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
    } finally {
      isRunningRef.current = false;
    }
  }, [registry, searchQuery, searchField, repoFilter]);

  return {
    progress,
    matches,
    start,
    cancel,
    isRunning: progress.phase !== 'idle' && progress.phase !== 'complete' && progress.phase !== 'cancelled' && progress.phase !== 'error',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function matchesPkg(
  pkg: SbomPackage,
  lowerQ: string,
  field: string,
): boolean {
  if (field === 'all') {
    return (
      pkg.name.toLowerCase().includes(lowerQ) ||
      pkg.namespace.toLowerCase().includes(lowerQ) ||
      pkg.version.toLowerCase().includes(lowerQ) ||
      pkg.publisher.toLowerCase().includes(lowerQ) ||
      pkg.purl.toLowerCase().includes(lowerQ) ||
      pkg.license.toLowerCase().includes(lowerQ)
    );
  }
  return ((pkg as unknown as Record<string, string>)[field] ?? '').toLowerCase().includes(lowerQ);
}

/**
 * Call the existing SBOM parse API route and collect all packages.
 */
async function parseSbomViaApi(
  registry: string,
  registryId: string,
  repositoryName: string,
  artifactDigest: string,
  credentials?: { username?: string; password?: string },
): Promise<SbomPackage[]> {
  const res = await fetch('/api/registry/blob/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      registry,
      registryId,
      repositoryName,
      artifactDigest,
      credentials,
    }),
  });

  if (!res.ok) return [];

  const reader = res.body?.getReader();
  if (!reader) return [];

  const decoder = new TextDecoder();
  let buffer = '';
  const packages: SbomPackage[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.meta || obj.partial || obj.error) continue;
        packages.push(obj as SbomPackage);
      } catch {
        // skip malformed
      }
    }
  }

  return packages;
}
