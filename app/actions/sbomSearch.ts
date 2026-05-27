'use server';

/**
 * Lightweight server actions for bulk SBOM discovery.
 *
 * Used by the client-side on-demand crawl hook (`useSbomCrawl`) for
 * private/authenticated registries. These are slimmed-down versions of
 * the full `discoverReferrers` in the tag-detail actions — they skip
 * tree-string generation and return only what the crawl needs.
 *
 * Server actions bypass the client-side 10s throttle because they call
 * registries directly with `fetch()`.
 */

import { cookies } from 'next/headers';
import { isSbomArtifact } from '@/app/utils/constants';
import type { Referrer } from '@/app/types/registry';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SbomReferrerResult {
  success: boolean;
  referrers: Referrer[];
  digest?: string;
  error?: string;
  retryAfter?: number;
}

/**
 * Discover only SBOM referrers for a single tag.
 *
 * Performs: HEAD manifest → GET referrers → filter isSbomArtifact.
 * Returns a lightweight result with no tree formatting.
 */
export async function discoverSbomReferrers(
  registry: string,
  repository: string,
  tag: string,
  registryId: string,
  credentials?: { username?: string; password?: string },
): Promise<SbomReferrerResult> {
  try {
    let apiRegistry = registry;
    let apiRepo = repository;
    if (registry === 'docker.io' || registry === 'registry.hub.docker.com') {
      apiRegistry = 'registry-1.docker.io';
      if (!repository.includes('/')) apiRepo = `library/${repository}`;
    }

    // 1. HEAD manifest → get digest
    const manifestUrl = `https://${apiRegistry}/v2/${apiRepo}/manifests/${tag}`;
    const headRes = await makeAuthFetch(
      manifestUrl,
      {
        method: 'HEAD',
        headers: {
          Accept: [
            'application/vnd.oci.image.manifest.v1+json',
            'application/vnd.docker.distribution.manifest.v2+json',
            'application/vnd.docker.distribution.manifest.list.v2+json',
          ].join(','),
        },
      },
      apiRegistry,
      registryId,
      apiRepo,
      credentials,
    );

    if (headRes.status === 429) {
      return {
        success: false,
        referrers: [],
        retryAfter: parseInt(headRes.headers.get('retry-after') ?? '10', 10),
      };
    }

    let digest = headRes.headers.get('Docker-Content-Digest');

    if (!digest && headRes.ok) {
      const getRes = await makeAuthFetch(
        manifestUrl,
        {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json',
          },
        },
        apiRegistry,
        registryId,
        apiRepo,
        credentials,
      );
      if (getRes.ok) {
        digest = getRes.headers.get('Docker-Content-Digest');
        if (!digest) {
          const m = await getRes.json();
          digest = m.config?.digest;
        }
      }
    }

    if (!digest) {
      return { success: false, referrers: [], error: 'No digest for tag' };
    }

    // 2. GET referrers → filter SBOM
    const refUrl = `https://${apiRegistry}/v2/${apiRepo}/referrers/${digest}`;
    const refRes = await makeAuthFetch(
      refUrl,
      {
        method: 'GET',
        headers: { Accept: 'application/vnd.oci.image.index.v1+json' },
      },
      apiRegistry,
      registryId,
      apiRepo,
      credentials,
    );

    if (refRes.status === 429) {
      return {
        success: false,
        referrers: [],
        retryAfter: parseInt(refRes.headers.get('retry-after') ?? '10', 10),
      };
    }

    if (!refRes.ok) {
      // 404/501/405 → registry doesn't support referrers
      if ([404, 501, 405].includes(refRes.status)) {
        return { success: true, referrers: [], digest };
      }
      return { success: false, referrers: [], error: `Referrers ${refRes.status}` };
    }

    const data = await refRes.json();
    const manifests = data.manifests ?? [];
    const sbomRefs: Referrer[] = manifests.filter((m: Record<string, unknown>) =>
      isSbomArtifact(m.artifactType as string | undefined),
    );

    return { success: true, referrers: sbomRefs, digest };
  } catch (err) {
    return {
      success: false,
      referrers: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fetch the tag list for a repository (server-side, bypasses client throttle).
 */
export async function bulkGetTags(
  registry: string,
  repository: string,
  registryId: string,
  credentials?: { username?: string; password?: string },
): Promise<{ success: boolean; tags: string[]; error?: string; retryAfter?: number }> {
  try {
    let apiRegistry = registry;
    let apiRepo = repository;
    if (registry === 'docker.io' || registry === 'registry.hub.docker.com') {
      apiRegistry = 'registry-1.docker.io';
      if (!repository.includes('/')) apiRepo = `library/${repository}`;
    }

    const url = `https://${apiRegistry}/v2/${apiRepo}/tags/list`;
    const res = await makeAuthFetch(
      url,
      { method: 'GET' },
      apiRegistry,
      registryId,
      apiRepo,
      credentials,
    );

    if (res.status === 429) {
      return {
        success: false,
        tags: [],
        retryAfter: parseInt(res.headers.get('retry-after') ?? '10', 10),
      };
    }

    if (!res.ok) {
      return { success: false, tags: [], error: `Tags fetch ${res.status}` };
    }

    const data = await res.json();
    return { success: true, tags: data.tags ?? [] };
  } catch (err) {
    return {
      success: false,
      tags: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Auth helpers (slim versions — same strategy as tag-detail actions.ts)
// ---------------------------------------------------------------------------

async function makeAuthFetch(
  url: string,
  options: RequestInit,
  registry: string,
  registryId: string,
  repository: string,
  credentials?: { username?: string; password?: string },
): Promise<Response> {
  const headers = await resolveHeaders(registry, registryId, repository, credentials);
  const merged = { ...options, headers: { ...(options.headers as Record<string, string>), ...headers } };

  const res = await fetch(url, merged);

  if (res.status === 401) {
    const wwwAuth = res.headers.get('www-authenticate');
    if (wwwAuth) {
      const tokenHeaders = await handleChallenge(wwwAuth, registry, registryId, repository, credentials);
      if (tokenHeaders) {
        return fetch(url, {
          ...options,
          headers: { ...(options.headers as Record<string, string>), ...tokenHeaders },
        });
      }
    }
  }
  return res;
}

async function resolveHeaders(
  registry: string,
  registryId: string,
  repository: string,
  credentials?: { username?: string; password?: string },
): Promise<Record<string, string>> {
  if (credentials?.username && credentials?.password) {
    return basic(credentials.username, credentials.password);
  }

  try {
    const cookieStore = await cookies();
    const c = cookieStore.get(`registry-creds-${registryId}`);
    if (c?.value) {
      const p = JSON.parse(decodeURIComponent(c.value));
      if (p.username && p.password) return basic(p.username, p.password);
    }
  } catch { /* ok */ }

  const san = registryId.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
  const eU = process.env[`REGISTRY_${san}_USERNAME`] ?? process.env['REGISTRY_USERNAME'];
  const eP = process.env[`REGISTRY_${san}_PASSWORD`] ?? process.env['REGISTRY_PASSWORD'];
  if (eU && eP) return basic(eU, eP);

  // Docker Hub anonymous token
  if (registry === 'registry-1.docker.io' || registry === 'docker.io') {
    try {
      const scope = `repository:${repository}:pull`;
      const tRes = await fetch(`https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(scope)}`);
      if (tRes.ok) {
        const d = await tRes.json();
        if (d.token) return { Authorization: `Bearer ${d.token}` };
      }
    } catch { /* ok */ }
  }

  return {};
}

async function handleChallenge(
  header: string,
  registry: string,
  registryId: string,
  repository: string,
  credentials?: { username?: string; password?: string },
): Promise<Record<string, string> | null> {
  const realm = header.match(/realm="([^"]+)"/)?.[1];
  const service = header.match(/service="([^"]+)"/)?.[1];
  let scope = header.match(/scope="([^"]+)"/)?.[1];

  if (!realm) {
    if (header.includes('Basic')) {
      const c = await resolveCreds(registryId, credentials);
      if (c) return basic(c.username, c.password);
    }
    return null;
  }

  if (!scope) scope = `repository:${repository}:pull`;
  const tokenUrl = new URL(realm);
  if (service) tokenUrl.searchParams.set('service', service);
  tokenUrl.searchParams.set('scope', scope);

  const tokenHeaders: Record<string, string> = {};
  const c = await resolveCreds(registryId, credentials);
  if (c) {
    tokenHeaders['Authorization'] = `Basic ${Buffer.from(`${c.username}:${c.password}`).toString('base64')}`;
  }

  const tRes = await fetch(tokenUrl.toString(), { headers: tokenHeaders });
  if (!tRes.ok) return null;

  const data = await tRes.json();
  const token = data.token ?? data.access_token;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

async function resolveCreds(
  registryId: string,
  credentials?: { username?: string; password?: string },
): Promise<{ username: string; password: string } | null> {
  if (credentials?.username && credentials?.password) {
    return { username: credentials.username, password: credentials.password };
  }
  try {
    const cookieStore = await cookies();
    const c = cookieStore.get(`registry-creds-${registryId}`);
    if (c?.value) {
      const p = JSON.parse(decodeURIComponent(c.value));
      if (p.username && p.password) return p;
    }
  } catch { /* ok */ }

  const san = registryId.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
  const eU = process.env[`REGISTRY_${san}_USERNAME`] ?? process.env['REGISTRY_USERNAME'];
  const eP = process.env[`REGISTRY_${san}_PASSWORD`] ?? process.env['REGISTRY_PASSWORD'];
  if (eU && eP) return { username: eU, password: eP };

  return null;
}

function basic(u: string, p: string): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` };
}
