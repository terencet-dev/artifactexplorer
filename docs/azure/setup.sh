#!/usr/bin/env bash
# ==============================================================================
# Artifact Explorer — Azure post-deployment setup
#
# Usage:
#   ./setup.sh --db-url <DATABASE_URL> [--func-app <FUNCTION_APP_NAME>] [--schema-only]
#
# This script:
#   1. Runs schema.sql against the target PostgreSQL database
#   2. Optionally configures Azure Functions app settings
#
# Prerequisites: psql, az CLI (if configuring Function App)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_FILE="$SCRIPT_DIR/../schema.sql"

# Parse arguments
DB_URL=""
FUNC_APP=""
RESOURCE_GROUP=""
SCHEMA_ONLY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --db-url)       DB_URL="$2"; shift 2 ;;
    --func-app)     FUNC_APP="$2"; shift 2 ;;
    --resource-group) RESOURCE_GROUP="$2"; shift 2 ;;
    --schema-only)  SCHEMA_ONLY=true; shift ;;
    -h|--help)
      echo "Usage: $0 --db-url <DATABASE_URL> [--func-app <NAME>] [--resource-group <RG>] [--schema-only]"
      echo ""
      echo "  --db-url          PostgreSQL connection string (required)"
      echo "  --func-app        Azure Function App name (optional, sets DATABASE_URL)"
      echo "  --resource-group  Azure resource group (required if --func-app is set)"
      echo "  --schema-only     Only run schema.sql, skip Function App configuration"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$DB_URL" ]]; then
  echo "Error: --db-url is required"
  exit 1
fi

if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "Error: schema.sql not found at $SCHEMA_FILE"
  exit 1
fi

# Step 1: Run schema.sql
echo "==> Running schema.sql against database..."
if ! command -v psql &> /dev/null; then
  echo "Error: psql is not installed. Install PostgreSQL client tools."
  echo "  macOS: brew install libpq && brew link --force libpq"
  echo "  Ubuntu: sudo apt-get install postgresql-client"
  exit 1
fi

psql "$DB_URL" -f "$SCHEMA_FILE"
echo "==> Schema applied successfully."

if [[ "$SCHEMA_ONLY" == "true" ]]; then
  echo "==> Done (schema-only mode)."
  exit 0
fi

# Step 2: Configure Azure Functions app settings (optional)
if [[ -n "$FUNC_APP" ]]; then
  if [[ -z "$RESOURCE_GROUP" ]]; then
    echo "Error: --resource-group is required when --func-app is set"
    exit 1
  fi

  if ! command -v az &> /dev/null; then
    echo "Error: Azure CLI (az) is not installed. Install from https://aka.ms/install-azure-cli"
    exit 1
  fi

  echo "==> Configuring Function App '$FUNC_APP' in resource group '$RESOURCE_GROUP'..."
  az functionapp config appsettings set \
    --name "$FUNC_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --settings "DATABASE_URL=$DB_URL" \
    --output none

  echo "==> Function App configured with DATABASE_URL."
fi

echo "==> Setup complete."
echo ""
echo "Next steps:"
echo "  1. Deploy Azure Functions code:"
echo "     cd infra/azure-functions && npm install && npm run build && func azure functionapp publish <FUNC_APP_NAME> --javascript"
echo "  (Azure Functions project is at: infra/azure-functions/)"
echo "  2. If using Vercel, set SBOM_CRAWL_PROVIDER=azure in Vercel env vars and redeploy"
echo "  3. Monitor: Azure Portal → Function App → Functions → sbomCrawl → Monitor"
