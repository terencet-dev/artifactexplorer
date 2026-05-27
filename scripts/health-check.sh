#!/usr/bin/env bash
# ==============================================================================
# Artifact Explorer — Health Check Script
#
# Usage: ./scripts/health-check.sh
#
# Checks all components: Vercel endpoints, Azure PG, Azure Functions.
# Requires: curl, psql, az CLI (logged in)
# ==============================================================================

set -uo pipefail

# Auto-load .env.local if it exists (looks in script dir's parent = repo root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"
if [[ -f "$ENV_FILE" ]]; then
  set -a  # auto-export all variables
  source "$ENV_FILE"
  set +a
fi

# Configuration — override via environment variables or .env.local
# Example: DOMAIN="myapp.dev" DATABASE_URL="postgresql://..." ./scripts/health-check.sh
DOMAIN="${DOMAIN:-localhost:3000}"
DB_URL="${DATABASE_URL:-}"
RG="${RESOURCE_GROUP:-}"
FUNC_APP="${FUNC_APP_NAME:-}"
REGISTRY_ID="mcr-microsoft-com"

# Use https unless localhost
PROTOCOL="https"
if [[ "$DOMAIN" == localhost* || "$DOMAIN" == 127.* ]]; then
  PROTOCOL="http"
fi

PASS=0
FAIL=0

ok()   { printf '  ✅  %s\n' "$1"; ((PASS++)); }
fail() { printf '  ❌  %s  —  %s\n' "$1" "$2"; ((FAIL++)); }
info() { printf '      ↳ %s\n' "$1"; }

echo ""
echo "🔍  Artifact Explorer Health Check"
echo "    Domain:  $DOMAIN"
echo "    Date:    $(date '+%Y-%m-%d %H:%M:%S %Z')"

echo ""
echo "── Vercel ──────────────────────────────────────"
printf '    warming up… '
curl -s -m 30 -o /dev/null "$PROTOCOL://$DOMAIN/api/sbom-index/enabled" 2>/dev/null
echo "done"
echo ""

CRAWL=$(curl -s -m 10 "$PROTOCOL://$DOMAIN/api/sbom-index/crawl" 2>/dev/null)
if echo "$CRAWL" | grep -q '"provider"'; then
  ok "Crawl route (short-circuit)"
else
  fail "Crawl route" "unexpected response"
fi

META=$(curl -s -m 10 "$PROTOCOL://$DOMAIN/api/sbom-index/meta?registry=mcr.microsoft.com" 2>/dev/null)
STATUS=$(echo "$META" | python3 -c "import json,sys; d=json.load(sys.stdin); s=d.get('status','error'); r=d.get('isReindex',False); print('reindexing' if s=='indexing' and r else s)" 2>/dev/null || echo "error")
if [[ "$STATUS" == "indexing" || "$STATUS" == "reindexing" || "$STATUS" == "complete" ]]; then
  META_INFO=$(echo "$META" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'{d[\"reposScanned\"]}/{d[\"totalRepos\"]} repos · {d[\"packagesIndexed\"]:,} pkgs · {d.get(\"eolAnnotations\",0):,} EOL')" 2>/dev/null)
  ok "Meta ($STATUS): $META_INFO"
else
  fail "Meta" "status=$STATUS"
fi

ENABLED=$(curl -s -m 10 "$PROTOCOL://$DOMAIN/api/sbom-index/enabled" 2>/dev/null)
if echo "$ENABLED" | grep -q '"enabled":true'; then ok "Enabled"; else fail "Enabled" "not enabled"; fi

HTTP_CODE=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$PROTOCOL://$DOMAIN/" 2>/dev/null)
if [[ "$HTTP_CODE" == "200" ]]; then ok "Homepage"; else fail "Homepage" "HTTP $HTTP_CODE"; fi

echo ""
echo "── Search ──────────────────────────────────────"
echo ""

QUERIES=("openssl" "debian" "azurelinux" "ubuntu" "python")
for Q in "${QUERIES[@]}"; do
  RESP=$(curl -s -m 120 "$PROTOCOL://$DOMAIN/api/sbom-index/search?q=$Q&registryId=$REGISTRY_ID&limit=3" 2>/dev/null)
  # Extract inline counts from the search response
  TOTAL=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
  HAS_RESULTS=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if len(d.get('results',[])) > 0 or d.get('total',0) != 0 else 0)" 2>/dev/null || echo "0")

  # Phase B: if inline count timed out (negative), fetch exact count
  if [[ "$TOTAL" -lt 0 ]]; then
    EXACT=$(curl -s -m 120 "$PROTOCOL://$DOMAIN/api/sbom-index/search?q=$Q&registryId=$REGISTRY_ID&countOnly=true" 2>/dev/null)
    EXACT_TOTAL=$(echo "$EXACT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
    if [[ "$EXACT_TOTAL" -gt 0 ]]; then
      TOTAL="$EXACT_TOTAL"
    fi
  fi

  SUMMARY=$(echo "$RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin); s=d.get('stats',{})
t=$TOTAL; r=s.get('repoCount',0); g=s.get('tagCount',0)
tp='timeout' if t < 0 else f'{t:>,}'
rp='—' if r < 0 else f'{r:>,}'
gp='—' if g < 0 else f'{g:>,}'
print(f'{tp:>8} pkgs  {rp:>6} repos  {gp:>6} tags')
" 2>/dev/null || echo "error")

  if [[ "$HAS_RESULTS" == "1" ]]; then
    ok "$Q  →  $SUMMARY"
  else
    fail "$Q" "0 results or timeout"
  fi
done

echo ""
echo "── EOL Lifecycle ───────────────────────────────"
echo ""

EOL_STATS=$(curl -s -m 10 "$PROTOCOL://$DOMAIN/api/sbom-index/eol?mode=stats&registryId=$REGISTRY_ID" 2>/dev/null)
EOL_SUMMARY=$(echo "$EOL_STATS" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print(f'{d[\"total\"]:,} total · {d[\"expired\"]:,} expired · {d[\"warning\"]:,} warning · {d[\"upcoming\"]:,} upcoming')
" 2>/dev/null || echo "error")
if echo "$EOL_STATS" | grep -q '"total"'; then
  ok "Stats: $EOL_SUMMARY"
else
  fail "EOL stats" "failed"
fi

EOL_SEARCH=$(curl -s -m 10 "$PROTOCOL://$DOMAIN/api/sbom-index/eol?mode=search&registryId=$REGISTRY_ID&limit=3" 2>/dev/null)
EOL_RESULTS=$(echo "$EOL_SEARCH" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('results',[])))" 2>/dev/null || echo "0")
if [[ "$EOL_RESULTS" -gt 0 ]]; then ok "Search: $EOL_RESULTS results"; else fail "EOL search" "0 results"; fi

echo ""
echo "── PostgreSQL ──────────────────────────────────"
echo ""
if ! command -v psql &> /dev/null; then
  echo "  ⚠️  psql not installed — skipping DB checks"
elif [[ -z "$DB_URL" ]]; then
  echo "  ⚠️  DATABASE_URL not set — skipping DB checks"
  echo "     Set it: DATABASE_URL=\"postgresql://user:pass@host:5432/db\" ./scripts/health-check.sh"
else
  PKGS=$(psql "$DB_URL" -At -c "SELECT COUNT(*) FROM sbom_packages;" 2>/dev/null)
  EOLS=$(psql "$DB_URL" -At -c "SELECT COUNT(*) FROM eol_annotations;" 2>/dev/null)
  [[ -n "$PKGS" && "$PKGS" -gt 0 ]] && ok "sbom_packages: $(printf "%'d" "$PKGS") rows" || fail "sbom_packages" "empty"
  [[ -n "$EOLS" && "$EOLS" -gt 0 ]] && ok "eol_annotations: $(printf "%'d" "$EOLS") rows" || fail "eol_annotations" "empty"

  # EOL date range
  EOL_RANGE=$(psql "$DB_URL" -At -c "
    SELECT COUNT(*) FILTER (WHERE eol_date < CURRENT_DATE)  || ' expired · '
      || COUNT(*) FILTER (WHERE eol_date >= CURRENT_DATE)   || ' active · '
      || COUNT(*) FILTER (WHERE eol_date >= CURRENT_DATE AND eol_date < CURRENT_DATE + 30) || ' warning (30d) · '
      || MIN(eol_date)::text || ' → ' || MAX(eol_date)::text
    FROM eol_annotations;" 2>/dev/null)
  [[ -n "$EOL_RANGE" ]] && ok "EOL range: $EOL_RANGE"

  # Oldest / newest EOL
  while IFS= read -r row; do [[ -n "$row" ]] && info "oldest:  $row"; done < <(psql "$DB_URL" -At -c "SELECT repo || ':' || tag || '  ' || eol_date::text FROM eol_annotations ORDER BY eol_date ASC LIMIT 2;" 2>/dev/null)
  while IFS= read -r row; do [[ -n "$row" ]] && info "newest:  $row"; done < <(psql "$DB_URL" -At -c "SELECT repo || ':' || tag || '  ' || eol_date::text FROM eol_annotations ORDER BY eol_date DESC LIMIT 2;" 2>/dev/null)

  # Crawl state
  CRAWL_INFO=$(psql "$DB_URL" -At -c "
    SELECT COUNT(*)::text || ' workers · ' || string_agg(id || '=' || repos_scanned::text, ', ' ORDER BY id)
    FROM crawl_state;" 2>/dev/null)
  [[ -n "$CRAWL_INFO" ]] && ok "Crawl: $CRAWL_INFO"

  # Connections
  CONN=$(psql "$DB_URL" -At -c "
    SELECT 'max=' || current_setting('max_connections')
      || '  total=' || count(*)
      || '  active=' || count(*) FILTER (WHERE state='active')
      || '  idle=' || count(*) FILTER (WHERE state='idle')
    FROM pg_stat_activity;" 2>/dev/null)
  [[ -n "$CONN" ]] && ok "Connections: $CONN"

  # Trigram indexes
  IDX_ISSUES=0
  while IFS='|' read -r idx_name is_valid idx_size; do
    [[ -z "$idx_name" ]] && continue
    if [[ "$is_valid" == "t" ]]; then
      ok "Index: $idx_name ($idx_size)"
    else
      fail "Index: $idx_name" "INVALID — rebuild needed"
      ((IDX_ISSUES++))
    fi
  done < <(psql "$DB_URL" -At -c "
    SELECT c.relname, i.indisvalid, pg_size_pretty(pg_relation_size(c.oid))
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname LIKE '%trgm%' ORDER BY c.relname;" 2>/dev/null)

  # Table sizes
  SIZES=$(psql "$DB_URL" -At -c "
    SELECT 'sbom_packages=' || pg_size_pretty(pg_total_relation_size('sbom_packages'))
      || '  eol_annotations=' || pg_size_pretty(pg_total_relation_size('eol_annotations'));" 2>/dev/null)
  [[ -n "$SIZES" ]] && ok "Sizes: $SIZES"
fi

echo ""
echo "── Azure Functions ─────────────────────────────"
echo ""
if ! command -v az &> /dev/null; then
  echo "  ⚠️  az CLI not installed — skipping Azure checks"
elif [[ -z "$RG" || -z "$FUNC_APP" ]]; then
  echo "  ⚠️  RESOURCE_GROUP or FUNC_APP_NAME not set — skipping Azure checks"
  echo "     Set them: RESOURCE_GROUP=\"my-rg\" FUNC_APP_NAME=\"my-func\" ./scripts/health-check.sh"
else
  FUNCS=$(az functionapp function list --name "$FUNC_APP" --resource-group "$RG" --query "length(@)" -o tsv 2>/dev/null || echo "0")
  if [[ "$FUNCS" -gt 0 ]]; then
    ok "Function App ($FUNC_APP): $FUNCS function(s)"
  else
    fail "Function App ($FUNC_APP)" "no functions found"
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf '  Results:  %d passed  /  %d failed\n' "$PASS" "$FAIL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exit $FAIL
