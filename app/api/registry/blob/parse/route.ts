/**
 * SBOM blob parse route.
 *
 * POST /api/registry/blob/parse
 *
 * Self-contained: accepts the artifact digest (referrer digest), fetches the
 * OCI manifest to find the layer digest, fetches the SBOM blob, parses it,
 * and streams extracted packages as NDJSON.
 *
 * This avoids a two-step server-action → API-route handoff that caused auth
 * inconsistencies between different auth mechanisms.
 */

import { NextRequest } from 'next/server';
import { authenticatedFetch, type AuthContext } from '@/app/api/registry/auth';
import {
  detectSbomFormat,
  extractSpdx23Package,
  extractSpdx30Package,
  extractCycloneDxComponent,
  type SbomFormatInfo,
} from '@/app/utils/sbomParser';
import type { SbomPackage } from '@/app/types/registry';

export const maxDuration = 60;

const TIMEOUT_BUFFER_MS = 5_000;

interface ParseRequestBody {
  registry: string;
  registryId: string;
  repositoryName: string;
  /** The artifact/referrer digest — route resolves the layer digest itself */
  artifactDigest: string;
  artifactType?: string;
  credentials?: { username?: string; password?: string };
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  let body: ParseRequestBody;
  try {
    body = await request.json();
  } catch {
    return ndjsonError('Invalid request body', 400);
  }

  const { registry, registryId, repositoryName, artifactDigest, credentials } = body;

  if (!registry || !repositoryName || !artifactDigest) {
    return ndjsonError('Missing required parameters (registry, repositoryName, artifactDigest)', 400);
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
    // ----- Step 1: Fetch artifact manifest to get the layer digest ----------
    const manifestUrl = `https://${apiRegistry}/v2/${apiRepo}/manifests/${artifactDigest}`;
    console.log(`[SBOM Parse] Fetching artifact manifest: ${manifestUrl}`);

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
      console.error(`[SBOM Parse] Manifest fetch returned ${manifestResponse.status}`);
      return ndjsonError(`Failed to fetch artifact manifest: ${manifestResponse.status}`, 502);
    }

    const manifest = await manifestResponse.json();
    console.log(`[SBOM Parse] Manifest keys: ${Object.keys(manifest).join(', ')}`);

    if (!manifest.layers || !Array.isArray(manifest.layers) || manifest.layers.length === 0) {
      console.error('[SBOM Parse] No layers in manifest:', JSON.stringify(manifest).substring(0, 500));
      return ndjsonError('Artifact manifest has no layers', 422);
    }

    const blobDigest = manifest.layers[0].digest;
    const layerMediaType = manifest.layers[0].mediaType || '';
    const layerSize = manifest.layers[0].size || 0;
    console.log(`[SBOM Parse] Layer digest: ${blobDigest} (mediaType: ${layerMediaType}, size: ${layerSize})`);

    // ----- Step 2: Fetch the actual SBOM blob --------------------------------
    const blobUrl = `https://${apiRegistry}/v2/${apiRepo}/blobs/${blobDigest}`;
    console.log(`[SBOM Parse] Fetching blob: ${blobUrl}`);

    const blobResponse = await authenticatedFetch(
      blobUrl,
      { method: 'GET', headers: { Accept: '*/*' } },
      authCtx
    );

    if (!blobResponse.ok) {
      console.error(`[SBOM Parse] Blob fetch returned ${blobResponse.status}`);
      return ndjsonError(`Blob fetch returned ${blobResponse.status}`, 502);
    }

    // ----- Step 3: Read + decode (handle gzip) -------------------------------
    let blobText: string;
    try {
      const rawBuffer = await blobResponse.arrayBuffer();
      const rawBytes = Buffer.from(rawBuffer);
      console.log(`[SBOM Parse] Raw blob: ${rawBytes.length} bytes`);

      // Check for gzip magic bytes (0x1f 0x8b)
      if (rawBytes.length >= 2 && rawBytes[0] === 0x1f && rawBytes[1] === 0x8b) {
        console.log('[SBOM Parse] Detected gzip, decompressing...');
        const zlib = await import('zlib');
        blobText = zlib.gunzipSync(rawBytes).toString('utf-8');
        console.log(`[SBOM Parse] Decompressed to ${blobText.length} bytes`);
      } else {
        blobText = rawBytes.toString('utf-8');
      }

      console.log(`[SBOM Parse] First 300 chars: ${blobText.substring(0, 300)}`);
    } catch (err) {
      console.error('[SBOM Parse] Failed to read blob:', err);
      return ndjsonError('Failed to read blob from registry', 502);
    }

    // ----- Step 4: Parse JSON ------------------------------------------------
    let sbomJson: Record<string, any>;
    try {
      sbomJson = JSON.parse(blobText);
    } catch {
      console.error('[SBOM Parse] JSON parse failed. First 500 chars:', blobText.substring(0, 500));
      return ndjsonError('SBOM blob is not valid JSON', 422);
    }
    blobText = ''; // free memory

    // ----- Step 5: Detect format + find the package array --------------------
    const formatInfo = detectSbomFormat(sbomJson);
    const topLevelKeys = Object.keys(sbomJson);
    console.log(`[SBOM Parse] Format: ${formatInfo.format}, key: ${formatInfo.arrayKey}`);
    console.log(`[SBOM Parse] Top-level keys: ${topLevelKeys.join(', ')}`);

    let packageArray = sbomJson[formatInfo.arrayKey];

    // Fallback: scan top-level keys for common package array names
    if (!Array.isArray(packageArray)) {
      console.warn(`[SBOM Parse] Key "${formatInfo.arrayKey}" not found or not array. Searching...`);
      for (const key of ['packages', 'components', '@graph', 'dependencies', 'artifacts', 'elements']) {
        if (Array.isArray(sbomJson[key]) && sbomJson[key].length > 0) {
          console.log(`[SBOM Parse] Found array at "${key}" with ${sbomJson[key].length} elements`);
          packageArray = sbomJson[key];
          if (key === 'components') formatInfo.format = 'cyclonedx';
          else if (key === '@graph') formatInfo.format = 'spdx-3.0';
          formatInfo.arrayKey = key;
          break;
        }
      }
    }

    // Deep search: one level down (e.g. sbom.packages, document.packages)
    if (!Array.isArray(packageArray)) {
      for (const key of topLevelKeys) {
        const val = sbomJson[key];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          for (const sub of ['packages', 'components', '@graph']) {
            if (Array.isArray(val[sub]) && val[sub].length > 0) {
              console.log(`[SBOM Parse] Found array at "${key}.${sub}" with ${val[sub].length} elements`);
              packageArray = val[sub];
              if (sub === 'components') formatInfo.format = 'cyclonedx';
              else if (sub === '@graph') formatInfo.format = 'spdx-3.0';
              formatInfo.arrayKey = `${key}.${sub}`;
              break;
            }
          }
          if (Array.isArray(packageArray)) break;
        }
      }
    }

    if (!Array.isArray(packageArray)) {
      const info = topLevelKeys.map(k => {
        const v = sbomJson[k];
        if (Array.isArray(v)) return `${k}(arr:${v.length})`;
        if (v && typeof v === 'object') return `${k}({${Object.keys(v).slice(0, 5).join(',')}})`;
        return `${k}(${typeof v})`;
      }).join(', ');
      console.error(`[SBOM Parse] No package array found. Structure: ${info}`);
      return ndjsonError(`No package array found in SBOM. Structure: ${info}`, 422);
    }

    console.log(`[SBOM Parse] Processing ${packageArray.length} elements`);

    // ----- Step 6: Stream NDJSON output --------------------------------------
    const effectiveTimeout = maxDuration * 1000 - TIMEOUT_BUFFER_MS;
    const extractor = getExtractor(formatInfo.format);

    const outputStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const emit = (obj: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        };

        emit({
          meta: true,
          format: formatInfo.format,
          documentName: formatInfo.documentName,
          totalPackages: packageArray.length,
          layerSize,
        });

        let packagesStreamed = 0;
        const BATCH_SIZE = 200;

        const processBatch = (startIdx: number) => {
          const endIdx = Math.min(startIdx + BATCH_SIZE, packageArray.length);

          for (let i = startIdx; i < endIdx; i++) {
            if (Date.now() - startTime > effectiveTimeout) {
              emit({ partial: true, reason: 'timeout', packagesStreamed });
              controller.close();
              return;
            }
            try {
              const pkg = extractor(packageArray[i]);
              if (pkg) {
                emit(pkg as unknown as Record<string, unknown>);
                packagesStreamed++;
              }
            } catch {
              // skip malformed entries
            }
          }

          if (endIdx < packageArray.length) {
            setTimeout(() => processBatch(endIdx), 0);
          } else {
            controller.close();
          }
        };

        processBatch(0);
      },
    });

    return new Response(outputStream, {
      headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
    });
  } catch (error) {
    console.error('[SBOM Parse] Unexpected error:', error);
    return ndjsonError(error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

// ---------------------------------------------------------------------------
function ndjsonError(reason: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: true, reason }) + '\n',
    { status, headers: { 'Content-Type': 'application/x-ndjson' } }
  );
}

function getExtractor(format: SbomFormatInfo['format']): (raw: any) => SbomPackage | null {
  switch (format) {
    case 'spdx-2.3': return extractSpdx23Package;
    case 'spdx-3.0': return extractSpdx30Package;
    case 'cyclonedx': return extractCycloneDxComponent;
  }
}
