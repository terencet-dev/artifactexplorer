# Changelog

## [1.0.3] - 2026-07-01

### Fixed

- **Footer pushed below the fold on the connect flow** — the registry-authentication and connect pages (`/connect`, `/connect/auth`, `/connect/noauth`) set the content area to `min-h-[calc(100vh-72px)]`, which only subtracted an approximate header height and ignored both the footer and the `<main>` vertical padding. The stacked layout therefore exceeded the viewport by ~85 px and the footer could only be reached by scrolling. The pages now use `flex-grow` (matching the landing page), so the content fills exactly the space between header and footer and the footer stays on-screen.
- **Hydration mismatch warning from browser extensions** — extensions that inject attributes onto `<body>` before React hydrates (e.g. `wotdisconnected`) triggered a React hydration-mismatch console error. Added `suppressHydrationWarning` to `<body>` (the `<html>` element already had it).

### Changed

- The **anonymous registry** connection form now prefills the *Registry Login Server URL* with `mcr.microsoft.com` (still fully editable and clearable) to speed up the most common case.
- The registry-authentication / connect pages (`/connect`, `/connect/auth`, `/connect/noauth`) no longer use their own background gradient — they now inherit the same background as the rest of the app. This also removes a faint horizontal line that appeared just above the footer, caused by the gradient ending in the footer's color while the layout's padding strip sat a shade darker between them.
- Removed the now-redundant top border on the footer.
- Removed the "Keep a Changelog / Semantic Versioning" preamble from the in-app changelog modal.
- The changelog modal's **Current** badge no longer shows the `v` prefix (e.g. `Current: 1.0.3`).

### Security

- Resolved all three moderate `npm audit` advisories → **0 vulnerabilities**. Updated `js-yaml` (quadratic-complexity DoS in merge-key handling, [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68)) and pinned Next.js's bundled `postcss` to the patched `8.5.x` line via a package.json `overrides` entry (XSS via unescaped `</style>` in CSS stringify output, [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)). The override avoids the `npm audit fix --force` path, which would have downgraded Next.js from 16 to 9.x.

## [1.0.2] - 2026-06-30

### Fixed

- **Search reset when paginating the repository catalog** — on registries large enough to span multiple pages (e.g. `mcr.microsoft.com`), searching the catalog and then moving to the next page reverted the results to the full, unfiltered list. The displayed list was stored as state and kept in sync by competing effects, one of which recomputed it on every page change filtered only by registry — ignoring the active search query — and, by effect-ordering, overwrote the search-filtered page. The displayed list is now derived purely from the catalog, the active filters, and the current page (a single `useMemo` over a new `selectRepositories` helper), so the search is retained across pagination. A Playwright regression test (`e2e/search-pagination.spec.ts`) covers the search-then-paginate flow.

### Changed

- The catalog now sorts repositories by name in single-registry ("current") view for consistency with combined ("all") view, applies the same name-and-registry match for "All" search across every code path, and shows an empty state (rather than the full unfiltered list) for a registry with no matching repositories.

## [1.0.1] - 2026-06-30

### Fixed

- **Vercel deployment validation** — removed the `$comment`/`$comment2`/`$comment3` pseudo-keys from `vercel.json`. JSON has no comment syntax, and Vercel validates `vercel.json` against a strict schema that rejects unknown keys, so these caused deploys to fail with `Invalid request: should NOT have additional property "$comment"`. The file is now a valid empty config (`{}`); Vercel Cron remains opt-in.
- **ESLint flat-config crash** — `eslint.config.mjs` referenced `react-hooks/*` rules without registering the `react-hooks` plugin, which under ESLint 9 flat config crashes `eslint .` (run by the `prebuild` hook) with *"could not find plugin react-hooks"* and blocked `npm run build`. The plugin is now registered in the config.

### Changed

- **Privacy and Terms pages** now ship finalized content with a fixed effective date (June 30, 2026), including the Microsoft Clarity third-party disclosure, replacing the environment-configured template scaffolding and the "replace before deploying" banner. As a result `NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE`, `NEXT_PUBLIC_TERMS_EFFECTIVE_DATE`, and `NEXT_PUBLIC_CONTACT_EMAIL` are no longer used and have been removed from `.env.example`.

### Documentation

- Clarified in the README that SBOM Search and the crawl are **opt-in**. Corrected the Option 1 (Vercel Cron) setup steps, which previously implied the cron "starts automatically" — the OSS release ships without a `crons` block, so enabling it requires adding one to `vercel.json` **and** setting `CRAWL_ENABLED=true`.
- Documented the previously-missing `NEXT_PUBLIC_SBOM_SEARCH_VISIBLE`, `CRAWL_ENABLED`, and crawl-target (`CRAWL_DEFAULT_REGISTRY_SERVER` / `CRAWL_DEFAULT_REGISTRY_ID`) environment variables in the README, aligning it with `.env.example`.
- Updated `SECURITY.md` and the bug-report issue template to reference the **1.0.x** release line instead of the retired `0.1.x-public-preview` preview tag.

## [1.0.0] - 2026-05-27

Initial public release.

### Added

#### Core registry browsing
- Connect to any OCI-compatible container registry — authenticated or anonymous — with support for Azure Container Registry (ACR), Microsoft Artifact Registry (MCR), Docker Hub, and registries that speak the OCI Distribution Specification.
- Multi-registry support with a unified "All Registries" view and per-registry filtering.
- Repository listing with search, pagination, and skeleton loading states.
- Tag listing per repository with digest, platform, size, and media-type metadata.
- Multi-architecture image support — image indexes / manifest lists expand to show per-platform manifests.
- Three-state End-of-Life (EOL) indicators on tags: scheduled, upcoming, and expired.
- Efficient digest search with progress indicators, caching, and minimal API calls.

#### Manifest and artifact inspection
- Manifest viewer for container images, image indexes, and manifest lists.
- Artifact type detection driven by a YAML media-type registry — classifies container images, Helm charts, signatures, attestations, SBOMs, lifecycle annotations, and more.
- Supply-chain artifact tree via the OCI referrers API, including discovery at the image-index, manifest-list, and platform-manifest levels.
- Slide-in artifact panel with tabbed Manifest / SBOM views and an expand toggle for wider tables.

#### SBOM viewer
- In-browser SPDX 2.x, SPDX 3.0, and CycloneDX SBOM parsing.
- Streaming NDJSON parse pipeline (`/api/registry/blob/parse`) — handles SBOMs up to several GB without exhausting serverless memory.
- Timeout-aware graceful degradation — partial results plus a download fallback when parsing exceeds the function deadline.
- Searchable, sortable, paginated package table with CSV export.
- Dedicated pure-stream download route (`/api/registry/blob/download`) for any-size raw SBOM downloads.

#### Cross-registry SBOM Search *(optional)*
- PostgreSQL-backed cross-repository SBOM index with GIN trigram indexes on `name`, `namespace`, and `purl`, plus a btree on `version`.
- Smart query routing — auto-detects PURL (`pkg:`, `oci/`, `@sha256:`), semver-like, and free-text queries and routes each to its optimal index.
- Structured `field:value` query syntax with quoted-value support (e.g. `name:"my package" publisher:microsoft`).
- Materialized view (`sbom_stats`) for instant `COUNT(DISTINCT …)` results, refreshed after each crawl cycle.
- Progressive COUNT — instant initial total via `EXPLAIN`, exact count fetched in the background.
- Multi-page CSV export with scope selection (current page / page range / all), field picker, and streaming progress bar.

#### EOL Annotation Search *(optional)*
- Cross-registry search for lifecycle annotations (`application/vnd.microsoft.artifact.lifecycle`) — captured from the same referrers call as SBOMs (zero extra HTTP requests).
- Filter by status (expired / warning / upcoming), date range, and repository; sortable columns; CSV export.
- Cross-linking between EOL and SBOM tabs — "View SBOMs" link appears only when SBOM data exists for the tag.

#### Crawl infrastructure
- Framework-agnostic crawl engine in `app/lib/crawlEngine.ts` consumed by both the Vercel cron route and the Azure Functions timer trigger via dependency injection.
- `SBOM_CRAWL_PROVIDER` env var selects the active runtime — `vercel` (default) or `azure`. When set to `azure`, the Vercel cron short-circuits in ~0 ms.
- Per-tag checkpointing via `onTagComplete` callback — invocations that time out resume at the next tag with zero data loss.
- Incremental delta crawl — referrers whose artifact digests are already in `sbom_packages.blob_digest` or `eol_annotations.artifact_digest` skip the blob download / decompress / parse / upsert step.
- Configurable crawl window (`CRAWL_HOUR_START` / `CRAWL_HOUR_END`, default 01:00–14:00 UTC) — function apps stay `Running` permanently and short-circuit outside the window.
- Sub-partitioning via `CRAWL_SUB_INDEX` / `CRAWL_SUB_COUNT` for faster initial crawls.
- Crawl reliability: 30 s `AbortSignal.timeout` per registry fetch, 600 s lock TTL with 120 s renewal, stale-lock override after 2× TTL, expired-lock cleanup on every `acquireLock`.
- Storage-bloat prevention — `processed_digests` is always written as `[]` to keep TOAST growth bounded; cross-invocation dedup is handled by the delta skip.

#### Deployment options
- **Option 1**: Vercel + Vercel Cron + Supabase
- **Option 2**: Vercel + Azure Functions + Supabase
- **Option 3**: Vercel + Azure Functions + Azure PostgreSQL
- **Option 4**: Azure App Service + Azure Functions + Azure PostgreSQL

ARM templates and a one-click "Deploy to Azure" button cover options 2–4. See [`docs/azure/README.md`](docs/azure/README.md).

#### Security and credentials
- Server-side proxy for all registry communication — the browser never talks to registries directly (no CORS issues, credentials never leave the server).
- In-memory credential store with optional session-scoped persistence; no tokens written to `localStorage`.
- Centralized auth in `app/api/registry/auth.ts` shared by the proxy, blob parse, and blob download routes.

#### UX
- Responsive layout for desktop and mobile.
- Full dark-mode support with persistent theme preference.
- Breadcrumb navigation, skeleton loading states, and SPA-style transitions.
- Reusable `CopyButton`, `ConfirmationModal`, and `ExportModal` components.
- Footer changelog modal sourced live from `CHANGELOG.md` via `/api/changelog`.

#### Testing
- Playwright end-to-end suite covering API health, homepage, navigation, connect flows, and registry/accessibility — runnable against any deployment via `BASE_URL`.
- `npm run test:api` for fast API-only checks; `npm run test:ui` for browser tests; `npm test` for the full suite.

#### Tooling and scripts
- `scripts/health-check.sh` — operational health probe for the SBOM index and crawl state.
- `scripts/vacuum-db.js` — manual `VACUUM` / `ANALYZE` helper for the PostgreSQL index.
- `scripts/create-purl-index.js` — on-demand PURL trigram index creation.
- `.env.example` documenting every supported environment variable.
- Optional Microsoft Clarity analytics via `NEXT_PUBLIC_CLARITY_PROJECT_ID` (opt-in — no analytics code is loaded without it).

### Architecture
- **Frontend**: Next.js 16 (App Router), React 19, TypeScript.
- **Styling**: Tailwind CSS.
- **State**: React Context API + TanStack React Query for server state.
- **Database** *(optional)*: PostgreSQL 14+ (Supabase, Azure Database for PostgreSQL, or self-hosted) with `pg_trgm`.
- **Single schema** (`docs/schema.sql`) — idempotent, safe to re-run, works on Supabase and Azure PG.
