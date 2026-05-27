/**
 * EOL annotation search API.
 *
 * GET /api/sbom-index/eol/search?registryId=mcr-microsoft-com&status=expired&from=2026-01-01&to=2026-12-31&repo=dotnet&limit=50&offset=0
 * GET /api/sbom-index/eol/stats?registryId=mcr-microsoft-com
 *
 * Server-side search against PostgreSQL. Returns paginated EOL annotations
 * or aggregated stats by status (expired/warning/upcoming).
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDbAvailable, searchEolAnnotations, getEolStats, batchCheckSbomsExist } from '@/app/utils/sbomDb';

export async function GET(request: NextRequest) {
  if (!isDbAvailable()) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const { searchParams } = request.nextUrl;
  const mode = searchParams.get('mode'); // 'stats' or default to 'search'

  if (mode === 'stats') {
    const registryId = searchParams.get('registryId') ?? 'mcr-microsoft-com';
    try {
      const stats = await getEolStats(registryId);
      return NextResponse.json(stats);
    } catch (error) {
      console.error('[EOL Stats] Error:', error);
      return NextResponse.json({ error: 'Stats query failed' }, { status: 500 });
    }
  }

  // Default: search mode
  const registryId = searchParams.get('registryId') ?? 'mcr-microsoft-com';
  const status = (searchParams.get('status') ?? 'all') as 'expired' | 'warning' | 'upcoming' | 'all';
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const repo = searchParams.get('repo') ?? undefined;
  const sort = (searchParams.get('sort') ?? 'eolDate') as 'repo' | 'tag' | 'eolDate' | 'status';
  const order = (searchParams.get('order') ?? 'asc') as 'asc' | 'desc';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0;

  try {
    const { results, total } = await searchEolAnnotations({ registryId, status, from, to, repo, sort, order, limit, offset });

    // Check which EOL results have SBOMs available (batch query)
    if (results.length > 0) {
      const pairs = results.map(r => ({ repo: r.repo, tag: r.tag }));
      const sbomSet = await batchCheckSbomsExist(registryId, pairs);
      const enriched = results.map(r => ({
        ...r,
        hasSboms: sbomSet.has(`${r.repo}|${r.tag}`),
      }));
      return NextResponse.json({ results: enriched, total });
    }

    return NextResponse.json({ results, total });
  } catch (error) {
    console.error('[EOL Search] Error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
