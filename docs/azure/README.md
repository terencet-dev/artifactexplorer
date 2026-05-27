# Azure Deployment Guide

This guide covers deploying Artifact Explorer's SBOM crawl infrastructure to Azure. The core app (registry browsing) requires no Azure setup — this is only for the optional SBOM Search feature.

## Prerequisites

- Azure subscription with available credits
- [Azure CLI](https://aka.ms/install-azure-cli) installed and logged in (`az login`)
- [Azure Functions Core Tools v4](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local) installed:
  ```bash
  brew tap azure/functions && brew install azure-functions-core-tools@4
  ```
- [psql](https://www.postgresql.org/download/) (PostgreSQL client) installed:
  ```bash
  brew install libpq && brew link --force libpq
  ```
- Node.js 20+

## Deployment Options

| Option | Hosting | Cron | Database | Monthly Cost Estimate |
|--------|---------|------|----------|----------------------|
| 1 | Vercel | Vercel Cron | Supabase | Vercel Pro + Supabase Free |
| **2** | **Vercel** | **Azure Functions** | **Supabase** | **Vercel Hobby/Pro + Azure credits + Supabase Free** |
| **3** | **Vercel** | **Azure Functions** | **Azure PG** | **Vercel Hobby/Pro + Azure credits** |
| **4** | **Azure App Service** | **Azure Functions** | **Azure PG** | **Azure credits only** |

Option 1 does not require Azure. See the main [README](../../README.md) for that setup.

### One-Click Deploy

Click the button below to deploy Azure infrastructure directly from the Azure Portal:

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2F<YOUR_GH_USER>%2Fartifact-explorer%2Fmain%2Fdocs%2Fazure%2Fazuredeploy.json)

Select the `deploymentType` parameter:
- **`functions-only`** → Option 2 (cron only, use external Supabase DB)
- **`functions-and-database`** → Option 3 (cron + Azure PostgreSQL)
- **`full`** → Option 4 (cron + Azure PostgreSQL + App Service hosting)

> **Note**: Replace `<YOUR_GH_USER>` in the button URL above with your GitHub username/org after forking the repo. Or use the Azure CLI commands below.

---

## Option 2: Vercel + Azure Functions + Supabase

Use Azure Functions for the SBOM crawl cron job while keeping Vercel for hosting and Supabase for the database. This is ideal if you're hitting Vercel Pro function compute limits.

### 1. Set up Supabase

1. Go to [supabase.com](https://supabase.com) → Create project
2. Open SQL Editor → Run the contents of [`schema.sql`](../schema.sql) (in `docs/`)
3. Go to Project Settings → Database → Copy the **connection string (URI, port 6543)**

### 2. Deploy Azure Functions

```bash
# Create a resource group
az group create --name <your-resource-group> --location westus2

# Deploy the ARM template (functions only)
az deployment group create \
  --resource-group <your-resource-group> \
  --template-file docs/azure/azuredeploy.json \
  --parameters docs/azure/parameters.option2.json \
  --parameters databaseUrl="<YOUR_SUPABASE_CONNECTION_STRING>"

# Note the functionAppName from the output
```

### 3. Deploy the function code

```bash
cd infra/azure-functions
npm install
npm run build
func azure functionapp publish <FUNCTION_APP_NAME> --javascript
```

You should see `Functions in <FUNCTION_APP_NAME>: sbomCrawl - [timerTrigger]` in the output.

### 4. Configure Vercel

In your Vercel project settings → Environment Variables:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Your Supabase connection string (same as above) |
| `SBOM_CRAWL_PROVIDER` | `azure` |
| `CRON_SECRET` | Any secure random string (optional, for manual triggers) |

Redeploy Vercel. The Vercel cron will still fire every 2 minutes but will return immediately (~0ms compute, effectively free).

### 5. Verify

- **Azure Portal** → Function App → Functions → `sbomCrawl` → Monitor — should show invocations every 3 minutes
- **Vercel Functions tab** — crawl route should show ~0ms duration
- Run a search query at `/registry/sbom-search` — should return results as the index builds

---

## Option 3: Vercel + Azure Functions + Azure Database for PostgreSQL

Same as Option 2 but uses Azure PG instead of Supabase. No external database needed.

### 1. Deploy Azure infrastructure

```bash
# Create a resource group
az group create --name <your-resource-group> --location westus2

# Deploy ARM template (functions + database)
az deployment group create \
  --resource-group <your-resource-group> \
  --template-file docs/azure/azuredeploy.json \
  --parameters docs/azure/parameters.option3.json \
  --parameters postgresAdminPassword="<STRONG_PASSWORD>"

# Copy the DATABASE_URL from deployment outputs
az deployment group show \
  --resource-group <your-resource-group> \
  --name azuredeploy \
  --query properties.outputs.databaseUrl.value -o tsv
```

### 2. Open the database firewall

Azure PG blocks external connections by default. The ARM template allows Azure-internal traffic, but Vercel's serverless functions need external access too.

**Recommended (production):** Use VNet integration or a private endpoint so the database is never reachable from the public internet. See [Azure docs: Networking with Flexible Server](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-networking-private). On Vercel, this typically requires an Enterprise plan (for static egress IPs) or fronting the DB with a connection pooler in a VNet.

**Also add your local IP so you can run the schema yourself:**

```bash
MY_IP=$(curl -4 -s ifconfig.me)
az postgres flexible-server firewall-rule create \
  --resource-group <your-resource-group> \
  --name <your-pg-server> \
  --rule-name AllowMyIP \
  --start-ip-address "$MY_IP" \
  --end-ip-address "$MY_IP"
```

**Enable the `pg_trgm` extension for fast search (required for trigram indexes):**

```bash
az postgres flexible-server parameter set \
  --resource-group <your-resource-group> \
  --server-name <your-pg-server> \
  --name azure.extensions \
  --value pg_trgm
```

<details>
<summary>⚠️ Last-resort fallback: allow ALL public IPs (NOT recommended)</summary>

If you cannot use VNet integration and your hosting platform (e.g. Vercel Hobby) does not offer static egress IPs, you can open the database to the entire public IPv4 internet. This relies entirely on SSL + a strong password for security and creates a much larger attack surface. Prefer one of the alternatives above whenever possible.

```bash
# DANGEROUS — exposes the DB to the entire public IPv4 internet.
az postgres flexible-server firewall-rule create \
  --resource-group <your-resource-group> \
  --name <your-pg-server> \
  --rule-name AllowAll \
  --start-ip-address 0.0.0.1 \
  --end-ip-address 255.255.255.255
```

If you take this path, rotate the admin password immediately on any suspicion of compromise and monitor connection logs closely.
</details>

### 3. Run the database schema

The `DATABASE_URL` must be a full PostgreSQL connection string (not just the hostname):

```
postgresql://<your-admin-user>:<YOUR_PASSWORD>@<your-server>.postgres.database.azure.com:5432/<your-db>?sslmode=require
```

Replace `<YOUR_PASSWORD>` with the `postgresAdminPassword` you set during deployment.

```bash
# Using the setup script
./docs/azure/setup.sh \
  --db-url "postgresql://<your-admin-user>:<YOUR_PASSWORD>@<your-server>.postgres.database.azure.com:5432/<your-db>?sslmode=require" \
  --func-app "<FUNCTION_APP_NAME>" \
  --resource-group <your-resource-group>

# Or manually
psql "postgresql://<your-admin-user>:<YOUR_PASSWORD>@<your-server>.postgres.database.azure.com:5432/<your-db>?sslmode=require" -f docs/schema.sql
```

> **Tip**: You can also get the DATABASE_URL from the deployment outputs:
> ```bash
> az deployment group show \
>   --resource-group <your-resource-group> \
>   --name azuredeploy \
>   --query properties.outputs.databaseUrl.value -o tsv
> ```

### 4. Deploy the function code

```bash
cd infra/azure-functions
npm install
npm run build
func azure functionapp publish <FUNCTION_APP_NAME> --javascript
```

You should see `Functions in <FUNCTION_APP_NAME>: sbomCrawl - [timerTrigger]` in the output.

### 5. Configure Vercel

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | The full Azure PG connection string from step 3 |
| `SBOM_CRAWL_PROVIDER` | `azure` |
| `DATABASE_SSL_CA` | *(Optional)* Azure DigiCert CA cert for strict SSL |

Redeploy Vercel.

### 6. Verify

- **Vercel**: `curl https://<YOUR_DOMAIN>/api/sbom-index/meta?registry=mcr.microsoft.com` — should return `{ "status": "indexing", ... }`
- **Azure Portal** → Function App → Functions → `sbomCrawl` → Monitor — invocations every 3 minutes
- **Vercel crawl route**: returns `{ "message": "Crawl delegated to Azure Functions" }` (~0ms)

> **Important**: The `DATABASE_URL` on Vercel and Azure Functions must point to the **same database** so that search/meta routes serve data written by the crawl.

---

## Option 4: Azure for All

Everything on Azure — no Vercel or Supabase required.

### 1. Deploy all Azure infrastructure

```bash
az group create --name <your-resource-group> --location westus2

az deployment group create \
  --resource-group <your-resource-group> \
  --template-file docs/azure/azuredeploy.json \
  --parameters docs/azure/parameters.option4.json \
  --parameters postgresAdminPassword="<STRONG_PASSWORD>" \
  --parameters cronSecret="<RANDOM_SECRET>"
```

### 2. Open the database firewall

```bash
# Allow your local IP for running the schema
MY_IP=$(curl -4 -s ifconfig.me)
az postgres flexible-server firewall-rule create \
  --resource-group <your-resource-group> \
  --name <your-pg-server> \
  --rule-name AllowMyIP \
  --start-ip-address "$MY_IP" \
  --end-ip-address "$MY_IP"
```

> For Option 4 (Azure-only), the App Service accesses PG via the Azure-internal firewall rule. You only need your local IP for running the schema.

### 3. Run the database schema

```bash
./docs/azure/setup.sh \
  --db-url "postgresql://<your-admin-user>:<YOUR_PASSWORD>@<your-server>.postgres.database.azure.com:5432/<your-db>?sslmode=require" \
  --func-app "<FUNCTION_APP_NAME>" \
  --resource-group <your-resource-group>
```

Replace `<YOUR_PASSWORD>` with the `postgresAdminPassword` you set during deployment.

### 4. Deploy the function code

```bash
cd infra/azure-functions
npm install
npm run build
func azure functionapp publish <FUNCTION_APP_NAME> --javascript
```

You should see `Functions in <FUNCTION_APP_NAME>: sbomCrawl - [timerTrigger]` in the output.

### 5. Deploy the Next.js app to App Service

```bash
# Build the Next.js app
npm install
npm run build

# Deploy to App Service
az webapp deploy \
  --resource-group <your-resource-group> \
  --name <APP_SERVICE_NAME> \
  --src-path .next/standalone \
  --type zip
```

Or set up GitHub Actions for continuous deployment:

```bash
az webapp deployment github-actions add \
  --resource-group <your-resource-group> \
  --name <APP_SERVICE_NAME> \
  --repo <GITHUB_USER/REPO> \
  --branch main
```

### 6. Verify

- **App Service URL** (from deployment outputs) — loads the app
- **Function App Monitor** — shows crawl invocations every 3 minutes
- **Search** at `<APP_SERVICE_URL>/registry/sbom-search` — returns results

---

## Environment Variables Reference

### Azure Functions (all options)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DATABASE_SSL_CA` | No | CA certificate for strict SSL (Azure PG) |
| `DATABASE_SSL_MODE` | No | Set to `disable` for local dev |
| `CRAWL_PARTITION_INDEX` | No | Partition index (default: no partitioning) |
| `CRAWL_PARTITION_COUNT` | No | Total partitions (default: 1) |
| `REGISTRY_MCR_MICROSOFT_COM_USERNAME` | No | MCR credentials |
| `REGISTRY_MCR_MICROSOFT_COM_PASSWORD` | No | MCR credentials |

### Vercel (options 2 & 3)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Same database as Azure Functions |
| `SBOM_CRAWL_PROVIDER` | Yes | Set to `azure` to disable Vercel cron compute |
| `CRON_SECRET` | No | For manual crawl triggers |
| `DATABASE_SSL_CA` | No | CA certificate for Azure PG |

### App Service (option 4)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Azure PG connection string |
| `SBOM_CRAWL_PROVIDER` | No | Not needed (no Vercel cron to disable) |
| `CRON_SECRET` | No | For manual crawl triggers |

---

## How the provider switch works

When you set `SBOM_CRAWL_PROVIDER=azure` on Vercel and redeploy:

1. **Vercel creates fresh function instances** — the new env var takes effect immediately
2. **Vercel crons still fire** every 2 minutes (configured in `vercel.json`)
3. **The crawl route checks `SBOM_CRAWL_PROVIDER`** and returns `200 OK` immediately (~1-2ms)
4. **Azure Functions timer fires** every 3 minutes with a 10-minute timeout
5. **Both read/write the same database** — search and meta routes on Vercel serve data written by Azure

The Vercel cron invocations cost approximately **86 seconds of total compute per month** (~43,200 invocations × ~2ms each). Effectively zero on your bill.

To eliminate even that, remove the `crons` block from `vercel.json`.

---

## Monitoring

### Azure Functions

- **Azure Portal** → Function App → Functions → `sbomCrawl` → Monitor
- **Application Insights** → Search for `sbomCrawl` traces
- **Logs**: `context.log()` output appears in Application Insights

### Database health check

```sql
-- Check crawl progress
SELECT id, status, repos_scanned, total_repos, packages_indexed,
       last_repo, last_run_at
FROM crawl_state;

-- Check package count
SELECT COUNT(*) FROM sbom_packages;

-- Check for stale locks
SELECT * FROM crawl_locks WHERE expires_at < now();
```

### Reset and recrawl

```sql
-- Wipe all data and start fresh
SELECT reset_sbom_search();
```

---

## Cost Estimates

| Resource | Option 2 | Option 3 | Option 4 |
|----------|----------|----------|----------|
| Azure Functions (Consumption) | ~$0 (free tier) | ~$0 (free tier) | ~$0 (free tier) |
| Storage Account | ~$0.01/mo | ~$0.01/mo | ~$0.01/mo |
| Application Insights | ~$0 (free 5GB) | ~$0 (free 5GB) | ~$0 (free 5GB) |
| Azure PG (B1ms) | — | ~$13/mo | ~$13/mo |
| Azure PG (B2s, recommended) | — | ~$26/mo | ~$26/mo |
| App Service (B1) | — | — | ~$13/mo |
| **Total Azure** | **~$0** | **~$13-26/mo** | **~$26-39/mo** |

> **Tip**: Start with B1ms for small deployments. Upgrade to B2s (`az postgres flexible-server update --sku-name Standard_B2s`) if using multiple crawl workers or if search queries are slow on large tables (1M+ rows).

All within the $150/month Azure credits.

---

## Troubleshooting

**Function not firing**: Check Application Insights for errors. Verify `DATABASE_URL` is set in Function App Configuration.

**Schema errors**: Run `docs/schema.sql` again — it's idempotent (safe to re-run).

**Search slow after bulk insert**: Run `ANALYZE sbom_packages;` to update query planner statistics. PostgreSQL may choose a bad query plan (B-tree scan instead of GIN index) when table statistics are stale.

**Connection timeouts**: Ensure the Azure PG firewall allows Azure services (the ARM template configures this automatically).

**Vercel still running crawls**: Confirm `SBOM_CRAWL_PROVIDER=azure` is set in Vercel env vars and you've redeployed.
