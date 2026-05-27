/**
 * Environment-variable-only authenticated fetch for Azure Functions.
 *
 * Port of app/api/registry/auth.ts without the `cookies()` import from
 * `next/headers`. Resolves credentials only from:
 *   1. AuthContext.credentials (passed directly)
 *   2. REGISTRY_<SANITIZED_ID>_USERNAME / PASSWORD env vars
 *   3. REGISTRY_USERNAME / REGISTRY_PASSWORD env vars (fallback)
 *   4. Docker Hub anonymous token exchange
 *   5. Anonymous (no auth)
 *
 * Handles 401 → Bearer token exchange (same flow as the Next.js version).
 */

import type { CrawlAuthContext, FetchFn } from '@/app/lib/crawlEngine';

const PER_REQUEST_TIMEOUT_MS = 30_000; // 30s per HTTP request — prevents MCR hangs

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a FetchFn that resolves credentials from env vars only (no cookies).
 */
export function createRegistryFetch(): FetchFn {
  return async (url: string, options: RequestInit, ctx: CrawlAuthContext): Promise<Response> => {
    const authHeaders = resolveAuthHeaders(ctx);
    const mergedHeaders: Record<string, string> = {
      ...(options.headers as Record<string, string> ?? {}),
      ...authHeaders,
    };

    const response = await fetch(url, { ...options, headers: mergedHeaders, signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS) });

    // 401 → try token exchange
    if (response.status === 401) {
      const wwwAuth = response.headers.get('www-authenticate');
      if (wwwAuth) {
        const tokenHeaders = await handleAuthChallenge(wwwAuth, ctx);
        if (tokenHeaders) {
          const retryHeaders = {
            ...(options.headers as Record<string, string> ?? {}),
            ...tokenHeaders,
          };
          return fetch(url, { ...options, headers: retryHeaders, signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS) });
        }
      }
    }

    return response;
  };
}

// ---------------------------------------------------------------------------
// Credential resolution (env vars only — no cookies)
// ---------------------------------------------------------------------------

function resolveAuthHeaders(ctx: CrawlAuthContext): Record<string, string> {
  // 1. Direct credentials
  if (ctx.credentials?.username && ctx.credentials?.password) {
    return basicHeader(ctx.credentials.username, ctx.credentials.password);
  }

  // 2. Environment variables (registry-specific then generic)
  const sanitized = ctx.registryId.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
  const envUser =
    process.env[`REGISTRY_${sanitized}_USERNAME`] ??
    process.env['REGISTRY_USERNAME'];
  const envPass =
    process.env[`REGISTRY_${sanitized}_PASSWORD`] ??
    process.env['REGISTRY_PASSWORD'];
  if (envUser && envPass) {
    return basicHeader(envUser, envPass);
  }

  // 3. Docker Hub anonymous token
  if (isDockerHub(ctx.registry)) {
    // Docker Hub token exchange is async — handled in the 401 challenge flow instead
    return {};
  }

  return {}; // anonymous
}

function resolveCredentials(ctx: CrawlAuthContext): { username: string; password: string } | null {
  if (ctx.credentials?.username && ctx.credentials?.password) {
    return { username: ctx.credentials.username, password: ctx.credentials.password };
  }

  const sanitized = ctx.registryId.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
  const envUser =
    process.env[`REGISTRY_${sanitized}_USERNAME`] ??
    process.env['REGISTRY_USERNAME'];
  const envPass =
    process.env[`REGISTRY_${sanitized}_PASSWORD`] ??
    process.env['REGISTRY_PASSWORD'];
  if (envUser && envPass) return { username: envUser, password: envPass };

  return null;
}

// ---------------------------------------------------------------------------
// 401 challenge handling
// ---------------------------------------------------------------------------

async function handleAuthChallenge(
  header: string,
  ctx: CrawlAuthContext,
): Promise<Record<string, string> | null> {
  const realm = header.match(/realm="([^"]+)"/)?.[1];
  const service = header.match(/service="([^"]+)"/)?.[1];
  let scope = header.match(/scope="([^"]+)"/)?.[1];

  if (!realm) {
    if (header.includes('Basic')) {
      const creds = resolveCredentials(ctx);
      if (creds) return basicHeader(creds.username, creds.password);
    }
    return null;
  }

  if (!scope) {
    scope = `repository:${ctx.repository}:pull`;
  }

  const tokenUrl = new URL(realm);
  if (service) tokenUrl.searchParams.set('service', service);
  tokenUrl.searchParams.set('scope', scope);

  const tokenHeaders: Record<string, string> = {};
  const creds = resolveCredentials(ctx);
  if (creds) {
    tokenHeaders['Authorization'] = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`;
  }

  const tokenRes = await fetch(tokenUrl.toString(), { headers: tokenHeaders, signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS) });
  if (!tokenRes.ok) return null;

  const tokenData = await tokenRes.json() as Record<string, unknown>;
  const token = (tokenData.token ?? tokenData.access_token) as string | undefined;
  if (!token) return null;

  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basicHeader(user: string, pass: string): Record<string, string> {
  const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

function isDockerHub(registry: string): boolean {
  return (
    registry === 'docker.io' ||
    registry === 'registry.hub.docker.com' ||
    registry.endsWith('.docker.io')
  );
}
