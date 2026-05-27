/**
 * Streaming SBOM blob download route.
 *
 * POST /api/registry/blob/download
 *
 * Self-contained: accepts the artifact digest, fetches the OCI manifest to
 * find the layer digest, then fetches the blob and pipes it directly to the
 * client. Zero buffering — works for any blob size.
 */

import { NextRequest } from 'next/server';
import { authenticatedFetch, type AuthContext } from '@/app/api/registry/auth';

export const maxDuration = 60;

interface DownloadRequestBody {
  registry: string;
  registryId: string;
  repositoryName: string;
  /** The artifact/referrer digest — route resolves the layer digest itself */
  artifactDigest: string;
  filename?: string;
  credentials?: { username?: string; password?: string };
}

export async function POST(request: NextRequest) {
  const body: DownloadRequestBody = await request.json();
  const { registry, registryId, repositoryName, artifactDigest, filename, credentials } = body;

  if (!registry || !repositoryName || !artifactDigest) {
    return new Response(
      JSON.stringify({ error: 'Missing required parameters' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Docker Hub special case
  let apiRegistry = registry;
  let apiRepo = repositoryName;
  if (registry === 'docker.io' || registry === 'registry.hub.docker.com') {
    apiRegistry = 'registry-1.docker.io';
    if (!repositoryName.includes('/')) {
      apiRepo = `library/${repositoryName}`;
    }
  }

  const authCtx: AuthContext = {
    registry: apiRegistry,
    registryId: registryId || registry,
    repository: apiRepo,
    credentials,
  };

  try {
    // Step 1: Fetch artifact manifest to get the layer digest
    const manifestUrl = `https://${apiRegistry}/v2/${apiRepo}/manifests/${artifactDigest}`;
    console.log(`[SBOM Download] Fetching manifest: ${manifestUrl}`);

    const manifestResponse = await authenticatedFetch(
      manifestUrl,
      {
        method: 'GET',
        headers: {
          Accept: [
            'application/vnd.oci.image.manifest.v1+json',
            'application/vnd.docker.distribution.manifest.v2+json',
            'application/json',
          ].join(','),
        },
      },
      authCtx
    );

    if (!manifestResponse.ok) {
      return new Response(
        JSON.stringify({ error: `Manifest fetch returned ${manifestResponse.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const manifest = await manifestResponse.json();

    if (!manifest.layers || !Array.isArray(manifest.layers) || manifest.layers.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Artifact manifest has no layers' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const blobDigest = manifest.layers[0].digest;
    console.log(`[SBOM Download] Layer digest: ${blobDigest}`);

    // Step 2: Fetch the blob and pipe directly to client
    const blobUrl = `https://${apiRegistry}/v2/${apiRepo}/blobs/${blobDigest}`;
    console.log(`[SBOM Download] Fetching blob: ${blobUrl}`);

    const blobResponse = await authenticatedFetch(
      blobUrl,
      { method: 'GET', headers: { Accept: '*/*' } },
      authCtx
    );

    if (!blobResponse.ok) {
      return new Response(
        JSON.stringify({ error: `Blob fetch returned ${blobResponse.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!blobResponse.body) {
      return new Response(
        JSON.stringify({ error: 'Empty response body from registry' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build response headers
    const downloadFilename = filename || `${repositoryName.replace(/\//g, '-')}-${artifactDigest.slice(0, 16)}.sbom.json`;
    const headers = new Headers();
    headers.set('Content-Disposition', `attachment; filename="${downloadFilename}"`);

    const ct = blobResponse.headers.get('content-type');
    headers.set('Content-Type', ct || 'application/octet-stream');

    const cl = blobResponse.headers.get('content-length');
    if (cl) headers.set('Content-Length', cl);

    headers.set('Cache-Control', 'no-cache');

    // Pipe directly — zero buffering
    return new Response(blobResponse.body, { headers });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: reason }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
