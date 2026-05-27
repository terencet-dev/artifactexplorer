/**
 * SBOM package search API.
 *
 * GET /api/sbom-index/search?q=openssl&field=name&repo=cilium&tag=1.14&limit=50&offset=0
 *
 * Server-side search against PostgreSQL. Returns paginated results.
 * Requires DATABASE_URL environment variable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { searchPackages, exactSearchCount, batchGetEolForTags, isDbAvailable, type SearchStats } from '@/app/utils/sbomDb';

export const maxDuration = 60; // Allow up to 60s for count-only queries

export async function GET(request: NextRequest) {
  if (!isDbAvailable()) {
    return NextResponse.json({ error: 'SBOM Search not configured' }, { status: 503 });
  }

  const { searchParams } = request.nextUrl;
  const q = searchParams.get('q') ?? '';
  const field = (searchParams.get('field') ?? 'all') as 'name' | 'namespace' | 'version' | 'publisher' | 'purl' | 'license' | 'all';
  const registryId = searchParams.get('registryId') ?? undefined;
  const repo = searchParams.get('repo') ?? undefined;
  const tag = searchParams.get('tag') ?? undefined;
  const includeEol = searchParams.get('includeEol') === 'true';
  const sort = searchParams.get('sort') ?? undefined;
  const order = (searchParams.get('order') ?? 'asc') as 'asc' | 'desc';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0;

  if (!q.trim() && !repo?.trim() && !tag?.trim()) {
    return NextResponse.json({ results: [], total: 0 });
  }

  // Count-only mode: returns exact COUNT (can take 10-30s, runs with 60s timeout)
  const countOnly = searchParams.get('countOnly') === 'true';
  if (countOnly) {
    try {
      const count = await exactSearchCount(q, field, registryId, repo, tag);
      return NextResponse.json({ total: count });
    } catch (error) {
      console.error('[SBOM Count] Error:', error);
      return NextResponse.json({ total: -1 });
    }
  }

  try {
    const { results, total, stats } = await searchPackages(q, field, registryId, repo, tag, limit, offset, sort, order);

    // Cross-reference with EOL annotations if requested
    if (includeEol && registryId && results.length > 0) {
      const pairs = results.map(r => ({ repo: r.repo, tag: r.tag }));
      const eolMap = await batchGetEolForTags(registryId, pairs);
      const enriched = results.map(r => {
        const eol = eolMap.get(`${r.repo}|${r.tag}`);
        return eol ? { ...r, eolDate: eol.eolDate, eolStatus: eol.status } : r;
      });
      return NextResponse.json({ results: enriched, total, stats });
    }

    return NextResponse.json({ results, total, stats });
  } catch (error) {
    console.error('[SBOM Search] Error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
