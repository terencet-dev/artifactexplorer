#!/usr/bin/env node
/**
 * Creates the GIN trigram index on sbom_packages.purl used by SBOM search.
 *
 * Usage:
 *   DATABASE_URL="postgresql://user:pass@host:5432/db" node scripts/create-purl-index.js
 *
 * The CREATE INDEX runs non-blocking and can take several minutes on a small
 * Postgres instance (e.g. several minutes on a small Azure PG Burstable instance).
 */

const { Client } = require('pg');

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const c = new Client({ connectionString: url, statement_timeout: 900000 });
  await c.connect();
  console.log('Creating purl trigram index (non-blocking, this can take several minutes)…');
  const t = Date.now();
  await c.query(
    'CREATE INDEX IF NOT EXISTS idx_sbom_purl_trgm ON sbom_packages USING gin (purl gin_trgm_ops) WITH (fastupdate=off)'
  );
  console.log('Done in', Math.round((Date.now() - t) / 1000) + 's');
  const r = await c.query(
    'SELECT indisvalid FROM pg_index WHERE indexrelid=(SELECT oid FROM pg_class WHERE relname=$1)',
    ['idx_sbom_purl_trgm']
  );
  console.log('valid:', r.rows[0]?.indisvalid);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
