/**
 * SBOM Crawl Engine — framework-agnostic business logic.
 *
 * This module contains all crawl logic extracted from the Vercel cron route
 * so it can be consumed by both the Vercel adapter (app/api/sbom-index/crawl/route.ts)
 * and the Azure Functions timer trigger (infra/azure-functions/src/functions/sbomCrawl.ts).
 *
 * Zero framework dependencies — imports only from sbomDb, sbomParser, constants.
 * The `fetch` function is injected via CrawlOptions.fetchFn to decouple auth
 * strategy (Next.js cookies vs env-var-only).
 */

import {
  getCrawlState,
  putCrawlState,
  emptyCrawlState,
  acquireLock,
  releaseLock,
  renewLock,
  upsertPackages,
  upsertEolAnnotations,
  refreshSbomStats,
  getKnownArtifactDigestsForRepo,
  type IndexRecord,
  type EolRecord,
} from '@/app/utils/sbomDb';
import {
  detectSbomFormat,
  extractSpdx23Package,
  extractSpdx30Package,
  extractCycloneDxComponent,
  type SbomFormatInfo,
} from '@/app/utils/sbomParser';
import { isSbomArtifact, isLifecycleArtifact, LIFECYCLE_EOL_ANNOTATION_KEY } from '@/app/utils/constants';
import type { SbomPackage } from '@/app/types/registry';

// ---------------------------------------------------------------------------
// Public API — types
// ---------------------------------------------------------------------------

/**
 * Auth context passed through to fetchFn.
 * Mirrors the shape in app/api/registry/auth.ts but without coupling to it.
 */
export interface CrawlAuthContext {
  registry: string;
  registryId: string;
  repository: string;
  credentials?: { username?: string; password?: string };
}

/**
 * Fetch function signature injected by the adapter.
 * Vercel adapter passes `authenticatedFetch` (supports cookies).
 * Azure adapter passes a simpler env-var-only fetcher.
 */
export type FetchFn = (
  url: string,
  options: RequestInit,
  ctx: CrawlAuthContext,
) => Promise<Response>;

export interface CrawlOptions {
  /** Authenticated fetch function — injected by the adapter */
  fetchFn: FetchFn;
  /** Absolute deadline timestamp (Date.now() + budget) */
  deadlineMs: number;
  /** Max repos to process in this invocation */
  reposPerInvocation?: number;
  /** Partition config — omit for single-worker mode */
  partition?: { index: number; total: number };
  /** Sub-partition config — further split a partition's repos across extra workers */
  subPartition?: { index: number; total: number };
  /** Recrawl interval in ms (default: 24h) */
  recrawlIntervalMs?: number;
  /** Max age of a crawling cycle before it's reset to start fresh (default: 24h) */
  maxCycleAgeMs?: number;
  /** Lock TTL in ms (default: 295s) */
  lockTtlMs?: number;
  /** Registry server to crawl (REQUIRED — set via CRAWL_DEFAULT_REGISTRY_SERVER env or pass explicitly) */
  registryServer?: string;
  /** Registry ID (REQUIRED — set via CRAWL_DEFAULT_REGISTRY_ID env or pass explicitly) */
  registryId?: string;
  /** Label prefix for console.log (default: [SBOM Crawl]) */
  label?: string;
}

export interface CrawlResult {
  status: 'skipped' | 'complete' | 'crawling' | 'error';
  reason?: string;
  partition?: number;
  reposProcessed?: number;
  reposScanned?: number;
  totalRepos?: number;
  sbomsFound?: number;
  packagesIndexed?: number;
  newRecords?: number;
  eolAnnotationsFound?: number;
  skippedRefs?: number;
  nextRecrawlIn?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_REPOS_PER_INVOCATION = 50;
const CATALOG_PAGE_SIZE = 5000;
const DEFAULT_RECRAWL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CYCLE_AGE_MS = 24 * 60 * 60 * 1000; // 24h — reset stale 'crawling' cycles
const DEFAULT_LOCK_TTL_MS = 600_000;     // 10 min — match Azure Function timeout
const LOCK_RENEW_INTERVAL_MS = 120_000;  // renew lock every 2 min
const DEFAULT_REGISTRY_SERVER = process.env.CRAWL_DEFAULT_REGISTRY_SERVER ?? '';
const DEFAULT_REGISTRY_ID = process.env.CRAWL_DEFAULT_REGISTRY_ID ?? '';
const PRIORITY_PREFIXES = ['oss/v2/', 'oss/'];
const MAX_DIGESTS = 50_000;

// ---------------------------------------------------------------------------
// Public API — entry point
// ---------------------------------------------------------------------------

/**
 * Run a single crawl invocation. Returns a result object describing what happened.
 *
 * This function:
 * 1. Acquires a distributed lock (or returns 'skipped')
 * 2. Fetches/resumes the crawl state from Postgres
 * 3. Processes up to `reposPerInvocation` repos within the deadline
 * 4. Upserts discovered packages directly to Postgres after each repo
 * 5. Saves crawl state after each repo (survives timeouts)
 * 6. Releases the lock in `finally`
 */
export async function runCrawl(options: CrawlOptions): Promise<CrawlResult> {
  const {
    fetchFn,
    deadlineMs,
    reposPerInvocation = DEFAULT_REPOS_PER_INVOCATION,
    partition,
    recrawlIntervalMs = DEFAULT_RECRAWL_INTERVAL_MS,
    maxCycleAgeMs = DEFAULT_MAX_CYCLE_AGE_MS,
    lockTtlMs = DEFAULT_LOCK_TTL_MS,
    registryServer = DEFAULT_REGISTRY_SERVER,
    registryId = DEFAULT_REGISTRY_ID,
  } = options;

  if (!registryServer || !registryId) {
    return {
      status: 'error',
      error: 'Crawl misconfigured: registryServer and registryId are required. Set CRAWL_DEFAULT_REGISTRY_SERVER and CRAWL_DEFAULT_REGISTRY_ID env vars or pass them explicitly. See .env.example.',
    };
  }

  const subPartition = options.subPartition;
  const isPartitioned = !!partition && partition.total > 1;
  const isSubPartitioned = !!subPartition && subPartition.total > 1;
  const suffix = isPartitioned ? `-p${partition!.index}` : '';
  const subSuffix = isSubPartitioned ? `-s${subPartition!.index}` : '';
  const stateId = `${registryId}${suffix}${subSuffix}`;
  const lockId = `${registryId}${suffix}${subSuffix}`;
  const label = options.label ?? (isPartitioned
    ? (isSubPartitioned ? `[SBOM Crawl P${partition!.index}S${subPartition!.index}]` : `[SBOM Crawl P${partition!.index}]`)
    : '[SBOM Crawl]');

  const lockAcquired = await acquireLock(lockId, lockTtlMs);
  if (!lockAcquired) {
    console.log(`${label} Another invocation is running, skipping`);
    return { status: 'skipped', reason: 'Another crawl invocation is currently running' };
  }

  try {
    let state = await getCrawlState(stateId);
    if (!state) state = emptyCrawlState(stateId, registryServer);

    const authCtx: CrawlAuthContext = { registry: registryServer, registryId, repository: '' };

    // Reset stale 'crawling' cycles that didn't finish within maxCycleAgeMs.
    // This ensures every night starts a fresh full scan instead of resuming
    // a multi-day partial cycle. Delta crawl (knownArtifactDigests from DB)
    // still skips unchanged referrers — only the cursor resets, not the data.
    if (state.status === 'crawling' && state.startedAt) {
      const cycleAge = Date.now() - new Date(state.startedAt).getTime();
      if (cycleAge > maxCycleAgeMs) {
        console.log(`${label} Stale cycle (started ${Math.round(cycleAge / 3_600_000)}h ago, max ${Math.round(maxCycleAgeMs / 3_600_000)}h) — resetting for fresh full scan`);
        state = emptyCrawlState(stateId, registryServer);
      }
    }

    // Check if a completed cycle is still within the recrawl interval
    if (state.status === 'complete') {
      const completedAt = new Date(state.lastRunAt || state.startedAt).getTime();
      const elapsed = Date.now() - completedAt;
      if (elapsed < recrawlIntervalMs) {
        const hoursLeft = Math.round((recrawlIntervalMs - elapsed) / 3_600_000);
        console.log(`${label} Cycle complete. Next re-crawl in ~${hoursLeft}h, skipping.`);
        return { status: 'complete', nextRecrawlIn: `~${hoursLeft}h`, reposScanned: state.reposScanned, packagesIndexed: state.packagesIndexed };
      }
      console.log(`${label} Starting new crawl cycle`);
      state = emptyCrawlState(stateId, registryServer);
    }

    // Fetch or resume catalog
    let allRepos: string[] = [];
    if (state.status === 'idle' || state.totalRepos === 0) {
      console.log(`${label} Fetching MCR catalog...`);
      allRepos = prioritizeRepos(await fetchCatalog(fetchFn, authCtx, registryServer));
      state.totalRepos = allRepos.length;
      if (isPartitioned) allRepos = allRepos.filter((r) => simpleHash(r) % partition!.total === partition!.index);
      if (isSubPartitioned) allRepos = allRepos.filter((_, i) => i % subPartition!.total === subPartition!.index);
      state.status = 'crawling';
      state.startedAt = new Date().toISOString();
      state.reposScanned = 0; state.tagsScanned = 0; state.sbomsFound = 0; state.packagesIndexed = 0;
      state.lastRepo = ''; state.currentBatch = 0;
      console.log(`${label} Catalog: ${state.totalRepos} total repos, ${allRepos.length} in this partition`);
    } else {
      allRepos = prioritizeRepos(await fetchCatalog(fetchFn, authCtx, registryServer));
      state.totalRepos = allRepos.length;
      if (isPartitioned) allRepos = allRepos.filter((r) => simpleHash(r) % partition!.total === partition!.index);
      if (isSubPartitioned) allRepos = allRepos.filter((_, i) => i % subPartition!.total === subPartition!.index);
    }

    // Resume from last cursor
    let startIdx = 0;
    if (state.lastRepo) {
      const idx = allRepos.indexOf(state.lastRepo);
      if (idx >= 0) startIdx = state.lastRepoComplete ? idx + 1 : idx;
    }

    if (startIdx >= allRepos.length) {
      console.log(`${label} Full cycle complete!`);
      state.status = 'complete';
      state.lastRunAt = new Date().toISOString();
      state.processedDigests = [];
      await putCrawlState(state);
      // Refresh materialized view for fast stats queries
      try { await refreshSbomStats(); } catch { /* non-fatal — view may not exist */ }
      return { status: 'complete', reposScanned: state.reposScanned, packagesIndexed: state.packagesIndexed };
    }

    // Known artifact digests accumulate per-repo during batch processing (delta crawl)
    const knownArtifactDigests = new Set<string>();

    // Process batch
    const endIdx = Math.min(startIdx + reposPerInvocation, allRepos.length);
    const batch = allRepos.slice(startIdx, endIdx);
    console.log(`${label} Processing repos ${startIdx}–${endIdx - 1} of ${allRepos.length}: ${batch[0]} → ${batch[batch.length - 1]}`);

    let reposProcessed = 0;
    let totalNewRecords = 0;
    let totalEolRecords = 0;
    let totalSkippedRefs = 0;
    const digestSet = new Set(state.processedDigests ?? []);
    let lastLockRenew = Date.now();

    for (const repo of batch) {
      if (Date.now() > deadlineMs) { console.log(`${label} Approaching timeout, saving progress...`); break; }

      // Renew lock periodically to prevent expiry during long repos
      if (Date.now() - lastLockRenew > LOCK_RENEW_INTERVAL_MS) {
        try {
          const renewed = await renewLock(lockId, lockTtlMs);
          if (renewed) { console.log(`${label} Lock renewed`); lastLockRenew = Date.now(); }
          else { console.warn(`${label} Lock renewal failed — lost lock, stopping`); break; }
        } catch (err) { console.warn(`${label} Lock renewal error (non-fatal):`, err); }
      }

      const resumeTag = (repo === state.lastRepo && !state.lastRepoComplete) ? state.lastTag : undefined;

      // Load known artifact digests for this repo (delta crawl — skip unchanged referrers)
      try {
        const repoDigests = await getKnownArtifactDigestsForRepo(registryId, repo);
        for (const d of repoDigests) knownArtifactDigests.add(d);
      } catch { /* non-fatal — proceed without delta for this repo */ }

      try {
        // Per-tag callback: upsert packages + EOL and save state after each tag
        const onTagComplete: OnTagComplete = async (tag, tagRecords, tagEolRecords) => {
          if (tagRecords.length > 0) {
            try {
              const inserted = await upsertPackages(tagRecords);
              totalNewRecords += tagRecords.length;
              console.log(`${label} ${repo}:${tag}: ${inserted} packages upserted`);
            } catch (err) {
              console.error(`${label} Upsert failed for ${repo}:${tag} (non-fatal):`, err instanceof Error ? err.message : err);
            }
          }
          if (tagEolRecords.length > 0) {
            try {
              const eolInserted = await upsertEolAnnotations(tagEolRecords);
              totalEolRecords += eolInserted;
            } catch (err) {
              console.warn(`${label} EOL upsert failed for ${repo}:${tag} (non-fatal):`, err instanceof Error ? err.message : err);
            }
          }
          // Renew lock during long repo processing (many tags)
          if (Date.now() - lastLockRenew > LOCK_RENEW_INTERVAL_MS) {
            try {
              const renewed = await renewLock(lockId, lockTtlMs);
              if (renewed) { lastLockRenew = Date.now(); }
            } catch { /* non-fatal */ }
          }
          // Save crawl state after each tag so progress survives timeouts
          state.lastRepo = repo;
          state.lastTag = tag;
          state.lastRepoComplete = false;
          state.tagsScanned += 1;  // increment per-tag for real-time visibility
          if (Date.now() < deadlineMs - 5_000) {
            await putCrawlState(state);
          }
        };

        const { records, lastProcessedTag, repoComplete, tagsProcessed, skippedRefs } = await processRepository(
          repo, authCtx, fetchFn, registryServer, registryId, deadlineMs, digestSet, knownArtifactDigests, resumeTag, onTagComplete,
        );
        totalSkippedRefs += skippedRefs;
        // tagsScanned already incremented per-tag in onTagComplete
        state.sbomsFound += records.length;
        for (const r of records) state.packagesIndexed += r.packages.length;
        state.errorCount = 0;
        state.lastRepo = repo; state.lastTag = lastProcessedTag; state.lastRepoComplete = repoComplete;
        if (repoComplete) { reposProcessed++; state.reposScanned += 1; }

        // Save state after repo completion
        if (Date.now() < deadlineMs - 5_000) {
          await putCrawlState(state);
        }
      } catch (err) {
        console.error(`${label} Error processing ${repo}:`, err);
        state.errorCount += 1;
        state.lastError = err instanceof Error ? err.message : String(err);
        state.lastRepo = repo; state.lastRepoComplete = false;
        if (err instanceof RateLimitError) { console.warn(`${label} Rate-limited, stopping`); break; }
      }
    }

    // processedDigests no longer persisted to DB — delta crawl uses per-repo DB queries instead.
    // digestSet stays in memory for within-invocation manifest dedup only.

    state.lastRunAt = new Date().toISOString();
    state.currentBatch += 1;
    await putCrawlState(state);

    return {
      status: 'crawling',
      partition: isPartitioned ? partition!.index : undefined,
      reposProcessed,
      reposScanned: state.reposScanned,
      totalRepos: state.totalRepos,
      sbomsFound: state.sbomsFound,
      packagesIndexed: state.packagesIndexed,
      newRecords: totalNewRecords,
      eolAnnotationsFound: totalEolRecords,
      skippedRefs: totalSkippedRefs,
    };
  } catch (error) {
    console.error(`${options.label ?? '[SBOM Crawl]'} Fatal error:`, error);
    return { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    await releaseLock(lockId);
  }
}

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

async function fetchCatalog(fetchFn: FetchFn, authCtx: CrawlAuthContext, registryServer: string): Promise<string[]> {
  const repos: string[] = [];
  let last = '';
  while (true) {
    const url = last
      ? `https://${registryServer}/v2/_catalog?n=${CATALOG_PAGE_SIZE}&last=${encodeURIComponent(last)}`
      : `https://${registryServer}/v2/_catalog?n=${CATALOG_PAGE_SIZE}`;
    const ctx: CrawlAuthContext = { ...authCtx, repository: '' };
    const res = await fetchFn(url, { method: 'GET' }, ctx);
    if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    const page = (data.repositories ?? []) as string[];
    repos.push(...page);
    if (page.length < CATALOG_PAGE_SIZE) break;
    last = page[page.length - 1];
  }
  return repos;
}

/** Sort repos so oss/v2/ and oss/ namespaces come first. */
export function prioritizeRepos(repos: string[]): string[] {
  const priority: string[] = [];
  const rest: string[] = [];
  for (const repo of repos) {
    if (PRIORITY_PREFIXES.some((p) => repo.startsWith(p))) priority.push(repo);
    else rest.push(repo);
  }
  priority.sort((a, b) => {
    const aV2 = a.startsWith('oss/v2/') ? 0 : 1;
    const bV2 = b.startsWith('oss/v2/') ? 0 : 1;
    return aV2 !== bV2 ? aV2 - bV2 : a.localeCompare(b);
  });
  return [...priority, ...rest];
}

/** Deterministic hash for partitioning repos across workers. */
export function simpleHash(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) { hash = ((hash << 5) - hash) + s.charCodeAt(i); hash |= 0; }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Repository / tag processing
// ---------------------------------------------------------------------------

export class RateLimitError extends Error {
  retryAfter: number;
  constructor(retryAfter: number) { super(`Rate limited — retry after ${retryAfter}s`); this.name = 'RateLimitError'; this.retryAfter = retryAfter; }
}

interface RepoProcessResult { records: IndexRecord[]; eolRecords: EolRecord[]; lastProcessedTag: string; repoComplete: boolean; tagsProcessed: number; skippedRefs: number; }

/** Callback invoked after each tag is processed — allows the caller to upsert + save state per-tag */
type OnTagComplete = (tag: string, records: IndexRecord[], eolRecords: EolRecord[]) => Promise<void>;

async function processRepository(
  repo: string,
  authCtx: CrawlAuthContext,
  fetchFn: FetchFn,
  registryServer: string,
  registryId: string,
  deadline: number,
  digestSet: Set<string>,
  knownArtifactDigests: Set<string>,
  resumeFromTag?: string,
  onTagComplete?: OnTagComplete,
): Promise<RepoProcessResult> {
  const ctx: CrawlAuthContext = { ...authCtx, repository: repo };
  const records: IndexRecord[] = [];
  const eolRecords: EolRecord[] = [];
  let lastProcessedTag = '';
  let tagsProcessed = 0;
  let skippedRefs = 0;

  const tagsUrl = `https://${registryServer}/v2/${repo}/tags/list`;
  const tagsRes = await fetchFn(tagsUrl, { method: 'GET' }, ctx);
  if (tagsRes.status === 429) throw new RateLimitError(parseInt(tagsRes.headers.get('retry-after') ?? '10', 10));
  if (!tagsRes.ok) { console.warn(`[SBOM Crawl] Tags fetch for ${repo} returned ${tagsRes.status}, skipping`); return { records: [], eolRecords: [], lastProcessedTag: '', repoComplete: true, tagsProcessed: 0, skippedRefs: 0 }; }

  const tagsData = await tagsRes.json() as Record<string, unknown>;
  let tags: string[] = (tagsData.tags ?? []) as string[];
  if (tags.length === 0) return { records: [], eolRecords: [], lastProcessedTag: '', repoComplete: true, tagsProcessed: 0, skippedRefs: 0 };
  if (resumeFromTag) { const idx = tags.indexOf(resumeFromTag); if (idx >= 0) tags = tags.slice(idx + 1); }

  let timedOut = false;
  for (const tag of tags) {
    if (Date.now() > deadline) { timedOut = true; break; }
    try {
      const tagResult = await processTag(repo, tag, ctx, fetchFn, registryServer, registryId, deadline, digestSet, knownArtifactDigests);
      records.push(...tagResult.records);
      eolRecords.push(...tagResult.eolRecords);
      skippedRefs += tagResult.skippedRefs;
      tagsProcessed++;
      // Per-tag callback: always save progress, upsert packages only if found
      if (onTagComplete) {
        await onTagComplete(tag, tagResult.records, tagResult.eolRecords);
      }
    }
    catch (err) { if (err instanceof RateLimitError) throw err; console.warn(`[SBOM Crawl] Error processing ${repo}:${tag}:`, err); tagsProcessed++; }
    lastProcessedTag = tag;
  }
  return { records, eolRecords, lastProcessedTag, repoComplete: !timedOut, tagsProcessed, skippedRefs };
}

async function processTag(
  repo: string,
  tag: string,
  ctx: CrawlAuthContext,
  fetchFn: FetchFn,
  registryServer: string,
  registryId: string,
  deadline: number,
  digestSet: Set<string>,
  knownArtifactDigests: Set<string>,
): Promise<{ records: IndexRecord[]; eolRecords: EolRecord[]; skippedRefs: number }> {
  if (Date.now() > deadline) return { records: [], eolRecords: [], skippedRefs: 0 };
  const manifestUrl = `https://${registryServer}/v2/${repo}/manifests/${tag}`;
  const headRes = await fetchFn(manifestUrl, { method: 'HEAD', headers: { Accept: ['application/vnd.oci.image.index.v1+json', 'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json', 'application/vnd.docker.distribution.manifest.v2+json'].join(', ') } }, ctx);
  if (headRes.status === 429) throw new RateLimitError(parseInt(headRes.headers.get('retry-after') ?? '10', 10));

  let digest = headRes.headers.get('Docker-Content-Digest');
  if (!digest && headRes.ok) {
    const getRes = await fetchFn(manifestUrl, { method: 'GET', headers: { Accept: 'application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json' } }, ctx);
    if (getRes.ok) { digest = getRes.headers.get('Docker-Content-Digest'); if (!digest) { const m = await getRes.json() as Record<string, Record<string, string>>; digest = m.config?.digest; } }
  }
  if (!digest) return { records: [], eolRecords: [], skippedRefs: 0 };
  if (digestSet.has(digest)) return { records: [], eolRecords: [], skippedRefs: 0 };
  digestSet.add(digest);
  if (Date.now() > deadline) return { records: [], eolRecords: [], skippedRefs: 0 };

  const records: IndexRecord[] = [];
  const eolRecords: EolRecord[] = [];
  let skippedRefs = 0;

  // Fetch ALL referrers (SBOMs + lifecycle), then split
  const allRefs = await fetchReferrers(repo, digest, ctx, fetchFn, registryServer);
  const sbomRefs = allRefs.filter(r => isSbomArtifact(r.artifactType));
  const lifecycleRefs = allRefs.filter(r => isLifecycleArtifact(r.artifactType));

  // Process lifecycle (EOL) referrers — skip if artifact digest is already known
  for (const lcRef of lifecycleRefs) {
    if (Date.now() > deadline) break;
    if (knownArtifactDigests.has(lcRef.digest)) { skippedRefs++; continue; }
    try {
      const eolDate = await fetchEolDate(repo, lcRef.digest, ctx, fetchFn, registryServer);
      if (eolDate) {
        eolRecords.push({ registryId, repo, tag, digest, eolDate, artifactDigest: lcRef.digest });
        knownArtifactDigests.add(lcRef.digest);
        console.log(`[EOL Crawl] Found EOL ${eolDate} for ${repo}:${tag}`);
      }
    } catch (err) { if (err instanceof RateLimitError) throw err; }
  }

  // Process SBOM referrers — skip if artifact digest is already known
  const newSbomRefs = sbomRefs.filter(r => !knownArtifactDigests.has(r.digest));
  skippedRefs += sbomRefs.length - newSbomRefs.length;
  if (newSbomRefs.length > 0) {
    console.log(`[SBOM Crawl] Found ${newSbomRefs.length} new SBOM(s) for ${repo}:${tag} (${sbomRefs.length - newSbomRefs.length} skipped, index digest: ${digest.slice(0, 20)}...)`);
    for (const sbomRef of newSbomRefs) {
      if (Date.now() > deadline) break;
      try {
        const packages = await parseSbomBlob(repo, sbomRef.digest, ctx, fetchFn, registryServer);
        if (packages.length > 0) {
          records.push({ blobDigest: sbomRef.digest, repo, tag, registryServer, registryId, packages, timestamp: new Date().toISOString() });
          knownArtifactDigests.add(sbomRef.digest);
        }
      } catch (err) { if (err instanceof RateLimitError) throw err; console.warn(`[SBOM Crawl] Error parsing SBOM ${sbomRef.digest} for ${repo}:${tag}:`, err); }
    }
  }

  // Drill into platform manifests if no new SBOMs found at the top level
  // Also skip drill-down if all top-level referrers were already known (nothing new to find at platform level)
  const allTopLevelKnown = sbomRefs.length > 0 && newSbomRefs.length === 0;
  if (records.length === 0 && !allTopLevelKnown && Date.now() <= deadline) {
    try {
      const indexRes = await fetchFn(manifestUrl, { method: 'GET', headers: { Accept: ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'].join(', ') } }, ctx);
      if (indexRes.ok) {
        const indexData = await indexRes.json() as Record<string, unknown>;
        const platformManifests = (indexData.manifests ?? []) as Array<{ digest: string }>;
        if (platformManifests.length > 0 && platformManifests.length <= 20) {
          for (const pm of platformManifests) {
            if (Date.now() > deadline) break;
            if (!pm.digest || digestSet.has(pm.digest)) continue;
            digestSet.add(pm.digest);
            const pmAllRefs = await fetchReferrers(repo, pm.digest, ctx, fetchFn, registryServer);
            const pmSbomRefs = pmAllRefs.filter(r => isSbomArtifact(r.artifactType));
            const pmLifecycleRefs = pmAllRefs.filter(r => isLifecycleArtifact(r.artifactType));

            // Platform-level EOL — skip known
            for (const lcRef of pmLifecycleRefs) {
              if (Date.now() > deadline) break;
              if (knownArtifactDigests.has(lcRef.digest)) { skippedRefs++; continue; }
              try {
                const eolDate = await fetchEolDate(repo, lcRef.digest, ctx, fetchFn, registryServer);
                if (eolDate && !eolRecords.some(e => e.repo === repo && e.tag === tag)) {
                  eolRecords.push({ registryId, repo, tag, digest: pm.digest, eolDate, artifactDigest: lcRef.digest });
                  knownArtifactDigests.add(lcRef.digest);
                  console.log(`[EOL Crawl] Found EOL ${eolDate} for ${repo}:${tag} (platform)`);
                }
              } catch (err) { if (err instanceof RateLimitError) throw err; }
            }

            // Platform-level SBOMs — skip known
            const pmNewSbomRefs = pmSbomRefs.filter(r => !knownArtifactDigests.has(r.digest));
            skippedRefs += pmSbomRefs.length - pmNewSbomRefs.length;
            if (pmNewSbomRefs.length > 0) {
              console.log(`[SBOM Crawl] Found ${pmNewSbomRefs.length} new SBOM(s) for ${repo}:${tag} (platform digest: ${pm.digest.slice(0, 20)}...)`);
              for (const sbomRef of pmNewSbomRefs) {
                if (Date.now() > deadline) break;
                try {
                  const packages = await parseSbomBlob(repo, sbomRef.digest, ctx, fetchFn, registryServer);
                  if (packages.length > 0) {
                    records.push({ blobDigest: sbomRef.digest, repo, tag, registryServer, registryId, packages, timestamp: new Date().toISOString() });
                    knownArtifactDigests.add(sbomRef.digest);
                  }
                } catch (err) { if (err instanceof RateLimitError) throw err; console.warn(`[SBOM Crawl] Error parsing platform SBOM ${sbomRef.digest}:`, err); }
              }
            }
          }
        }
      }
    } catch (err) { if (err instanceof RateLimitError) throw err; }
  }
  return { records, eolRecords, skippedRefs };
}

async function fetchReferrers(
  repo: string,
  digest: string,
  ctx: CrawlAuthContext,
  fetchFn: FetchFn,
  registryServer: string,
): Promise<Array<{ digest: string; artifactType?: string }>> {
  try {
    const url = `https://${registryServer}/v2/${repo}/referrers/${digest}`;
    const res = await fetchFn(url, { method: 'GET', headers: { Accept: 'application/vnd.oci.image.index.v1+json' } }, ctx);
    if (res.status === 429) throw new RateLimitError(parseInt(res.headers.get('retry-after') ?? '10', 10));
    if (!res.ok) return [];
    const data = await res.json() as Record<string, unknown>;
    return (data.manifests ?? []) as Array<{ artifactType?: string; digest: string }>;
  } catch (err) { if (err instanceof RateLimitError) throw err; return []; }
}

/**
 * Fetch the EOL date from a lifecycle artifact manifest's annotations.
 * Returns the ISO date string or null if not found.
 */
async function fetchEolDate(
  repo: string,
  artifactDigest: string,
  ctx: CrawlAuthContext,
  fetchFn: FetchFn,
  registryServer: string,
): Promise<string | null> {
  const url = `https://${registryServer}/v2/${repo}/manifests/${artifactDigest}`;
  const res = await fetchFn(url, { method: 'GET', headers: { Accept: 'application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json,application/json' } }, ctx);
  if (res.status === 429) throw new RateLimitError(parseInt(res.headers.get('retry-after') ?? '10', 10));
  if (!res.ok) return null;
  const manifest = await res.json() as Record<string, Record<string, string>>;
  const annotations = manifest.annotations;
  if (!annotations) return null;
  const eolDate = annotations[LIFECYCLE_EOL_ANNOTATION_KEY];
  return eolDate || null;
}

// ---------------------------------------------------------------------------
// SBOM blob fetch + parse
// ---------------------------------------------------------------------------

async function parseSbomBlob(
  repo: string,
  artifactDigest: string,
  ctx: CrawlAuthContext,
  fetchFn: FetchFn,
  registryServer: string,
): Promise<SbomPackage[]> {
  const manifestUrl = `https://${registryServer}/v2/${repo}/manifests/${artifactDigest}`;
  const mRes = await fetchFn(manifestUrl, { method: 'GET', headers: { Accept: 'application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json,application/json' } }, ctx);
  if (mRes.status === 429) throw new RateLimitError(parseInt(mRes.headers.get('retry-after') ?? '10', 10));
  if (!mRes.ok) throw new Error(`Manifest fetch ${mRes.status}`);

  const manifest = await mRes.json() as Record<string, Array<{ digest: string }>>;
  const blobArray = manifest.layers ?? manifest.blobs;
  if (!blobArray?.length) { console.warn(`[SBOM Crawl] parseSbomBlob: No layers/blobs for ${repo}@${artifactDigest.slice(0, 20)}...`); return []; }

  const blobDigest = blobArray[0].digest;
  const blobUrl = `https://${registryServer}/v2/${repo}/blobs/${blobDigest}`;
  const bRes = await fetchFn(blobUrl, { method: 'GET', headers: { Accept: '*/*' } }, ctx);
  if (bRes.status === 429) throw new RateLimitError(parseInt(bRes.headers.get('retry-after') ?? '10', 10));
  if (!bRes.ok) throw new Error(`Blob fetch ${bRes.status}`);

  const rawBytes = Buffer.from(await bRes.arrayBuffer());
  let blobText: string;
  if (rawBytes.length >= 2 && rawBytes[0] === 0x1f && rawBytes[1] === 0x8b) {
    const zlib = await import('zlib');
    blobText = zlib.gunzipSync(rawBytes).toString('utf-8');
  } else {
    blobText = rawBytes.toString('utf-8');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sbomJson: Record<string, any>;
  try { sbomJson = JSON.parse(blobText); } catch { console.warn(`[SBOM Crawl] JSON parse failed for ${repo}@${artifactDigest.slice(0, 20)}...`); return []; }

  // Unwrap in-toto envelope
  if (sbomJson._type && sbomJson.predicate && typeof sbomJson.predicate === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sbomJson = sbomJson.predicate as Record<string, any>;
  }

  const formatInfo = detectSbomFormat(sbomJson);
  const topLevelKeys = Object.keys(sbomJson);
  let packageArray = sbomJson[formatInfo.arrayKey];

  if (!Array.isArray(packageArray)) {
    for (const key of ['packages', 'components', '@graph', 'dependencies', 'artifacts', 'elements']) {
      if (Array.isArray(sbomJson[key]) && sbomJson[key].length > 0) {
        packageArray = sbomJson[key];
        if (key === 'components') formatInfo.format = 'cyclonedx';
        else if (key === '@graph') formatInfo.format = 'spdx-3.0';
        break;
      }
    }
  }
  if (!Array.isArray(packageArray)) {
    for (const key of topLevelKeys) {
      const val = sbomJson[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        for (const sub of ['packages', 'components', '@graph']) {
          if (Array.isArray(val[sub]) && val[sub].length > 0) {
            packageArray = val[sub];
            if (sub === 'components') formatInfo.format = 'cyclonedx';
            else if (sub === '@graph') formatInfo.format = 'spdx-3.0';
            break;
          }
        }
        if (Array.isArray(packageArray)) break;
      }
    }
  }
  if (!Array.isArray(packageArray)) { console.warn(`[SBOM Crawl] No package array for ${repo}@${artifactDigest.slice(0, 20)}...`); return []; }

  const extractor = getExtractor(formatInfo.format);
  const packages: SbomPackage[] = [];
  for (const raw of packageArray) { try { const pkg = extractor(raw); if (pkg) packages.push(pkg); } catch { /* skip */ } }
  if (packages.length > 0) console.log(`[SBOM Crawl] Parsed ${packages.length} packages from ${repo}@${artifactDigest.slice(0, 20)}... (${formatInfo.format})`);
  return packages;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getExtractor(format: SbomFormatInfo['format']): (raw: any) => SbomPackage | null {
  switch (format) {
    case 'spdx-2.3': return extractSpdx23Package;
    case 'spdx-3.0': return extractSpdx30Package;
    case 'cyclonedx': return extractCycloneDxComponent;
  }
}
