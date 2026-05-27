#!/usr/bin/env node
/**
 * Runs VACUUM on the SBOM index tables to reclaim space from dead tuples.
 * Safe to run while the app is live — does NOT use VACUUM FULL.
 *
 * Usage:
 *   DATABASE_URL="postgresql://user:pass@host:5432/db" node scripts/vacuum-db.js
 */

const { Client } = require('pg');

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const c = new Client({
    connectionString: url,
    statement_timeout: 0,
    query_timeout: 0,
  });
  await c.connect();

  const before = await c.query("SELECT pg_size_pretty(pg_database_size(current_database())) as s");
  console.log('DB size before:', before.rows[0].s);

  console.log('Running VACUUM sbom_packages…');
  const t = Date.now();
  await c.query('VACUUM sbom_packages');
  console.log('VACUUM done in', Math.round((Date.now() - t) / 1000) + 's');

  console.log('Vacuuming other tables…');
  await c.query('VACUUM eol_annotations');
  await c.query('VACUUM crawl_state');
  await c.query('VACUUM crawl_locks');
  console.log('All tables vacuumed');

  const after = await c.query("SELECT pg_size_pretty(pg_database_size(current_database())) as s");
  console.log('DB size after:', after.rows[0].s);

  const dead = await c.query(
    'SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = $1',
    ['sbom_packages']
  );
  console.log('Dead tuples remaining:', dead.rows[0].n_dead_tup);

  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
