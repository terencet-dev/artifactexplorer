/**
 * SBOM index metadata API.
 *
 * GET /api/sbom-index/meta?registry=mcr.microsoft.com
 *
 * Returns crawl status, progress, and package stats.
 * Reads from PostgreSQL (Supabase, Azure PG, or any PostgreSQL 14+).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAllCrawlStates,
  getStats,
  getEolStats,
  getPackageCount,
  isDbAvailable,
} from '@/app/utils/sbomDb';

const REGISTRY_ID = 'mcr-microsoft-com';

export async function GET(request: NextRequest) {
  if (!isDbAvailable()) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  void request; // consumed for route registration

  try {
    const states = await getAllCrawlStates(REGISTRY_ID);

    if (states.length === 0) {
      return NextResponse.json({
        status: 'unavailable',
        progress: 0,
        reposScanned: 0,
        totalRepos: 0,
        packagesIndexed: 0,
        sbomsFound: 0,
      });
    }

    let reposScanned = 0;
    let totalRepos = 0;
    let packagesIndexed = 0;
    let sbomsFound = 0;
    let latestRunAt = '';
    let earliestStartedAt = '';
    let overallStatus: string = 'idle';

    for (const s of states) {
      reposScanned += s.reposScanned;
      packagesIndexed += s.packagesIndexed;
      sbomsFound += s.sbomsFound;
      if (s.totalRepos > totalRepos) totalRepos = s.totalRepos;
      if (s.lastRunAt && (!latestRunAt || s.lastRunAt > latestRunAt)) latestRunAt = s.lastRunAt;
      if (s.startedAt && (!earliestStartedAt || s.startedAt < earliestStartedAt)) earliestStartedAt = s.startedAt;
      if (s.status === 'crawling') overallStatus = 'crawling';
      else if (s.status === 'complete' && overallStatus !== 'crawling') overallStatus = 'complete';
    }

    // Get real package count from the database (not from crawl state which resets on re-partition)
    // During indexing: use pg_class reltuples (fast, auto-updated by autovacuum)
    // When complete: use materialized view (refreshed after each cycle)
    try {
      if (overallStatus === 'complete') {
        const dbStats = await getStats(REGISTRY_ID);
        if (dbStats.totalPackages > 0) {
          packagesIndexed = dbStats.totalPackages;
          sbomsFound = dbStats.totalSboms;
        }
      } else {
        const realCount = await getPackageCount();
        if (realCount > 0) packagesIndexed = realCount;
        // Also get real SBOM count from DB (crawl state sbomsFound resets when partitions change)
        const dbStats = await getStats(REGISTRY_ID);
        if (dbStats.totalSboms > 0) sbomsFound = dbStats.totalSboms;
      }
    } catch { /* fall back to crawl state numbers */ }

    const progress = totalRepos > 0 ? Math.round((reposScanned / totalRepos) * 100) : 0;
    let eta: string | undefined;

    // isReindex: true when actively crawling and a previous cycle completed before.
    // Must be computed before the crawl-window override below mutates overallStatus.
    const isReindex = overallStatus === 'crawling' && !!latestRunAt;

    if (overallStatus === 'crawling') {
      // ETA: sum each partition's throughput (repos/ms) to get combined rate.
      // Each partition tracks its own reposScanned and startedAt independently.
      // Combined throughput = sum of individual rates (they work in parallel on different repos).
      const crawlingStates = states.filter(s => s.status === 'crawling' && s.startedAt && s.reposScanned > 0);
      let combinedRatePerMs = 0; // total repos/ms across all partitions
      for (const s of crawlingStates) {
        const elapsed = Date.now() - new Date(s.startedAt).getTime();
        if (elapsed > 0) combinedRatePerMs += s.reposScanned / elapsed;
      }
      if (combinedRatePerMs > 0) {
        const remaining = Math.max(0, totalRepos - reposScanned);
        const etaMs = remaining / combinedRatePerMs;
        const etaHours = Math.round(etaMs / 3_600_000 * 10) / 10;
        eta = etaHours < 1 ? `~${Math.round(etaMs / 60_000)}min` : `~${etaHours}h`;
      }
    }

    // Outside the nightly crawl window (7 AM – 6 PM PT), partitions may remain
    // in 'crawling' state because no new invocations arrive to mark them complete.
    // If a previous cycle completed (latestRunAt exists), treat as 'complete' so
    // the banner flips to green during daytime. First scans are exempt.
    const ptHour = parseInt(
      new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }),
      10,
    );
    const outsideCrawlWindow = ptHour >= 7 && ptHour < 18;
    if (overallStatus === 'crawling' && outsideCrawlWindow && latestRunAt) {
      overallStatus = 'complete';
    }

    let status: string;
    if (overallStatus === 'crawling') {
      status = 'indexing';
    } else if (overallStatus === 'complete') {
      const completedAt = new Date(latestRunAt).getTime();
      const elapsed = Date.now() - completedAt;
      status = elapsed < 24 * 60 * 60 * 1000 ? 'complete' : 'stale';
    } else {
      status = 'unavailable';
    }

    // EOL stats (non-fatal — table may not exist on older schemas)
    let eolAnnotations = 0;
    try {
      const eolStats = await getEolStats(REGISTRY_ID);
      eolAnnotations = eolStats.total;
    } catch { /* non-fatal */ }

    return NextResponse.json({
      status,
      progress,
      eta,
      reposScanned,
      totalRepos,
      packagesIndexed,
      sbomsFound,
      eolAnnotations,
      lastUpdated: latestRunAt || null,
      isReindex,
    });
  } catch (error) {
    console.error('[SBOM Meta] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
