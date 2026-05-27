/**
 * SBOM search feature flag check.
 *
 * GET /api/sbom-index/enabled
 *
 * Returns whether the SBOM search feature is enabled (i.e. DATABASE_URL
 * is configured). Used by client components to conditionally show the feature.
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    enabled: !!process.env.DATABASE_URL,
  });
}
