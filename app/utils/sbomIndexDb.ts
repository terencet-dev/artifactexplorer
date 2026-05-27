/**
 * IndexedDB persistence layer for the SBOM package index.
 *
 * Stores parsed SBOM data (from both the pre-built Vercel Blob index and
 * on-demand client-side crawls) in the browser so searches are instant.
 *
 * Object stores:
 *   `sbomRecords`  – keyed by `{registryId}:{blobDigest}`, each record
 *                    holds an array of packages + provenance metadata.
 *   `indexMeta`    – keyed by `registryId`, tracks blob version and stats.
 *
 * This module runs **client-side only**.
 */

import type { SbomPackage } from '@/app/types/registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SbomRecord {
  /** Compound key: `<registryId>:<blobDigest>` */
  id: string;
  blobDigest: string;
  repo: string;
  tag: string;
  registryServer: string;
  registryId: string;
  packages: SbomPackage[];
  /** ISO timestamp — when this record was stored */
  timestamp: string;
  /** Optional EOL date for the tag (future use) */
  eolDate?: string;
}

export interface IndexMeta {
  registryId: string;
  /** Version hash of the blob we loaded (matches /api/sbom-index/meta) */
  version: string;
  /** ISO timestamp — when the blob was loaded into IDB */
  lastLoaded: string;
  /** Total number of sbomRecord entries for this registry */
  recordCount: number;
  /** Total number of packages across all records */
  packageCount: number;
}

export interface SbomSearchMatch {
  package: SbomPackage;
  repo: string;
  tag: string;
  registryServer: string;
  registryId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = 'artifact-explorer-sbom-index';
const DB_VERSION = 1;
const STORE_RECORDS = 'sbomRecords';
const STORE_META    = 'indexMeta';

// ---------------------------------------------------------------------------
// DB lifecycle
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        const store = db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
        store.createIndex('registryId', 'registryId', { unique: false });
        store.createIndex('repo', 'repo', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'registryId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Records CRUD
// ---------------------------------------------------------------------------

/** Insert or overwrite a single SBOM record. */
export async function putSbomRecord(record: SbomRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RECORDS, 'readwrite');
    tx.objectStore(STORE_RECORDS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Fetch a record by its compound key. */
export async function getSbomRecord(id: string): Promise<SbomRecord | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RECORDS, 'readonly');
    const req = tx.objectStore(STORE_RECORDS).get(id);
    req.onsuccess = () => resolve(req.result as SbomRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

/** Check if a record exists for a given blob digest within a registry. */
export async function hasSbomRecord(
  registryId: string,
  blobDigest: string,
): Promise<boolean> {
  const rec = await getSbomRecord(`${registryId}:${blobDigest}`);
  return !!rec;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

type SearchField = 'name' | 'namespace' | 'version' | 'publisher' | 'purl' | 'license' | 'all';

/** Structured filter: field:value pairs parsed from search query. */
export interface ParsedSearchQuery {
  /** The plain text portion (no field: prefix) */
  text: string;
  /** The field to apply `text` to (from the dropdown) */
  field: SearchField;
  /** Additional field:value refinements parsed from the query */
  filters: Array<{ field: Exclude<SearchField, 'all'>; value: string }>;
}

/**
 * Parse a search query that may contain `field:value` pairs.
 * E.g. "azure name:cert publisher:microsoft" → text="azure", filters=[{name,cert},{publisher,microsoft}]
 */
export function parseSearchQuery(raw: string, defaultField: SearchField): ParsedSearchQuery {
  type FieldKey = Exclude<SearchField, 'all'>;
  const VALID_FIELDS = new Set<FieldKey>(['name', 'namespace', 'version', 'publisher', 'purl', 'license']);
  const filters: Array<{ field: FieldKey; value: string }> = [];
  const textParts: string[] = [];

  // Match field:value or field:"value with spaces"
  const tokenRegex = /(\w+):(?:"([^"]+)"|(\S+))/g;
  let remaining = raw;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(raw)) !== null) {
    const fieldName = match[1].toLowerCase() as FieldKey;
    const value = match[2] ?? match[3]; // quoted or unquoted
    if (VALID_FIELDS.has(fieldName) && value) {
      filters.push({ field: fieldName, value: value.toLowerCase() });
      remaining = remaining.replace(match[0], '');
    }
  }

  // What's left after removing field:value tokens is the plain text search
  const text = remaining.trim().replace(/\s+/g, ' ');

  return { text, field: defaultField, filters };
}

/**
 * Search all indexed SBOM packages matching a query string.
 * Supports structured `field:value` filters in the query.
 */
export async function searchPackages(
  query: string,
  field: SearchField = 'all',
  registryId?: string,
): Promise<SbomSearchMatch[]> {
  const db = await openDb();

  const parsed = parseSearchQuery(query, field);
  const lowerQ = parsed.text.toLowerCase().trim();

  // Must have either plain text or structured filters
  if (!lowerQ && parsed.filters.length === 0) return [];

  const matches: SbomSearchMatch[] = [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RECORDS, 'readonly');
    const store = tx.objectStore(STORE_RECORDS);

    const source = registryId
      ? store.index('registryId').openCursor(IDBKeyRange.only(registryId))
      : store.openCursor();

    source.onsuccess = () => {
      const cursor = source.result;
      if (!cursor) {
        resolve(matches);
        return;
      }

      const record = cursor.value as SbomRecord;
      for (const pkg of record.packages) {
        // Check plain text portion against the selected field
        const textMatches = !lowerQ || matchesPackage(pkg, lowerQ, parsed.field);

        // Check structured field:value filters
        // Same-field filters use OR logic (e.g. publisher:microsoft publisher:github)
        // Different fields use AND logic (e.g. publisher:microsoft version:3.0)
        let filtersMatch = true;
        if (parsed.filters.length > 0) {
          // Group filters by field
          const groups = new Map<string, string[]>();
          for (const f of parsed.filters) {
            const existing = groups.get(f.field) ?? [];
            existing.push(f.value);
            groups.set(f.field, existing);
          }
          // AND across fields, OR within same field
          for (const [field, values] of groups) {
            const fieldVal = (pkg[field as Exclude<SearchField, 'all'>] ?? '').toLowerCase();
            const anyMatch = values.some((v) => fieldVal.includes(v));
            if (!anyMatch) {
              filtersMatch = false;
              break;
            }
          }
        }

        if (textMatches && filtersMatch) {
          matches.push({
            package: pkg,
            repo: record.repo,
            tag: record.tag,
            registryServer: record.registryServer,
            registryId: record.registryId,
          });
        }
      }
      cursor.continue();
    };

    source.onerror = () => reject(source.error);
  });
}

function matchesPackage(
  pkg: SbomPackage,
  lowerQ: string,
  field: SearchField,
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
  return (pkg[field] ?? '').toLowerCase().includes(lowerQ);
}


