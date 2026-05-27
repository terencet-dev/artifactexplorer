/**
 * SBOM Search feature flag.
 *
 * Controls UI visibility of the SBOM Search feature across the app.
 * The actual server functionality is separately gated by `DATABASE_URL`
 * (presence of the SBOM index) and by `CRAWL_ENABLED` (whether new SBOMs
 * are ingested).
 *
 * Configuration:
 *   - Set `NEXT_PUBLIC_SBOM_SEARCH_VISIBLE=true` in your environment to show
 *     the SBOM Search nav item and pages. Any other value (or unset) hides it.
 *
 * This is a build-time-baked public env var. To change visibility you must
 * rebuild and redeploy.
 */

export function isSbomSearchVisible(): boolean {
  return process.env.NEXT_PUBLIC_SBOM_SEARCH_VISIBLE === 'true';
}
