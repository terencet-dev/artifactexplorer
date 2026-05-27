/**
 * Shared authentication utilities for registry API routes.
 *
 * Provides helpers that the blob parse / download routes can reuse so that
 * credential resolution, 401 → token exchange, Azure AD, and Docker Hub
 * anonymous flows are not duplicated across multiple route files.
 *
 * This module runs **server-side only** (API route / server action context).
 */

import { cookies } from 'next/headers';

export interface AuthContext {
  registry: string;        // e.g. "myregistry.azurecr.io"
  registryId: string;      // unique ID stored in the credential store / cookies
  repository: string;      // e.g. "myrepo/myimage"
  credentials?: {
    username?: string;
    password?: string;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an authorised `fetch` wrapper for a given registry context.
 * Handles initial auth headers, 401 challenges, token exchange, and retries.
 * Returns the final successful `Response` or throws on hard failure.
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit,
  ctx: AuthContext
): Promise<Response> {
  // Resolve initial auth headers
  const authHeaders = await resolveAuthHeaders(ctx);

  const mergedHeaders: Record<string, string> = {
    ...(options.headers as Record<string, string> ?? {}),
    ...authHeaders,
  };

  const response = await fetch(url, { ...options, headers: mergedHeaders });

  // If 401 returned, try the challenge → token exchange flow
  if (response.status === 401) {
    const wwwAuth = response.headers.get('www-authenticate');
    if (wwwAuth) {
      const tokenHeaders = await handleAuthChallenge(wwwAuth, ctx);
      if (tokenHeaders) {
        const retryHeaders = {
          ...(options.headers as Record<string, string> ?? {}),
          ...tokenHeaders,
        };
        return fetch(url, { ...options, headers: retryHeaders });
      }
    }
  }

  return response;
}

// ---------------------------------------------------------------------------
// Auth header resolution (same strategy as actions.ts getAuthHeaders)
// ---------------------------------------------------------------------------

async function resolveAuthHeaders(
  ctx: AuthContext
): Promise<Record<string, string>> {
  // 1. Direct credentials
  if (ctx.credentials?.username && ctx.credentials?.password) {
    return basicHeader(ctx.credentials.username, ctx.credentials.password);
  }

  // 2. Cookie credentials
  try {
    const cookieStore = await cookies();
    const cred = cookieStore.get(`registry-creds-${ctx.registryId}`);
    if (cred?.value) {
      const parsed = JSON.parse(decodeURIComponent(cred.value));
      if (parsed.username && parsed.password) {
        return basicHeader(parsed.username, parsed.password);
      }
    }
  } catch {
    // ignore — cookies may not be available in all contexts
  }

  // 3. Environment variables
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

  // 4. Docker Hub anonymous token
  if (isDockerHub(ctx.registry)) {
    try {
      const scope = `repository:${ctx.repository}:pull`;
      const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(scope)}`;
      const res = await fetch(tokenUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.token) return { Authorization: `Bearer ${data.token}` };
      }
    } catch {
      // fall through
    }
  }

  return {}; // anonymous
}

// ---------------------------------------------------------------------------
// 401 challenge handling
// ---------------------------------------------------------------------------

async function handleAuthChallenge(
  header: string,
  ctx: AuthContext
): Promise<Record<string, string> | null> {
  // Parse Bearer realm, service, scope
  const realm = header.match(/realm="([^"]+)"/)?.[1];
  const service = header.match(/service="([^"]+)"/)?.[1];
  let scope = header.match(/scope="([^"]+)"/)?.[1];

  if (!realm) {
    // Basic challenge — re-send credentials
    if (header.includes('Basic')) {
      const creds = await resolveCredentials(ctx);
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

  // Build token request with credentials
  const tokenHeaders: Record<string, string> = {};
  const creds = await resolveCredentials(ctx);
  if (creds) {
    tokenHeaders['Authorization'] = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`;
  }

  const tokenRes = await fetch(tokenUrl.toString(), { headers: tokenHeaders });
  if (!tokenRes.ok) return null;

  const tokenData = await tokenRes.json();
  const token = tokenData.token ?? tokenData.access_token;
  if (!token) return null;

  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveCredentials(
  ctx: AuthContext
): Promise<{ username: string; password: string } | null> {
  if (ctx.credentials?.username && ctx.credentials?.password) {
    return { username: ctx.credentials.username, password: ctx.credentials.password };
  }

  try {
    const cookieStore = await cookies();
    const cred = cookieStore.get(`registry-creds-${ctx.registryId}`);
    if (cred?.value) {
      const parsed = JSON.parse(decodeURIComponent(cred.value));
      if (parsed.username && parsed.password) {
        return { username: parsed.username, password: parsed.password };
      }
    }
  } catch {
    // ignore
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
