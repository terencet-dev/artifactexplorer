/**
 * SBOM index cron crawl route — Vercel adapter.
 *
 * POST /api/sbom-index/crawl
 *
 * Thin adapter that delegates to the shared crawl engine.
 * Called by Vercel Cron (every 2 min) or externally via authenticated POST.
 *
 * When SBOM_CRAWL_PROVIDER=azure, returns 200 immediately (~0ms compute).
 * The Vercel cron still fires (it's in vercel.json) but does zero work.
 * To eliminate even that, remove the "crons" block from vercel.json.
 *
 * Security: Requires `Authorization: Bearer <CRON_SECRET>` header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDbAvailable } from '@/app/utils/sbomDb';
import { authenticatedFetch, type AuthContext } from '@/app/api/registry/auth';
import { runCrawl, type CrawlAuthContext, type FetchFn } from '@/app/lib/crawlEngine';

export const maxDuration = 300;

const TIMEOUT_BUFFER_MS = 10_000;

export async function GET(request: NextRequest) { return handleCrawl(request); }
export async function POST(request: NextRequest) { return handleCrawl(request); }

async function handleCrawl(request: NextRequest) {
  // OSS-safe gate: crawling is opt-in. Set CRAWL_ENABLED=true to enable.
  // This prevents forks from accidentally hammering upstream registries when
  // a default Vercel cron block is added without further configuration.
  if (process.env.CRAWL_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'Crawling is disabled. Set CRAWL_ENABLED=true to enable.', status: 'disabled' },
      { status: 503 },
    );
  }

  // If crawl is delegated to Azure Functions, short-circuit immediately
  const crawlProvider = process.env.SBOM_CRAWL_PROVIDER?.toLowerCase();
  if (crawlProvider === 'azure') {
    return NextResponse.json({ message: 'Crawl delegated to Azure Functions', provider: 'azure' });
  }

  if (!isDbAvailable()) {
    return NextResponse.json({ error: 'SBOM indexing is not configured. Set DATABASE_URL to enable.' }, { status: 503 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Parse partition params from query string
  const partitionParam = request.nextUrl.searchParams.get('partition');
  const ofParam = request.nextUrl.searchParams.get('of');
  const partitionIdx = partitionParam !== null ? parseInt(partitionParam, 10) : -1;
  const numPartitions = ofParam !== null ? Math.max(1, parseInt(ofParam, 10)) : 1;
  const partition = (partitionIdx >= 0 && numPartitions > 1)
    ? { index: partitionIdx, total: numPartitions }
    : undefined;

  // Bridge authenticatedFetch (Next.js-aware, supports cookies) to CrawlAuthContext
  const fetchFn: FetchFn = (url, options, ctx) => {
    const authCtx: AuthContext = {
      registry: ctx.registry,
      registryId: ctx.registryId,
      repository: ctx.repository,
      credentials: ctx.credentials,
    };
    return authenticatedFetch(url, options, authCtx);
  };

  const result = await runCrawl({
    fetchFn,
    deadlineMs: Date.now() + maxDuration * 1000 - TIMEOUT_BUFFER_MS,
    partition,
  });

  if (result.status === 'error') {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result);
}
