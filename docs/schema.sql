-- ============================================
-- Artifact Registry Explorer — Search Schema
--
-- Works on: Supabase, Azure Database for PostgreSQL,
--           or any PostgreSQL 14+ instance.
--
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE).
-- ============================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- trigram support for fast ILIKE search
-- ============================================

-- 1. SBOM Packages (deduplicated: one row per unique package per repo)
CREATE TABLE IF NOT EXISTS sbom_packages (
  id              BIGSERIAL PRIMARY KEY,
  registry_id     TEXT        NOT NULL,
  repo            TEXT        NOT NULL,
  name            TEXT        NOT NULL DEFAULT '',
  namespace       TEXT        NOT NULL DEFAULT '',
  version         TEXT        NOT NULL DEFAULT '',
  publisher       TEXT        NOT NULL DEFAULT '',
  purl            TEXT        NOT NULL DEFAULT '',
  license         TEXT        NOT NULL DEFAULT '',
  sample_tag      TEXT        NOT NULL DEFAULT '',
  tag_count       INTEGER     NOT NULL DEFAULT 1,
  blob_digest     TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint — one row per package per tag (not per repo)
-- This allows querying "all packages in tag X" accurately.
-- Migration: drops the old repo-level constraint if it exists.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_sbom_package'
  ) THEN
    ALTER TABLE sbom_packages DROP CONSTRAINT uq_sbom_package;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_sbom_package_tag'
  ) THEN
    ALTER TABLE sbom_packages
      ADD CONSTRAINT uq_sbom_package_tag
      UNIQUE (registry_id, repo, sample_tag, name, version, purl);
  END IF;
END $$;

-- Full-text search index (fastupdate = off prevents pending list buildup during concurrent writes)
CREATE INDEX IF NOT EXISTS idx_sbom_fts ON sbom_packages
  USING GIN (to_tsvector('simple',
    coalesce(name, '')      || ' ' ||
    coalesce(namespace, '') || ' ' ||
    coalesce(version, '')   || ' ' ||
    coalesce(publisher, '') || ' ' ||
    coalesce(purl, '')      || ' ' ||
    coalesce(license, '')
  )) WITH (fastupdate = off);

-- Filter / sort indexes
CREATE INDEX IF NOT EXISTS idx_sbom_registry      ON sbom_packages (registry_id);
CREATE INDEX IF NOT EXISTS idx_sbom_repo          ON sbom_packages (repo);
CREATE INDEX IF NOT EXISTS idx_sbom_name          ON sbom_packages (name);
CREATE INDEX IF NOT EXISTS idx_sbom_registry_repo ON sbom_packages (registry_id, repo);
CREATE INDEX IF NOT EXISTS idx_sbom_repo_tag     ON sbom_packages (registry_id, repo, sample_tag);

-- Trigram indexes for fast ILIKE search (e.g., name ILIKE '%openssl%')
-- fastupdate=off avoids the GIN pending list during heavy INSERT workloads
CREATE INDEX IF NOT EXISTS idx_sbom_name_trgm      ON sbom_packages USING GIN (name gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX IF NOT EXISTS idx_sbom_namespace_trgm ON sbom_packages USING GIN (namespace gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX IF NOT EXISTS idx_sbom_purl_trgm      ON sbom_packages USING GIN (purl gin_trgm_ops) WITH (fastupdate=off);

-- 2. EOL Annotations (one row per tag with a lifecycle artifact)
CREATE TABLE IF NOT EXISTS eol_annotations (
  id              BIGSERIAL PRIMARY KEY,
  registry_id     TEXT        NOT NULL,
  repo            TEXT        NOT NULL,
  tag             TEXT        NOT NULL,
  digest          TEXT        NOT NULL DEFAULT '',
  eol_date        DATE        NOT NULL,
  artifact_digest TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_eol_annotation'
  ) THEN
    ALTER TABLE eol_annotations
      ADD CONSTRAINT uq_eol_annotation
      UNIQUE (registry_id, repo, tag, digest);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_eol_date          ON eol_annotations (eol_date);
CREATE INDEX IF NOT EXISTS idx_eol_registry      ON eol_annotations (registry_id);
CREATE INDEX IF NOT EXISTS idx_eol_registry_repo ON eol_annotations (registry_id, repo);

-- 3. Crawl State (one row per partition per registry)
CREATE TABLE IF NOT EXISTS crawl_state (
  id                  TEXT PRIMARY KEY,
  registry_id         TEXT        NOT NULL,
  registry_server     TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'idle',
  total_repos         INTEGER     NOT NULL DEFAULT 0,
  repos_scanned       INTEGER     NOT NULL DEFAULT 0,
  tags_scanned        INTEGER     NOT NULL DEFAULT 0,
  sboms_found         INTEGER     NOT NULL DEFAULT 0,
  packages_indexed    INTEGER     NOT NULL DEFAULT 0,
  last_repo           TEXT        NOT NULL DEFAULT '',
  last_tag            TEXT        NOT NULL DEFAULT '',
  last_repo_complete  BOOLEAN     NOT NULL DEFAULT true,
  current_batch       INTEGER     NOT NULL DEFAULT 0,
  processed_digests   TEXT[]      NOT NULL DEFAULT '{}',
  started_at          TIMESTAMPTZ,
  last_run_at         TIMESTAMPTZ,
  error_count         INTEGER     NOT NULL DEFAULT 0,
  last_error          TEXT,
  index_version       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crawl_state_status_check'
  ) THEN
    ALTER TABLE crawl_state
      ADD CONSTRAINT crawl_state_status_check
      CHECK (status IN ('idle', 'crawling', 'complete'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crawl_registry ON crawl_state (registry_id);

-- 4. Crawl Locks (distributed lock for cron partitions)
CREATE TABLE IF NOT EXISTS crawl_locks (
  partition_id    TEXT PRIMARY KEY,
  locked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lock_expires ON crawl_locks (expires_at);

-- ============================================
-- Row Level Security (Supabase-specific)
--
-- Supabase exposes tables via PostgREST (anon/authenticated keys).
-- Enable RLS with zero policies to block REST API access while
-- allowing direct Postgres connections (which bypass RLS).
--
-- On non-Supabase providers (Azure PG, RDS, etc.) the 'anon' role
-- does not exist, so RLS is not enabled — which is fine because
-- there is no PostgREST layer to block.
-- ============================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE sbom_packages   ENABLE ROW LEVEL SECURITY;
    ALTER TABLE eol_annotations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE crawl_state     ENABLE ROW LEVEL SECURITY;
    ALTER TABLE crawl_locks     ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ============================================
-- Reset function (call to wipe and recrawl)
-- Usage: SELECT reset_sbom_search();
-- ============================================

CREATE OR REPLACE FUNCTION reset_sbom_search()
RETURNS void AS $$
BEGIN
  TRUNCATE sbom_packages RESTART IDENTITY;
  TRUNCATE eol_annotations RESTART IDENTITY;
  DELETE FROM crawl_state;
  DELETE FROM crawl_locks;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Materialized view for fast stats queries
-- Avoids expensive COUNT(DISTINCT ...) on large tables.
-- Refreshed after each crawl cycle completes.
-- ============================================

CREATE MATERIALIZED VIEW IF NOT EXISTS sbom_stats AS
SELECT registry_id,
       COUNT(*)::int AS total_packages,
       COUNT(DISTINCT repo)::int AS total_repos,
       COUNT(DISTINCT blob_digest)::int AS total_sboms
FROM sbom_packages
GROUP BY registry_id;

-- Unique index required for REFRESH CONCURRENTLY
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sbom_stats_registry'
  ) THEN
    CREATE UNIQUE INDEX idx_sbom_stats_registry ON sbom_stats (registry_id);
  END IF;
END $$;

