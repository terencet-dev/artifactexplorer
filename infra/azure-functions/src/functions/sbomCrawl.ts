/**
 * Azure Functions Timer Trigger — SBOM Crawl.
 *
 * Runs every 3 minutes (single partition, 10-minute timeout).
 * Delegates to the shared crawl engine in app/lib/crawlEngine.ts.
 *
 * Uses env-var-only auth (no Next.js cookies dependency).
 * Processes ~100 repos per invocation (doubled from Vercel's 50
 * thanks to Azure's 10-minute function timeout).
 *
 * Environment variables:
 *   DATABASE_URL              — PostgreSQL connection string (required)
 *   DATABASE_SSL_CA           — CA cert for strict SSL (optional, Azure PG)
 *   DATABASE_SSL_MODE         — Set to "disable" for local dev (optional)
 *   CRAWL_PARTITION_INDEX     — Partition index (optional, default: no partitioning)
 *   CRAWL_PARTITION_COUNT     — Total partitions (optional, default: 1)
 *   CRAWL_SUB_INDEX           — Sub-partition index within a partition (optional)
 *   CRAWL_SUB_COUNT           — Sub-partition count (optional, default: 1)
 *   REGISTRY_MCR_MICROSOFT_COM_USERNAME — MCR credentials (optional)
 *   REGISTRY_MCR_MICROSOFT_COM_PASSWORD — MCR credentials (optional)
 */

import { app, type InvocationContext, type Timer } from '@azure/functions';
import { runCrawl, type CrawlResult } from '@/app/lib/crawlEngine';
import { isDbAvailable } from '@/app/utils/sbomDb';
import { createRegistryFetch } from '../lib/registryFetch.js';

const TIMEOUT_BUFFER_MS = 20_000;   // 20s buffer before Azure's hard timeout
const FUNCTION_TIMEOUT_MS = 300_000; // 5 minutes (reduced from 10 to cut GB-s costs)
const REPOS_PER_INVOCATION = 50;     // Halved from 100 to shorten execution time

app.timer('sbomCrawl', {
  // NCrontab 6-field format (includes seconds): every 15 minutes
  schedule: '0 */15 * * * *',
  handler: async (timer: Timer, context: InvocationContext) => {
    context.log(`SBOM Crawl timer fired at ${timer.scheduleStatus?.last ?? 'unknown'}`);

    // ── Schedule gate: configurable crawl window via CRAWL_HOUR_START/END (UTC). ──
    // Both bounds are inclusive of start, exclusive of end. Supports wrap-around
    // (e.g. start=22, end=6 → crawl from 22:00 to 06:00 UTC).
    // Defaults: 01:00–14:00 UTC (off-peak window).
    const startHour = parseInt(process.env.CRAWL_HOUR_START ?? '1', 10);
    const endHour = parseInt(process.env.CRAWL_HOUR_END ?? '14', 10);
    const utcHour = new Date().getUTCHours();
    const inWindow = startHour <= endHour
      ? (utcHour >= startHour && utcHour < endHour)
      : (utcHour >= startHour || utcHour < endHour);
    if (!inWindow) {
      context.log(`Outside crawl window (UTC hour ${utcHour}, window ${startHour}:00–${endHour}:00) — skipping`);
      return;
    }

    if (!isDbAvailable()) {
      context.log('DATABASE_URL not configured — skipping crawl');
      return;
    }

    // Parse optional partition config from env vars
    const partitionIndex = process.env.CRAWL_PARTITION_INDEX ? parseInt(process.env.CRAWL_PARTITION_INDEX, 10) : undefined;
    const partitionCount = process.env.CRAWL_PARTITION_COUNT ? parseInt(process.env.CRAWL_PARTITION_COUNT, 10) : undefined;
    const partition = (partitionIndex !== undefined && partitionCount && partitionCount > 1)
      ? { index: partitionIndex, total: partitionCount }
      : undefined;

    // Parse optional sub-partition config (splits a partition across extra workers)
    const subIndex = process.env.CRAWL_SUB_INDEX ? parseInt(process.env.CRAWL_SUB_INDEX, 10) : undefined;
    const subCount = process.env.CRAWL_SUB_COUNT ? parseInt(process.env.CRAWL_SUB_COUNT, 10) : undefined;
    const subPartition = (subIndex !== undefined && subCount && subCount > 1)
      ? { index: subIndex, total: subCount }
      : undefined;

    const fetchFn = createRegistryFetch();

    const result: CrawlResult = await runCrawl({
      fetchFn,
      deadlineMs: Date.now() + FUNCTION_TIMEOUT_MS - TIMEOUT_BUFFER_MS,
      reposPerInvocation: REPOS_PER_INVOCATION,
      partition,
      subPartition,
      // 1h recrawl interval — the schedule gate (CRAWL_HOUR_START/END) is the real rate limiter.
      // Short interval ensures all partitions reset immediately when the window opens,
      // regardless of when they finished the previous cycle.
      recrawlIntervalMs: 1 * 60 * 60 * 1000,
      label: partition
        ? (subPartition ? `[Azure Crawl P${partition.index}S${subPartition.index}]` : `[Azure Crawl P${partition.index}]`)
        : '[Azure Crawl]',
    });

    context.log(`Crawl result: ${JSON.stringify(result)}`);
  },
});
