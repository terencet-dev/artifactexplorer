/**
 * PostgreSQL client for SBOM search.
 *
 * Works with Supabase, Azure Database for PostgreSQL, or any PostgreSQL 14+ instance.
 * All queries use parameterized placeholders ($1, $2, …) to prevent SQL injection.
 * Connection is lazy-initialized from DATABASE_URL.
 * Tables are created by the docs/schema.sql migration (not auto-created here).
 *
 * SSL configuration:
 *   - DATABASE_SSL_CA set         → strict SSL with provided CA certificate (Azure PG)
 *   - DATABASE_SSL_MODE=disable   → no SSL (local development)
 *   - Otherwise                   → SSL with rejectUnauthorized: false (Supabase default)
 */

import { Pool, type PoolClient } from 'pg';
import type { SbomPackage } from '@/app/types/registry';

// ---------------------------------------------------------------------------
// Connection pool (lazy singleton)
// ---------------------------------------------------------------------------

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    pool = new Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000, // Kill any query running > 30s
      ssl: resolveSslConfig(),
    });
  }
  return pool;
}

/**
 * Resolve SSL configuration based on environment variables.
 *
 * - DATABASE_SSL_CA set         → strict SSL with provided CA cert (Azure PG)
 * - DATABASE_SSL_MODE=disable   → no SSL (local dev)
 * - Otherwise                   → rejectUnauthorized: false (Supabase default — do not change without testing)
 */
function resolveSslConfig(): false | { rejectUnauthorized: boolean; ca?: string } {
  if (process.env.DATABASE_SSL_MODE === 'disable') {
    return false;
  }
  if (process.env.DATABASE_SSL_CA) {
    return { ca: process.env.DATABASE_SSL_CA, rejectUnauthorized: true };
  }
  // Default: Supabase and most hosted PG providers work with this.
  return { rejectUnauthorized: false };
}

export function isDbAvailable(): boolean {
  return !!process.env.DATABASE_URL;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Matches the existing client-side SbomSearchMatch type exactly. */
export interface SbomSearchMatch {
  package: SbomPackage;
  repo: string;
  tag: string;
  registryServer: string;
  registryId: string;
}

/** Record produced by the crawl — same as the crawl route's IndexRecord. */
export interface IndexRecord {
  blobDigest: string;
  repo: string;
  tag: string;
  registryServer: string;
  registryId: string;
  packages: SbomPackage[];
  timestamp: string;
  eolDate?: string;
}

export interface CrawlState {
  id: string;
  registryId: string;
  registryServer: string;
  status: 'idle' | 'crawling' | 'complete';
  totalRepos: number;
  reposScanned: number;
  tagsScanned: number;
  sbomsFound: number;
  packagesIndexed: number;
  lastRepo: string;
  lastTag: string;
  lastRepoComplete: boolean;
  currentBatch: number;
  processedDigests: string[];
  startedAt: string;
  lastRunAt: string;
  errorCount: number;
  lastError: string | null;
  indexVersion: string | null;
}

// ---------------------------------------------------------------------------
// Package upsert — called after parsing SBOMs for a repo
// ---------------------------------------------------------------------------

/**
 * Bulk-upsert packages from crawl IndexRecords into sbom_packages.
 * Deduplicates by (registry_id, repo, sample_tag, name, version, purl).
 * On conflict, updates updated_at timestamp.
 */
export async function upsertPackages(records: IndexRecord[]): Promise<number> {
  if (records.length === 0) return 0;

  const pool = getPool();
  let inserted = 0;
  const CHUNK_SIZE = 50;

  // Flatten all packages from all records, deduplicating by (registryId, repo, tag, name, version, purl)
  // to avoid "ON CONFLICT DO UPDATE command cannot affect row a second time" error
  const seen = new Set<string>();
  const allRows: Array<{ registryId: string; repo: string; pkg: SbomPackage; tag: string; blobDigest: string }> = [];

  for (const rec of records) {
    for (const pkg of rec.packages) {
      const key = `${rec.registryId}|${rec.repo}|${rec.tag}|${pkg.name || ''}|${pkg.version || ''}|${pkg.purl || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        allRows.push({ registryId: rec.registryId, repo: rec.repo, pkg, tag: rec.tag, blobDigest: rec.blobDigest });
      }
    }
  }

  // Insert in chunks
  for (let chunkStart = 0; chunkStart < allRows.length; chunkStart += CHUNK_SIZE) {
    const chunk = allRows.slice(chunkStart, chunkStart + CHUNK_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const row of chunk) {
      placeholders.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`,
      );
      values.push(
        row.registryId,
        row.repo,
        row.pkg.name || '',
        row.pkg.namespace || '',
        row.pkg.version || '',
        row.pkg.publisher || '',
        row.pkg.purl || '',
        row.pkg.license || '',
        row.tag,
        row.blobDigest,
      );
    }

    const sql = `
      INSERT INTO sbom_packages (registry_id, repo, name, namespace, version, publisher, purl, license, sample_tag, blob_digest)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (registry_id, repo, sample_tag, name, version, purl)
      DO UPDATE SET
        updated_at = now()
    `;

    try {
      await pool.query(sql, values);
      inserted += chunk.length;
    } catch (err) {
      console.warn(`[SBOM DB] Chunk insert failed (non-fatal, ${chunk.length} packages):`, err instanceof Error ? err.message : err);
    }
  }

  return inserted;
}

// ---------------------------------------------------------------------------
// Search — called by /api/sbom-index/search
// ---------------------------------------------------------------------------

type SearchField = 'name' | 'namespace' | 'version' | 'publisher' | 'purl' | 'license' | 'all';

export interface SearchStats {
  estimatedTotal: number;
  repoCount: number;
  tagCount: number;
  isEstimate: boolean;
}

export async function searchPackages(
  query: string,
  field: SearchField = 'all',
  registryId?: string,
  repoFilter?: string,
  tagFilter?: string,
  limit = 50,
  offset = 0,
  sort?: string,
  order?: 'asc' | 'desc',
): Promise<{ results: SbomSearchMatch[]; total: number; stats?: SearchStats }> {
  const pool = getPool();

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  // Parse field:value syntax from query
  const { text, filters } = parseSearchQuery(query, field);

  // Track search strategy for 'all' field queries.
  // Uses UNION ALL across trigram-indexed columns (name, namespace, purl) for speed,
  // with auto-detection for version-like queries (exact match on btree index).
  let useUnionSearch = false;
  let unionSearchTerm = '';
  let searchVersion = false;    // search version column (exact match)

  // Free-text search
  if (text.trim()) {
    if (field === 'all') {
      const trimmed = text.trim();
      // Auto-detect query type for smarter routing
      const looksLikePurl = trimmed.startsWith('pkg:') || trimmed.includes('@sha256:') || trimmed.startsWith('oci/');
      const looksLikeVersion = /^\d+[\.\-\d]/.test(trimmed);

      useUnionSearch = true;
      unionSearchTerm = `%${trimmed}%`;
      searchVersion = looksLikeVersion && !looksLikePurl;
    } else {
      conditions.push(`${sanitizeFieldName(field)} ILIKE $${paramIdx}`);
      params.push(`%${text.trim()}%`);
      paramIdx++;
    }
  }

  // Structured field:value filters
  for (const f of filters) {
    conditions.push(`${sanitizeFieldName(f.field)} ILIKE $${paramIdx}`);
    params.push(`%${f.value}%`);
    paramIdx++;
  }

  // Registry filter
  if (registryId) {
    conditions.push(`registry_id = $${paramIdx}`);
    params.push(registryId);
    paramIdx++;
  }

  // Repo filter — use exact match if it looks like a full path (contains /), ILIKE for partial
  if (repoFilter?.trim()) {
    if (repoFilter.includes('/')) {
      conditions.push(`repo = $${paramIdx}`);
      params.push(repoFilter.trim());
    } else {
      conditions.push(`repo ILIKE $${paramIdx}`);
      params.push(`%${repoFilter.trim()}%`);
    }
    paramIdx++;
  }

  // Tag filter — use exact match (fast, indexed) for full tag names, ILIKE for partial
  if (tagFilter?.trim()) {
    if (tagFilter.includes('.') || tagFilter.includes('-') || tagFilter.startsWith('v')) {
      // Looks like a full tag (e.g., v0.40.0-8) — exact match
      conditions.push(`sample_tag = $${paramIdx}`);
      params.push(tagFilter.trim());
    } else {
      conditions.push(`sample_tag ILIKE $${paramIdx}`);
      params.push(`%${tagFilter.trim()}%`);
    }
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Map sort field to SQL column (whitelist to prevent injection)
  const sbomSortMap: Record<string, string> = {
    name: 'name', namespace: 'namespace', version: 'version',
    publisher: 'publisher', purl: 'purl', license: 'license',
    repo: 'repo', tag: 'sample_tag',
  };
  const sortCol = sbomSortMap[sort ?? ''] ?? 'name';
  const sortDir = order === 'desc' ? 'DESC' : 'ASC';

  const orderClause = `ORDER BY ${sortCol} ${sortDir}, repo ASC`;
  const cols = 'registry_id, repo, sample_tag, name, namespace, version, publisher, purl, license';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dataResult: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let countResult: any = null;

  if (useUnionSearch) {
    // UNION ALL search across all trigram-indexed columns: name, namespace, purl.
    // Each arm is capped by an inner LIMIT to keep each column scan fast.
    // Auto-detects version/PURL queries for additional search arms.
    const searchParamIdx = paramIdx;
    params.push(unionSearchTerm);
    paramIdx++;

    const otherConditions = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';

    const innerLimitIdx = paramIdx;
    params.push(limit + offset + 1);
    paramIdx++;

    // Always search name, namespace, purl — all have trigram GIN indexes
    // Each arm is wrapped in parens so LIMIT applies per-arm (required by PostgreSQL UNION grammar)
    const arms = [
      `(SELECT ${cols} FROM sbom_packages WHERE name ILIKE $${searchParamIdx}${otherConditions} LIMIT $${innerLimitIdx})`,
      `(SELECT ${cols} FROM sbom_packages WHERE namespace ILIKE $${searchParamIdx}${otherConditions} LIMIT $${innerLimitIdx})`,
      `(SELECT ${cols} FROM sbom_packages WHERE purl ILIKE $${searchParamIdx}${otherConditions} LIMIT $${innerLimitIdx})`,
    ];

    // Optionally search version with exact match (btree index)
    let versionParamIdx: number | null = null;
    if (searchVersion) {
      versionParamIdx = paramIdx;
      params.push(unionSearchTerm.slice(1, -1)); // strip % wildcards for exact match
      paramIdx++;
      arms.push(`(SELECT ${cols} FROM sbom_packages WHERE version = $${versionParamIdx}${otherConditions} LIMIT $${innerLimitIdx})`);
    }

    const dataQuery = `SELECT DISTINCT ${cols} FROM (${arms.join(' UNION ALL ')}) sub
      ${orderClause}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;

    // Count query: OR across the same columns (PostgreSQL can use BitmapOr across GIN indexes)
    let orClause = `(name ILIKE $${searchParamIdx} OR namespace ILIKE $${searchParamIdx} OR purl ILIKE $${searchParamIdx}`;
    if (versionParamIdx !== null) {
      orClause += ` OR version = $${versionParamIdx}`;
    }
    orClause += ')';
    const countQuery = `SELECT COUNT(*)::int AS total, COUNT(DISTINCT repo)::int AS repos, COUNT(DISTINCT sample_tag)::int AS tags FROM sbom_packages WHERE ${orClause}${otherConditions}`;
    const maxCountParamCount = versionParamIdx ?? searchParamIdx;
    const countParams = params.slice(0, maxCountParamCount);

    const countWithTimeout = (async () => {
      const client = await pool.connect();
      try {
        await client.query('SET statement_timeout = 45000');  // 45s — broad terms need time on modest Postgres tiers (Vercel maxDuration=60)
        return await client.query(countQuery, countParams);
      } catch { return null; }
      finally { client.release(); }
    })();

    [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, [...params, limit + 1, offset]),
      countWithTimeout,
    ]);
  } else {
    // Single-column or no text search — standard query.
    // Mirror the UNION path: wrap the inner SELECT with LIMIT to bound the sort,
    // give the count query a statement_timeout, and catch data-query failures so a
    // slow column (e.g. publisher/license without trigram index) degrades to empty
    // results instead of HTTP 500. Without the inner LIMIT, ORDER BY ${sortCol}
    // over millions of trigram-matched rows hits Postgres statement_timeout.
    const whereParamCount = paramIdx - 1; // SQL positions $1..$whereParamCount belong to WHERE
    const innerLimitIdx = paramIdx;
    params.push(limit + offset + 1);
    paramIdx++;

    const dataQuery = `SELECT ${cols} FROM (
         SELECT ${cols} FROM sbom_packages ${whereClause} LIMIT $${innerLimitIdx}
       ) sub
       ${orderClause}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;

    // Fast aggregate for non-UNION queries too — run with 45s timeout, return null on failure.
    const countQuery = `SELECT COUNT(*)::int AS total, COUNT(DISTINCT repo)::int AS repos, COUNT(DISTINCT sample_tag)::int AS tags FROM sbom_packages ${whereClause}`;
    const countParams = params.slice(0, whereParamCount);

    const countWithTimeout = (async () => {
      const client = await pool.connect();
      try {
        await client.query('SET statement_timeout = 45000');
        return await client.query(countQuery, countParams);
      } catch { return null; }
      finally { client.release(); }
    })();

    [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, [...params, limit + 1, offset]).catch((err) => {
        console.error('[SBOM Search] non-UNION data query error:', err);
        return { rows: [] };
      }),
      countWithTimeout,
    ]);
  }

  const hasMore = dataResult.rows.length > limit;
  const pageRows = hasMore ? dataResult.rows.slice(0, limit) : dataResult.rows;

  // Extract real counts from aggregate query
  const realTotal = countResult?.rows?.[0]?.total ?? -1;
  const realRepos = countResult?.rows?.[0]?.repos ?? -1;
  const realTags = countResult?.rows?.[0]?.tags ?? -1;

  const finalTotal = realTotal > 0 ? realTotal : (hasMore ? -2 : offset + pageRows.length);
  const stats: SearchStats = {
    estimatedTotal: realTotal > 0 ? realTotal : (hasMore ? -1 : offset + pageRows.length),
    repoCount: realRepos > 0 ? realRepos : -1,
    tagCount: realTags > 0 ? realTags : -1,
    isEstimate: realTotal <= 0, // Only estimate if aggregate failed
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: SbomSearchMatch[] = pageRows.map((row: any) => ({
    package: {
      type: '',
      name: row.name,
      namespace: row.namespace,
      version: row.version,
      publisher: row.publisher,
      purl: row.purl,
      license: row.license,
    },
    repo: row.repo,
    tag: row.sample_tag,
    registryServer: row.registry_server ?? process.env.CRAWL_DEFAULT_REGISTRY_SERVER ?? '',
    registryId: row.registry_id,
  }));

  return { results, total: finalTotal, stats };
}

/** Whitelist of valid column names to prevent SQL injection in ORDER BY / field references. */
function sanitizeFieldName(field: string): string {
  const allowed: Record<string, string> = {
    name: 'name',
    namespace: 'namespace',
    version: 'version',
    publisher: 'publisher',
    purl: 'purl',
    license: 'license',
  };
  return allowed[field] ?? 'name';
}

// ---------------------------------------------------------------------------
// Query parsing (same logic as sbomIndexDb.ts parseSearchQuery)
// ---------------------------------------------------------------------------

interface ParsedSearchQuery {
  text: string;
  filters: Array<{ field: Exclude<SearchField, 'all'>; value: string }>;
}

function parseSearchQuery(raw: string, defaultField: SearchField): ParsedSearchQuery {
  type FieldKey = Exclude<SearchField, 'all'>;
  const VALID_FIELDS = new Set<FieldKey>(['name', 'namespace', 'version', 'publisher', 'purl', 'license']);
  const filters: Array<{ field: FieldKey; value: string }> = [];
  const textParts: string[] = [];

  // Match field:value or field:"quoted value"
  const tokenRegex = /(\w+):(?:"([^"]+)"|(\S+))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(raw)) !== null) {
    // Capture any text before this token
    const before = raw.slice(lastIndex, match.index).trim();
    if (before) textParts.push(before);
    lastIndex = match.index + match[0].length;

    const fieldName = match[1].toLowerCase() as FieldKey;
    const value = match[2] ?? match[3];

    if (VALID_FIELDS.has(fieldName) && value) {
      filters.push({ field: fieldName, value });
    } else {
      // Not a valid field — treat as text
      textParts.push(match[0]);
    }
  }

  // Remaining text after last token
  const remaining = raw.slice(lastIndex).trim();
  if (remaining) textParts.push(remaining);

  return { text: textParts.join(' '), filters };
}

// ---------------------------------------------------------------------------
// Stats — for meta endpoint
// ---------------------------------------------------------------------------

export async function getStats(registryId: string): Promise<{
  totalPackages: number;
  totalRepos: number;
  totalSboms: number;
}> {
  const pool = getPool();
  // Try materialized view first (fast), fall back to live query
  try {
    const mvResult = await pool.query(
      'SELECT total_packages, total_repos, total_sboms FROM sbom_stats WHERE registry_id = $1',
      [registryId],
    );
    if (mvResult.rows.length > 0) {
      const row = mvResult.rows[0];
      return { totalPackages: row.total_packages, totalRepos: row.total_repos, totalSboms: row.total_sboms };
    }
  } catch {
    // Materialized view may not exist on older schemas — fall through to live query
  }
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total_packages,
       COUNT(DISTINCT repo)::int AS total_repos,
       COUNT(DISTINCT blob_digest)::int AS total_sboms
     FROM sbom_packages
     WHERE registry_id = $1`,
    [registryId],
  );
  const row = result.rows[0];
  return {
    totalPackages: row?.total_packages ?? 0,
    totalRepos: row?.total_repos ?? 0,
    totalSboms: row?.total_sboms ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Crawl state — stored in crawl_state table
// ---------------------------------------------------------------------------

export function emptyCrawlState(id: string, registryServer: string): CrawlState {
  const registryId = id.replace(/-p\d+$/, '').replace(/-/g, '-');
  return {
    id,
    registryId,
    registryServer,
    status: 'idle',
    totalRepos: 0,
    reposScanned: 0,
    tagsScanned: 0,
    sbomsFound: 0,
    packagesIndexed: 0,
    lastRepo: '',
    lastTag: '',
    lastRepoComplete: true,
    currentBatch: 0,
    processedDigests: [],
    startedAt: '',
    lastRunAt: '',
    errorCount: 0,
    lastError: null,
    indexVersion: null,
  };
}

export async function getCrawlState(id: string): Promise<CrawlState | null> {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM crawl_state WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return rowToCrawlState(result.rows[0]);
}

/**
 * Get all crawl states for a registry (any partition count).
 */
export async function getAllCrawlStates(registryId: string): Promise<CrawlState[]> {
  const pool = getPool();
  const result = await pool.query(
    "SELECT * FROM crawl_state WHERE registry_id = $1 OR id = $1 ORDER BY id",
    [registryId],
  );
  return result.rows.map(rowToCrawlState);
}

export async function putCrawlState(state: CrawlState): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO crawl_state (
       id, registry_id, registry_server, status, total_repos, repos_scanned,
       tags_scanned, sboms_found, packages_indexed, last_repo, last_tag,
       last_repo_complete, current_batch, processed_digests, started_at,
       last_run_at, error_count, last_error, index_version, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now())
     ON CONFLICT (id) DO UPDATE SET
       status = $4, total_repos = $5, repos_scanned = $6,
       tags_scanned = $7, sboms_found = $8, packages_indexed = $9,
       last_repo = $10, last_tag = $11, last_repo_complete = $12,
       current_batch = $13, processed_digests = $14,
       started_at = $15, last_run_at = $16,
       error_count = $17, last_error = $18, index_version = $19,
       updated_at = now()`,
    [
      state.id,
      state.registryId,
      state.registryServer,
      state.status,
      state.totalRepos,
      state.reposScanned,
      state.tagsScanned,
      state.sbomsFound,
      state.packagesIndexed,
      state.lastRepo,
      state.lastTag,
      state.lastRepoComplete,
      state.currentBatch,
      [],  // Never persist processedDigests — prevents TOAST bloat (was 91 GB)
      state.startedAt || null,
      state.lastRunAt || null,
      state.errorCount,
      state.lastError,
      state.indexVersion,
    ],
  );
}

function rowToCrawlState(row: Record<string, unknown>): CrawlState {
  return {
    id: row.id as string,
    registryId: row.registry_id as string,
    registryServer: row.registry_server as string,
    status: row.status as CrawlState['status'],
    totalRepos: row.total_repos as number,
    reposScanned: row.repos_scanned as number,
    tagsScanned: row.tags_scanned as number,
    sbomsFound: row.sboms_found as number,
    packagesIndexed: row.packages_indexed as number,
    lastRepo: row.last_repo as string,
    lastTag: row.last_tag as string,
    lastRepoComplete: row.last_repo_complete as boolean,
    currentBatch: row.current_batch as number,
    processedDigests: (row.processed_digests as string[]) ?? [],
    startedAt: (row.started_at as string) ?? '',
    lastRunAt: (row.last_run_at as string) ?? '',
    errorCount: row.error_count as number,
    lastError: (row.last_error as string) ?? null,
    indexVersion: (row.index_version as string) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Distributed lock — stored in crawl_locks table
// ---------------------------------------------------------------------------

export async function acquireLock(partitionId: string, ttlMs: number): Promise<boolean> {
  const pool = getPool();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  // Delete any expired lock first
  await pool.query('DELETE FROM crawl_locks WHERE partition_id = $1 AND expires_at < now()', [partitionId]);

  // Try to insert lock
  try {
    await pool.query(
      'INSERT INTO crawl_locks (partition_id, locked_at, expires_at) VALUES ($1, now(), $2)',
      [partitionId, expiresAt],
    );
    return true;
  } catch {
    // Conflict — lock exists and not expired
    // Check if it's stale (older than TTL * 2)
    const result = await pool.query(
      'SELECT locked_at, expires_at FROM crawl_locks WHERE partition_id = $1',
      [partitionId],
    );
    if (result.rows.length > 0) {
      const lockAge = Date.now() - new Date(result.rows[0].locked_at as string).getTime();
      if (lockAge > ttlMs * 2) {
        // Stale lock — override
        console.log(`[SBOM Crawl] Stale lock found (${Math.round(lockAge / 1000)}s old), overriding`);
        await pool.query(
          'UPDATE crawl_locks SET locked_at = now(), expires_at = $2 WHERE partition_id = $1',
          [partitionId, expiresAt],
        );
        return true;
      }
    }
    return false;
  }
}

export async function releaseLock(partitionId: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM crawl_locks WHERE partition_id = $1', [partitionId]);
}

/**
 * Renew (extend) an existing lock's TTL.
 * Returns true if the lock was successfully renewed, false if it no longer exists.
 */
export async function renewLock(partitionId: string, ttlMs: number): Promise<boolean> {
  const pool = getPool();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const result = await pool.query(
    'UPDATE crawl_locks SET expires_at = $2 WHERE partition_id = $1',
    [partitionId, expiresAt],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// EOL annotations — stored in eol_annotations table
// ---------------------------------------------------------------------------

export interface EolRecord {
  registryId: string;
  repo: string;
  tag: string;
  digest: string;
  eolDate: string;       // ISO date string
  artifactDigest: string;
}

export interface EolSearchMatch {
  registryId: string;
  repo: string;
  tag: string;
  digest: string;
  eolDate: string;
  daysUntil: number;
  status: 'expired' | 'warning' | 'upcoming';
}

/**
 * Check if the eol_annotations table exists in the database.
 * Result is cached for the lifetime of this process.
 */
let _eolTableAvailable: boolean | null = null;
export async function isEolTableAvailable(): Promise<boolean> {
  if (_eolTableAvailable !== null) return _eolTableAvailable;
  try {
    const pool = getPool();
    const result = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'eol_annotations' LIMIT 1",
    );
    _eolTableAvailable = result.rows.length > 0;
  } catch {
    _eolTableAvailable = false;
  }
  return _eolTableAvailable;
}

/**
 * Bulk-upsert EOL annotations discovered during crawl.
 * On conflict, updates the eol_date (it may have been revised).
 */
export async function upsertEolAnnotations(records: EolRecord[]): Promise<number> {
  if (records.length === 0) return 0;
  if (!(await isEolTableAvailable())) return 0;

  const pool = getPool();
  let inserted = 0;

  for (const rec of records) {
    try {
      await pool.query(
        `INSERT INTO eol_annotations (registry_id, repo, tag, digest, eol_date, artifact_digest)
         VALUES ($1, $2, $3, $4, $5::date, $6)
         ON CONFLICT (registry_id, repo, tag, digest)
         DO UPDATE SET eol_date = $5::date, artifact_digest = $6, updated_at = now()`,
        [rec.registryId, rec.repo, rec.tag, rec.digest, rec.eolDate, rec.artifactDigest],
      );
      inserted++;
    } catch (err) {
      console.warn(`[EOL DB] Upsert failed for ${rec.repo}:${rec.tag} (non-fatal):`, err instanceof Error ? err.message : err);
    }
  }
  return inserted;
}

/**
 * Search EOL annotations with date-based filtering.
 */
export async function searchEolAnnotations(options: {
  registryId: string;
  status?: 'expired' | 'warning' | 'upcoming' | 'all';
  from?: string;
  to?: string;
  repo?: string;
  sort?: 'repo' | 'tag' | 'eolDate' | 'status';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}): Promise<{ results: EolSearchMatch[]; total: number }> {
  if (!(await isEolTableAvailable())) return { results: [], total: 0 };

  const pool = getPool();
  const { registryId, status = 'all', from, to, repo, sort = 'eolDate', order = 'asc', limit = 50, offset = 0 } = options;

  const conditions: string[] = ['registry_id = $1'];
  const params: unknown[] = [registryId];
  let paramIdx = 2;

  if (status === 'expired') {
    conditions.push(`eol_date < CURRENT_DATE`);
  } else if (status === 'warning') {
    conditions.push(`eol_date >= CURRENT_DATE AND eol_date <= CURRENT_DATE + 30`);
  } else if (status === 'upcoming') {
    conditions.push(`eol_date > CURRENT_DATE`);
  }

  if (from) {
    conditions.push(`eol_date >= $${paramIdx}::date`);
    params.push(from);
    paramIdx++;
  }
  if (to) {
    conditions.push(`eol_date <= $${paramIdx}::date`);
    params.push(to);
    paramIdx++;
  }
  if (repo?.trim()) {
    conditions.push(`repo ILIKE $${paramIdx}`);
    params.push(`%${repo.trim()}%`);
    paramIdx++;
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM eol_annotations ${where}`,
    params,
  );
  const total = countResult.rows[0]?.total ?? 0;

  // Map sort field to SQL column (whitelist to prevent injection)
  const sortColumnMap: Record<string, string> = {
    repo: 'repo',
    tag: 'tag',
    eolDate: 'eol_date',
    status: 'eol_date', // status is derived from eol_date, so sort by date
  };
  const sortColumn = sortColumnMap[sort] ?? 'eol_date';
  const sortDirection = order === 'desc' ? 'DESC' : 'ASC';

  const dataParams = [...params, limit, offset];
  const dataResult = await pool.query(
    `SELECT registry_id, repo, tag, digest, eol_date,
            (eol_date - CURRENT_DATE)::int AS days_until
     FROM eol_annotations ${where}
     ORDER BY ${sortColumn} ${sortDirection}, repo ASC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    dataParams,
  );

  const results: EolSearchMatch[] = dataResult.rows.map((row) => {
    const daysUntil = row.days_until as number;
    let eolStatus: EolSearchMatch['status'];
    if (daysUntil < 0) eolStatus = 'expired';
    else if (daysUntil <= 30) eolStatus = 'warning';
    else eolStatus = 'upcoming';

    return {
      registryId: row.registry_id as string,
      repo: row.repo as string,
      tag: row.tag as string,
      digest: row.digest as string,
      eolDate: (row.eol_date as Date).toISOString().split('T')[0],
      daysUntil,
      status: eolStatus,
    };
  });

  return { results, total };
}

/**
 * Get EOL annotation counts by status for a registry.
 */
export async function getEolStats(registryId: string): Promise<{
  expired: number;
  warning: number;
  upcoming: number;
  total: number;
}> {
  if (!(await isEolTableAvailable())) return { expired: 0, warning: 0, upcoming: 0, total: 0 };

  const pool = getPool();
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE eol_date < CURRENT_DATE)::int AS expired,
       COUNT(*) FILTER (WHERE eol_date >= CURRENT_DATE AND eol_date <= CURRENT_DATE + 30)::int AS warning,
       COUNT(*) FILTER (WHERE eol_date > CURRENT_DATE + 30)::int AS upcoming,
       COUNT(*)::int AS total
     FROM eol_annotations
     WHERE registry_id = $1`,
    [registryId],
  );
  const row = result.rows[0];
  return {
    expired: row?.expired ?? 0,
    warning: row?.warning ?? 0,
    upcoming: row?.upcoming ?? 0,
    total: row?.total ?? 0,
  };
}

/**
 * Batch lookup EOL annotations for a set of (repo, tag) pairs.
 * Used to cross-reference SBOM search results with EOL data.
 */
export async function batchGetEolForTags(
  registryId: string,
  repoTagPairs: Array<{ repo: string; tag: string }>,
): Promise<Map<string, { eolDate: string; status: 'expired' | 'warning' | 'upcoming' }>> {
  if (repoTagPairs.length === 0 || !(await isEolTableAvailable())) return new Map();

  const pool = getPool();
  const result = new Map<string, { eolDate: string; status: 'expired' | 'warning' | 'upcoming' }>();

  // Build IN clause
  const values: unknown[] = [registryId];
  const tuples: string[] = [];
  let paramIdx = 2;
  for (const { repo, tag } of repoTagPairs) {
    tuples.push(`($${paramIdx}, $${paramIdx + 1})`);
    values.push(repo, tag);
    paramIdx += 2;
  }

  const rows = await pool.query(
    `SELECT repo, tag, eol_date, (eol_date - CURRENT_DATE)::int AS days_until
     FROM eol_annotations
     WHERE registry_id = $1 AND (repo, tag) IN (${tuples.join(', ')})`,
    values,
  );

  for (const row of rows.rows) {
    const key = `${row.repo}|${row.tag}`;
    const daysUntil = row.days_until as number;
    const status = daysUntil < 0 ? 'expired' : daysUntil <= 30 ? 'warning' : 'upcoming';
    result.set(key, { eolDate: (row.eol_date as Date).toISOString().split('T')[0], status });
  }

  return result;
}

/**
 * Refresh the sbom_stats materialized view.
 * Called after a crawl cycle completes. Non-fatal if view doesn't exist.
 */
export async function refreshSbomStats(): Promise<void> {
  try {
    const pool = getPool();
    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY sbom_stats');
  } catch {
    // View may not exist on older schemas — non-fatal
  }
}

/**
 * Load all known SBOM + EOL artifact digests from the database.
 * Used by the delta crawl to skip re-processing unchanged referrers.
 * Can be slow on large tables when blob_digest has no dedicated index.
 * Called once per partition at crawl start.
 */
/**
 * Load known artifact digests for a single repo.
 * Uses the idx_sbom_repo_tag index — fast (~10-50ms per repo).
 * Returns SBOM blob_digest + EOL artifact_digest values as a Set.
 */
export async function getKnownArtifactDigestsForRepo(registryId: string, repo: string): Promise<Set<string>> {
  const pool = getPool();
  const digests = new Set<string>();

  try {
    // SBOM artifact digests — hits idx_sbom_repo_tag index
    const sbomResult = await pool.query(
      'SELECT DISTINCT blob_digest FROM sbom_packages WHERE registry_id = $1 AND repo = $2 AND blob_digest IS NOT NULL',
      [registryId, repo],
    );
    for (const row of sbomResult.rows) {
      if (row.blob_digest) digests.add(row.blob_digest as string);
    }

    // EOL artifact digests
    const eolAvailable = await isEolTableAvailable();
    if (eolAvailable) {
      const eolResult = await pool.query(
        'SELECT DISTINCT artifact_digest FROM eol_annotations WHERE registry_id = $1 AND repo = $2 AND artifact_digest IS NOT NULL',
        [registryId, repo],
      );
      for (const row of eolResult.rows) {
        if (row.artifact_digest) digests.add(row.artifact_digest as string);
      }
    }
  } catch (err) {
    console.warn(`[SBOM DB] Failed to load known digests for ${repo} (non-fatal):`, err instanceof Error ? err.message : err);
  }

  return digests;
}

/**
 * Get real-time row count from pg_class (updated by autovacuum).
 * Fast (~1ms) and accurate within a few percent during active writes.
 */
export async function getPackageCount(): Promise<number> {
  const pool = getPool();
  const result = await pool.query(
    "SELECT reltuples::bigint AS count FROM pg_class WHERE relname = 'sbom_packages'",
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Exact COUNT for a search query. Can be slow (10-30s) on broad queries.
 * Used by the countOnly=true API mode for progressive loading.
 */
export async function exactSearchCount(
  query: string,
  field: 'name' | 'namespace' | 'version' | 'publisher' | 'purl' | 'license' | 'all' = 'all',
  registryId?: string,
  repoFilter?: string,
  tagFilter?: string,
): Promise<number> {
  const pool = getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  const { text, filters } = parseSearchQuery(query, field);

  let useUnionCount = false;
  let unionCountTerm = '';

  if (text.trim()) {
    if (field === 'all') {
      // UNION count using name trigram index (fast, covers most searches)
      useUnionCount = true;
      unionCountTerm = `%${text.trim()}%`;
    } else {
      conditions.push(`${sanitizeFieldName(field)} ILIKE $${paramIdx}`);
      params.push(`%${text.trim()}%`);
      paramIdx++;
    }
  }

  for (const f of filters) {
    conditions.push(`${sanitizeFieldName(f.field)} ILIKE $${paramIdx}`);
    params.push(`%${f.value}%`);
    paramIdx++;
  }

  if (registryId) {
    conditions.push(`registry_id = $${paramIdx}`);
    params.push(registryId);
    paramIdx++;
  }

  if (repoFilter?.trim()) {
    if (repoFilter.includes('/')) {
      conditions.push(`repo = $${paramIdx}`);
    } else {
      conditions.push(`repo ILIKE $${paramIdx}`);
      params.push(`%${repoFilter.trim()}%`);
      paramIdx++;
      // Fix: skip push for exact match
    }
    if (repoFilter.includes('/')) {
      params.push(repoFilter.trim());
      paramIdx++;
    }
  }

  if (tagFilter?.trim()) {
    if (tagFilter.includes('.') || tagFilter.includes('-') || tagFilter.startsWith('v')) {
      conditions.push(`sample_tag = $${paramIdx}`);
      params.push(tagFilter.trim());
    } else {
      conditions.push(`sample_tag ILIKE $${paramIdx}`);
      params.push(`%${tagFilter.trim()}%`);
    }
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Use a dedicated client with statement_timeout to avoid holding pool connections
  // for minutes on broad queries. Falls back to -1 if the count doesn't finish in 15s.
  const client = await pool.connect();
  try {
    await client.query('SET statement_timeout = 15000');

    let sql: string;
    let countParams: unknown[];

    if (useUnionCount) {
      // Count using name ILIKE (trigram indexed, fast)
      const searchParamIdx = paramIdx;
      const countParamsArr = [...params, unionCountTerm];
      const otherConditions = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
      sql = `SELECT COUNT(*)::int AS total FROM sbom_packages WHERE (name ILIKE $${searchParamIdx} OR namespace ILIKE $${searchParamIdx} OR purl ILIKE $${searchParamIdx})${otherConditions}`;
      countParams = countParamsArr;
    } else {
      sql = `SELECT COUNT(*)::int AS total FROM sbom_packages ${whereClause}`;
      countParams = params;
    }

    const result = await client.query(sql, countParams);
    return result.rows[0]?.total ?? 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('statement timeout') || msg.includes('canceling statement')) {
      return -1; // Timed out — caller should keep the estimate
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Batch check which (repo, tag) pairs have SBOMs in sbom_packages.
 * Returns a Set of "repo|tag" keys that have at least one SBOM package.
 */
export async function batchCheckSbomsExist(
  registryId: string,
  repoTagPairs: Array<{ repo: string; tag: string }>,
): Promise<Set<string>> {
  if (repoTagPairs.length === 0) return new Set();

  const pool = getPool();
  const result = new Set<string>();

  const values: unknown[] = [registryId];
  const tuples: string[] = [];
  let paramIdx = 2;
  for (const { repo, tag } of repoTagPairs) {
    tuples.push(`($${paramIdx}, $${paramIdx + 1})`);
    values.push(repo, tag);
    paramIdx += 2;
  }

  const rows = await pool.query(
    `SELECT DISTINCT repo, sample_tag AS tag
     FROM sbom_packages
     WHERE registry_id = $1 AND (repo, sample_tag) IN (${tuples.join(', ')})`,
    values,
  );

  for (const row of rows.rows) {
    result.add(`${row.repo}|${row.tag}`);
  }

  return result;
}
