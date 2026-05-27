# Artifact Explorer

A user-friendly explorer for OCI-compatible container registries like Azure Container Registry (ACR), Microsoft Artifact Registry (MCR), Docker Hub, and any other registry that speaks the OCI Distribution Specification.

Browse repositories and tags, inspect manifests and supply-chain artifacts, view SPDX/CycloneDX SBOMs in the browser, and (optionally) search packages across an entire registry with a Postgres-backed cross-repository SBOM index.

## Deployment tiers

| Tier | What you get | What you need |
|------|-------------|---------------|
| **Core** | Registry browsing, tags, manifests, SBOM viewer, supply-chain artifacts | A Node 22 host (Vercel free tier works) — zero extra config |
| **SBOM Search + EOL** | Cross-registry SBOM package search + EOL annotation search across all indexed repositories | The Core requirements **plus** a PostgreSQL 14+ instance, plus either Vercel Cron or Azure Functions for the periodic crawl |

The core app works out of the box with a single `npm run dev` or Vercel deploy. SBOM Search is **entirely optional** — if its environment variables aren't set the feature is hidden and the app behaves like a normal registry explorer.

## Features

- **Flexible connectivity** — connect to authenticated or anonymous OCI-compatible registries
- **Multi-registry support** — view and manage multiple registry connections simultaneously
- **Unified repository view** — browse repositories across all connected registries in a single interface
- **Tag management** — view detailed information for repository tags including digests, platform details, and artifact types
- **Lifecycle management** — three-state End-of-Life (EOL) indicators showing scheduled, upcoming, and expired states
- **Advanced search** — filter repositories and registries with targeted search capabilities
- **Efficient digest search** — fast, cached digest searching with progress indicators and minimal API calls
- **Manifest inspection** — fetch and display manifest details for container images, with multi-architecture support
- **Artifact type detection** — intelligent classification of different artifact types (container images, Helm charts, signatures, attestations, SBOMs, …)
- **Supply-chain artifacts** — view OCI referrer artifacts and their relationships with API-based tree visualization
- **SBOM viewer** — parse and display SPDX 2.x/3.0 and CycloneDX SBOMs with a searchable, sortable, paginated package table
- **Cross-registry SBOM search** *(optional)* — search SBOM packages across indexed repositories by name, namespace, version, publisher, PURL, or license, with smart auto-detection (PURL / version / name routing)
- **EOL annotation search** *(optional)* — find expired, upcoming, and warning EOL tags across the index
- **Export to CSV** — multi-page CSV export with scope selection, field picker, and streaming progress
- **Secure credential handling** — in-memory credential store with optional session persistence
- **Responsive design** — optimized for both desktop and mobile
- **Dark mode** — full dark-theme support

See [`CHANGELOG.md`](CHANGELOG.md) for the version history.

## Testing

The project uses [Playwright](https://playwright.dev/) for end-to-end tests.

```bash
# Install Playwright browsers (one-time)
npx playwright install chromium

# Run the full suite against the default base URL (http://localhost:3000)
npm test

# Run against a different deployment
BASE_URL=https://your-deployment.example.com npm test

# Targeted suites
npm run test:api    # fast, API-only health checks
npm run test:ui     # browser-based UI tests
```

| Suite | File | Covers |
|-------|------|--------|
| API Health | `e2e/api-health.spec.ts` | SBOM search, EOL stats/search, meta, crawl, changelog |
| Homepage | `e2e/homepage.spec.ts` | Welcome page, CTA link, dark-mode toggle, header, footer |
| Navigation | `e2e/navigation.spec.ts` | Privacy/terms pages, connect routes, back-link navigation, header logo |
| Connect | `e2e/connect.spec.ts` | Anonymous/auth URL input, validation, MCR connection |
| Registry | `e2e/registry.spec.ts` | Registry page load, search page, heading hierarchy, alt text, keyboard a11y |

## Security

- **In-memory credential storage** — usernames and passwords are stored in memory, not in `localStorage`
- **Session-based persistence** — optional session persistence that expires when the browser is closed
- **Secure proxy architecture** — all registry requests are proxied through a server-side API
- **No persistent tokens** — authentication tokens are not stored between sessions
- **Fallback mechanisms** — multiple credential retrieval strategies for reliable authentication

## Getting started

### Prerequisites

- Node.js 22.x or higher
- npm 8.x or higher

### Installation

```bash
git clone https://github.com/<your-github-username>/artifact-explorer.git
cd artifact-explorer
npm install
```

### Development

```bash
npm run dev
```

Open <http://localhost:3000> in your browser.

### Production build

```bash
npm run build
npm run start
```

## Usage

### Connecting to a registry

1. Click **Connect Registry** on the home page
2. Choose authenticated or anonymous connection
3. For authenticated registries, enter the server URL, username, and password
4. For anonymous registries, enter only the server URL
5. The new registry will appear in the registry selector dropdown

### Browsing repositories

1. Select a registry from the dropdown (or choose "All Registries" view)
2. Browse the list of available repositories
3. Use the search box to filter repositories by name
4. Click a repository to view its tags

### Viewing tags

1. After selecting a repository, you'll see a list of its tags
2. Click a tag to view detailed information including digest, platform details, and size
3. Use the tag/digest search filter to find specific tags

## Environment variables

All environment variables are optional. Without them the app runs as a standalone registry explorer. See [`.env.example`](.env.example) for the full list.

### Core app

No environment variables required.

### SBOM Search (optional)

The following variables enable cross-repository SBOM search. If not set, the app works normally and SBOM Search is hidden.

| Variable | Required for | Description |
|----------|-------------|-------------|
| `DATABASE_URL` | SBOM Search | PostgreSQL connection string (Supabase, Azure PG, or any PostgreSQL 14+). |
| `CRON_SECRET` | SBOM Search | Secret string used to authenticate cron crawl requests. Set any secure random value. |
| `SBOM_CRAWL_PROVIDER` | Multi-provider | Set to `azure` to delegate crawls to Azure Functions. Omit or set to `vercel` for Vercel Cron (default). |
| `DATABASE_SSL_CA` | Azure PG | CA certificate for strict SSL. Omit for Supabase (uses permissive SSL by default). |
| `DATABASE_SSL_MODE` | Local dev | Set to `disable` for local PostgreSQL without SSL. |
| `NEXT_PUBLIC_CLARITY_PROJECT_ID` | Analytics | Optional Microsoft Clarity project ID. If unset, no analytics code is loaded. |

### Deployment options

SBOM Search supports four deployment configurations. See [`docs/azure/README.md`](docs/azure/README.md) for full Azure setup instructions.

| Option | Hosting | Cron | Database |
|--------|---------|------|----------|
| 1 | Vercel | Vercel Cron | Supabase |
| 2 | Vercel | Azure Functions | Supabase |
| 3 | Vercel | Azure Functions | Azure PG |
| 4 | Azure App Service | Azure Functions | Azure PG |

For options 2–4 you can use the **Deploy to Azure** button after forking. The button URL is:

```
https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2F<YOUR_GH_USER>%2Fartifact-explorer%2Fmain%2Fdocs%2Fazure%2Fazuredeploy.json
```

Replace `<YOUR_GH_USER>` with your GitHub username/org and select the `deploymentType` parameter to match your option (`functions-only`, `functions-and-database`, or `full`).

### Option 1: Vercel + Supabase (default)

1. **<https://supabase.com>** → Create a project → SQL Editor → Run [`docs/schema.sql`](docs/schema.sql) from this repo
2. **Supabase Dashboard** → Project Settings → Database → copy the **connection string (URI, Transaction mode, port 6543)**
3. **Vercel Dashboard** → Project Settings → Environment Variables → add `DATABASE_URL` and `CRON_SECRET`
4. Deploy — the cron job starts automatically, the "SBOM Search" nav link appears, and the index begins building

> **Without these variables**: the app works perfectly as a registry explorer. No errors, no broken pages — SBOM Search simply doesn't appear.
>
> **Switching to Azure cron**: set `SBOM_CRAWL_PROVIDER=azure` in Vercel env vars and redeploy. The Vercel cron route will then short-circuit immediately (~0 ms compute). Deploy the Azure Functions package to take over the crawl.

### Local development

```bash
# Copy variables from Vercel (if configured)
npx vercel env pull .env.local

# Or copy the template and fill it in yourself
cp .env.example .env.local

# Test the crawl endpoint locally
curl -X POST http://localhost:3000/api/sbom-index/crawl \
  -H "Authorization: Bearer <CRON_SECRET>"
```

## Architecture

- **Frontend** — Next.js 16 (App Router) with React 19 and TypeScript
- **Styling** — Tailwind CSS
- **State** — React Context API plus TanStack React Query for server state
- **API communication** — secure server-side proxy for all registry requests (avoids CORS, keeps credentials off the client)
- **Authentication** — in-memory credential store with a global singleton pattern
- **Caching** — module-level and session-based caching
- **SBOM index** *(optional)* — PostgreSQL with trigram GIN indexes for fast `ILIKE` search and a materialized view for instant stats
- **Crawler** *(optional)* — framework-agnostic crawl engine in `app/lib/crawlEngine.ts` consumed by both the Vercel cron route and the Azure Functions timer trigger

See [`docs/technical-design.md`](docs/technical-design.md) and [`docs/decisions.md`](docs/decisions.md) for deeper dives.

## Contributing

Contributions are welcome! See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the dev setup, code style notes, and PR checklist.

## License

[MIT](LICENSE).
