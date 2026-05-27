'use client';

import Link from 'next/link';
import { isSbomSearchVisible } from '@/app/utils/sbomFeatureFlag';

/**
 * Client component for the SBOM Search nav link in the header.
 *
 * Visibility is controlled by the `NEXT_PUBLIC_SBOM_SEARCH_VISIBLE` env var.
 * The server env gate (`DATABASE_URL`) controls actual indexing functionality,
 * not UI visibility.
 */
export default function SbomNavLink() {
  if (!isSbomSearchVisible()) return null;

  return (
    <nav className="hidden sm:flex items-center gap-4 text-sm">
      <Link
        href="/registry"
        className="text-white/80 hover:text-white transition-colors flex items-center gap-1"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
        Catalog
      </Link>
      <Link
        href="/registry/search"
        className="text-white/80 hover:text-white transition-colors flex items-center gap-1"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        Search
      </Link>
    </nav>
  );
}
