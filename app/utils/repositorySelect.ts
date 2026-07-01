import { Repository } from '@/app/types/registry';

/**
 * Pure selection logic for the repository catalog: filter -> sort -> paginate.
 *
 * The displayed repository list is a pure function of the loaded catalog plus
 * the active filters and the current page. Centralizing it here (and deriving it
 * with a single useMemo in the page) removes the previous design where ~30
 * imperative effects each recomputed the list, racing each other — the cause of
 * "searching, then paging to the next page, resets the search".
 */

export interface RepositorySelectInput {
  allRepositories: Repository[];
  searchQuery: string;
  searchType: 'all' | 'repository' | 'registry';
  viewMode: 'all' | 'current';
  /** The registry to restrict to in "current" view mode (null = none selected). */
  currentRegistryId: string | null;
  currentPage: number;
  pageSize: number;
}

export interface RepositorySelectResult {
  /** Full filtered + sorted list across all pages. */
  filtered: Repository[];
  /** Number of pages for `filtered` (0 when empty, matching the legacy count). */
  totalPages: number;
  /** The page actually sliced (currentPage clamped into range). */
  effectivePage: number;
  /** The slice of `filtered` for the effective page. */
  pageItems: Repository[];
}

function sortRepositories(repos: Repository[], viewMode: 'all' | 'current'): Repository[] {
  return [...repos].sort((a, b) => {
    if (viewMode === 'all') {
      const registryCompare = a.registry.localeCompare(b.registry);
      if (registryCompare !== 0) {
        return registryCompare;
      }
    }
    // In both modes, fall back to sorting by repository name.
    return a.name.localeCompare(b.name);
  });
}

/**
 * Filter + sort the catalog. The single source of truth for which repositories
 * match the current view mode, registry, and search query.
 */
export function filterRepositories(input: RepositorySelectInput): Repository[] {
  const { allRepositories, searchQuery, searchType, viewMode, currentRegistryId } = input;

  // Registry search has its own results list; it never shows repositories.
  if (searchType === 'registry') {
    return [];
  }

  // In "current" mode, restrict to the selected registry. With no registry
  // selected, there is nothing to show.
  const base =
    viewMode === 'all'
      ? allRepositories
      : currentRegistryId
        ? allRepositories.filter((repo) => repo.registryId === currentRegistryId)
        : [];

  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return sortRepositories(base, viewMode);
  }

  // Match by repository name (applies to both 'repository' and 'all' search).
  let matches = base.filter((repo) => repo.name.toLowerCase().includes(query));

  // In "all" search, also include repositories whose registry name matches the
  // query, then de-duplicate by registry+name.
  if (searchType === 'all') {
    const registryMatches = allRepositories.filter(
      (repo) =>
        repo.registry.toLowerCase().includes(query) &&
        (viewMode === 'all' || repo.registryId === currentRegistryId),
    );
    const byKey = new Map<string, Repository>();
    [...matches, ...registryMatches].forEach((repo) => {
      byKey.set(`${repo.registry}-${repo.name}`, repo);
    });
    matches = Array.from(byKey.values());
  }

  return sortRepositories(matches, viewMode);
}

/**
 * Filter + sort + paginate. The page is clamped into range so a narrowed search
 * (fewer pages than the current page) never lands on an empty slice.
 */
export function selectRepositories(input: RepositorySelectInput): RepositorySelectResult {
  const { currentPage, pageSize } = input;
  const filtered = filterRepositories(input);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const effectivePage = Math.min(Math.max(1, currentPage), Math.max(1, totalPages));

  const startIndex = (effectivePage - 1) * pageSize;
  const pageItems = filtered.slice(startIndex, startIndex + pageSize);

  return { filtered, totalPages, effectivePage, pageItems };
}
