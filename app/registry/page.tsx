'use client';

import { useState, useEffect, useCallback, useRef, Suspense, useMemo, Fragment } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import RegistryManager from '@/app/components/RegistryManager';
import SearchBox from '@/app/components/SearchBox';
import RepositoryCard from '@/app/components/RepositoryCard';
import RegistryCard from '@/app/components/RegistryCard';
import SkeletonCard from '@/app/components/SkeletonCard';
import SkeletonRegistryCard from '@/app/components/SkeletonRegistryCard';
import { Repository, Registry } from '@/app/types/registry';
import registryService from '@/app/services/registryService';
import SessionInfo from '@/app/components/SessionInfo';
import { useRepositoryContext } from '@/app/contexts/RepositoryContext';
import { REGISTRY_EVENTS } from '@/app/utils/constants';
import { selectRepositories } from '@/app/utils/repositorySelect';

// Track in-flight requests to prevent duplicates
const pendingRequests = new Map<string, Promise<any>>();
// Cache for repository data to avoid redundant fetches
const repositoryCache = new Map<string, {
  timestamp: number,
  data: Repository[]
}>();

// Set cache expiration time (5 minutes)
const CACHE_EXPIRATION = 5 * 60 * 1000;

// Define the SearchType type
type SearchType = 'all' | 'repository' | 'registry';

// Create a client component that uses useSearchParams
function RegistryPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Use the shared context for state
  const {
    repositories: allRepositories,
    registries: availableRegistries,
    isLoading: loading,
    searchQuery,
    viewMode,
    searchType,
    registryRepoCounts,
    currentPage,
    setRepositories: setAllRepositories,
    setRegistries: setAvailableRegistries,
    setIsLoading: setLoading,
    setSearchQuery,
    setViewMode,
    setSearchType,
    setRegistryRepoCounts,
    setCurrentPage,
    registryFilter,
    setRegistryFilter
  } = useRepositoryContext();
  
  // Local state not shared through context
  const [error, setError] = useState('');
  const [displayedRegistries, setDisplayedRegistries] = useState<Registry[]>([]);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const pageSize = 20;

  // The displayed repositories are DERIVED from the catalog + filters + page, in
  // a single place. Because this is a pure derivation (not state synced by
  // effects), nothing can clobber the search filter when paging — which was the
  // root cause of "next page resets the search".
  const currentRegistryId = registryFilter || registryService.getCurrentRegistryId() || null;
  const {
    filtered: filteredRepositories,
    totalPages: filteredTotalPages,
    pageItems: displayedRepos,
  } = useMemo(
    () =>
      selectRepositories({
        allRepositories,
        searchQuery,
        searchType,
        viewMode,
        currentRegistryId,
        currentPage,
        pageSize,
      }),
    [allRepositories, searchQuery, searchType, viewMode, currentRegistryId, currentPage, pageSize],
  );

  // Keep the page number in range when the filtered set shrinks (e.g. toggling
  // view mode or switching registry without an explicit page reset) so the
  // pagination footer/buttons stay consistent with the displayed slice.
  useEffect(() => {
    if (filteredTotalPages > 0 && currentPage > filteredTotalPages) {
      setCurrentPage(filteredTotalPages);
    }
  }, [currentPage, filteredTotalPages, setCurrentPage]);

  // Add loadingInitiated ref at the component level
  const prevSearchType = useRef(searchType);
  const prevDisplayedRegistriesLength = useRef(0);
  // Reference to track if loading has been initiated
  const loadingInitiated = useRef(false);
  
  // Log registry data only when values change
  useEffect(() => {
    // Only log when in development and when registry search is active
    if (process.env.NODE_ENV === 'development' && searchType === 'registry') {
      // Only log if searchType or displayedRegistries.length has changed
      if (prevSearchType.current !== searchType || 
          prevDisplayedRegistriesLength.current !== displayedRegistries.length) {
        
        console.log("Registry search results updated:", {
          count: displayedRegistries.length,
          data: displayedRegistries.map(r => ({
            id: r.id,
            server: r.server,
            count: r.id ? registryRepoCounts[r.id] : 'unknown'
          }))
        });
        
        // Update refs for next comparison
        prevSearchType.current = searchType;
        prevDisplayedRegistriesLength.current = displayedRegistries.length;
      }
    }
  }, [searchType, displayedRegistries, registryRepoCounts]);

  // Handle registry filtering via context state
  useEffect(() => {
    // If registryFilter is set, use it to set the current registry
    if (registryFilter) {
      const registry = availableRegistries.find(r => r.id === registryFilter);
      if (registry && registry.id) {
        // Set the current registry in the service
        registryService.setCurrentRegistry(registry.id);
        console.log(`Set current registry to ${registry.server} (${registry.id}) from context registryFilter`);
      }
    }
  }, [registryFilter, availableRegistries]);

  // Initialize
  useEffect(() => {
    // Initialize the global variable for special registries
    if (typeof window !== 'undefined') {
      (window as any).__emptyResponseRegistries = new Set<string>();
      if (process.env.NODE_ENV === 'development') {
        console.log("Initialized empty response registries tracking");
      }
    }
    
    // Check URL parameters on initial load for backward compatibility 
    const registryIdFromUrl = searchParams.get('registry');
    if (registryIdFromUrl) {
      // If URL has registry parameter, update context state
      setRegistryFilter(registryIdFromUrl);
      setViewMode('current');
      console.log(`Initializing from URL parameter: registry=${registryIdFromUrl}`);
    }
  }, [searchParams, setRegistryFilter, setViewMode]);

  // Function to validate cache entries to ensure they contain valid data
  const validateCacheEntry = useCallback((cacheKey: string): boolean => {
    const cachedData = repositoryCache.get(cacheKey);
    
    if (!cachedData) {
      console.log(`No cache entry found for ${cacheKey}`);
      return false;
    }
    
    const now = Date.now();
    const isExpired = now - cachedData.timestamp > CACHE_EXPIRATION;
    
    if (isExpired) {
      console.log(`Cache entry for ${cacheKey} is expired (age: ${Math.round((now - cachedData.timestamp)/1000)}s)`);
      // Remove expired entries automatically
      repositoryCache.delete(cacheKey);
      return false;
    }
    
    // Check if cache actually contains data
    const hasValidData = cachedData.data && 
                        Array.isArray(cachedData.data) && 
                        cachedData.data.length > 0;
    
    if (!hasValidData) {
      console.log(`Cache entry for ${cacheKey} contains no valid data`);
      
      // Clean up invalid cache entries
      repositoryCache.delete(cacheKey);
      return false;
    }
    
    return true;
  }, []);

  const loadRepositories = useCallback(async () => {
    // Track when loading is initiated
    if (typeof window !== 'undefined' && !(window as any).__loadingState) {
      (window as any).__loadingState = { 
        loading: false,
        timestamp: 0,
        displayedReposCount: 0
      };
    }
    
    // Flag to track if we're just toggling view mode
    const isViewModeChange = (window as any).__isViewModeChange === true;
    // Reset the flag after checking
    if (typeof window !== 'undefined') {
      (window as any).__isViewModeChange = false;
    }
    
    // Get current registry ID to track if we're switching registries
    const currentRegistryId = registryService.getCurrentRegistryId();
    
    // Track the last loaded registry to detect registry changes
    const lastLoadedRegistryId = (window as any).__lastLoadedRegistryId;
    const isRegistryChange = lastLoadedRegistryId && lastLoadedRegistryId !== currentRegistryId;
    
    // Update last loaded registry
    (window as any).__lastLoadedRegistryId = currentRegistryId;
    
    // For view mode / registry changes with existing data, no refetch is needed:
    // the derived `displayedRepos` memo already reflects the new view mode and
    // registry. Just mark the load complete.
    if ((isViewModeChange || isRegistryChange) && allRepositories.length > 0) {
      console.log(`${isViewModeChange ? 'View mode change' : 'Registry change'} detected with existing data, filtering without full reload`);
      setInitialLoadComplete(true);

      // If this was a registry change but the registry isn't in memory, continue with the load
      if (isRegistryChange) {
        const currentRegistry = registryService.getCurrentRegistry();
        const hasReposForCurrentRegistry = allRepositories.some(
          repo => repo.registryId === currentRegistry?.id
        );

        // If we don't have any repositories for this registry, continue with the load
        if (!hasReposForCurrentRegistry) {
          console.log('No repositories found in memory for selected registry, continuing with load');
        } else {
          // Otherwise we already have the data in memory, skip the rest
          return;
        }
      } else {
        // For view mode changes, always skip the rest
        return;
      }
    }

    // If registry has changed, log it and clear all cached repositories to force a reload
    if (isRegistryChange) {
      console.log(`Registry changed from ${lastLoadedRegistryId} to ${currentRegistryId}, clearing cache and forcing fresh load`);
      
      // Clear repo data to ensure fresh load
      setAllRepositories([]);

      // Add a small delay to ensure state is updated before proceeding
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Prevent redundant loads if we're both actively loading AND already have data
    // BUT always allow loads when switching registries
    const isAlreadyLoading = loading;
    const hasDisplayedData = allRepositories.length > 0;

    // Check if we recently started loading (within 3 seconds)
    const now = Date.now();
    const lastLoadTimestamp = (window as any).__loadingState?.timestamp || 0;
    const loadingJustStarted = (now - lastLoadTimestamp) < 3000;

    // Track loading state for debugging
    if (typeof window !== 'undefined') {
      (window as any).__loadingState = {
        loading: isAlreadyLoading,
        timestamp: isAlreadyLoading ? now : lastLoadTimestamp,
        displayedReposCount: allRepositories.length,
        currentRegistryId
      };
    }
    
    // Block redundant requests ONLY if:
    // 1. We're already loading AND
    // 2. We have data displayed OR we just started loading (prevent duplicates when clicking fast)
    // 3. AND we're not switching registries
    if (isAlreadyLoading && (hasDisplayedData || loadingJustStarted) && !isRegistryChange) {
      console.log('Blocking redundant repository request:', {
        alreadyLoading: isAlreadyLoading,
        hasDisplayedData,
        loadingJustStarted,
        isRegistryChange,
        timeSinceLastLoad: now - lastLoadTimestamp,
        repositories: allRepositories.length
      });
      return;
    }
    
    // If we're switching registries or need a force reload, log it
    if (isRegistryChange) {
      console.log(`Registry changed from ${lastLoadedRegistryId} to ${currentRegistryId}, forcing fresh load`);
    }
    
    // If we're loading but have no displayed data, we should allow the request to proceed
    if (isAlreadyLoading && !hasDisplayedData) {
      console.log('Loading but no data displayed, allowing request to proceed');
    }
    
    try {
      setLoading(true);
      setError('');
      
      // Update loading state timestamp
      if (typeof window !== 'undefined') {
        (window as any).__loadingState.timestamp = now;
        (window as any).__loadingState.loading = true;
      }
      
      // For registry changes, always do a fresh load - don't use cached data
      if (isRegistryChange) {
        console.log('Registry change detected, forcing fresh load by skipping cache validation');
      }
      
      // Check if we really have valid repositories for the current registry
      const currentRegistry = registryService.getCurrentRegistry();
      const hasValidCachedDataForCurrentRegistry =
        !isRegistryChange && // Never use cache for registry changes
        currentRegistry &&
        allRepositories.length > 0 &&
        // Ensure we have repositories for this registry
        allRepositories.some(repo => repo.registryId === currentRegistry.id);

      if (hasValidCachedDataForCurrentRegistry) {
        console.log('Using cached repositories for current registry');
        // displayedRepos is derived from allRepositories; nothing to recompute.
        setInitialLoadComplete(true);
        setLoading(false);

        if (typeof window !== 'undefined') {
          (window as any).__loadingState.loading = false;
          (window as any).__loadingState.displayedReposCount = allRepositories.length;
        }

        return;
      }

      const selectedRegistry = currentRegistry || (availableRegistries.length > 0 ? availableRegistries[0] : null);

      if (!selectedRegistry) {
        console.log('No registry selected, redirecting to home');
        router.push('/');
        return;
      }

      // If we fell back to the first available registry (no current registry set),
      // make it current so the derived `displayedRepos` memo can resolve it in
      // "current" view mode (otherwise the load succeeds but renders empty).
      if (!currentRegistry && selectedRegistry.id) {
        registryService.setCurrentRegistry(selectedRegistry.id);
        setRegistryFilter(selectedRegistry.id);
      }

      console.log(`Loading repositories for registry: ${selectedRegistry.server}`);
      
      // Create a cache key for this fetch
      const cacheKey = `catalog-${selectedRegistry.server}`;
      
      // Check if there's already a request in progress for this registry
      if (pendingRequests.has(cacheKey)) {
        console.log(`Request already in progress for ${selectedRegistry.server}, using existing promise`);
        // Wait for the existing request to complete
        await pendingRequests.get(cacheKey);
        
        // Get cached results if available
        if (repositoryCache.has(cacheKey)) {
          const cachedData = repositoryCache.get(cacheKey);
          if (cachedData && validateCacheEntry(cacheKey)) {
            console.log(`Using cached data for ${selectedRegistry.server} after waiting for in-progress request`);
            
            // Create repository objects from cache
            const repoList = cachedData.data;
            
            // Update repositories (displayedRepos derives from this).
            setAllRepositories(repoList);

            setInitialLoadComplete(true);
            setLoading(false);

            // Update loading state
            if (typeof window !== 'undefined') {
              (window as any).__loadingState.loading = false;
              (window as any).__loadingState.displayedReposCount = repoList.length;
            }

            return;
          }
        }
      }

      // Fetch repositories from the selected registry
      // eslint-disable-next-line react-hooks/immutability -- hoisted const arrow used before declaration; pre-existing
      const repos = await fetchRepositoriesForRegistry(selectedRegistry, cacheKey);
      console.log(`Loaded ${repos.repositories.length} repositories`);
      
      // Create repository objects
      const repoList = repos.repositories.map((name: string) => ({
            name,
        registry: selectedRegistry.server,
        registryId: selectedRegistry.id
      }));
      
      // Update the main repository list (displayedRepos derives from this).
      setAllRepositories(repoList);

      // In "all" mode, merge the newly loaded repositories with those already in
      // memory from other registries so the catalog spans every connected registry.
      if (viewMode === 'all' && allRepositories.length > 0 && selectedRegistry.id) {
        // Drop any existing repos for this registry to avoid duplicates, then merge.
        const existingRepos = allRepositories.filter(
          repo => repo.registryId !== selectedRegistry.id
        );
        const combinedRepos = [...existingRepos, ...repoList];

        // Sort by registry first, then by name.
        const sortedRepos = combinedRepos.sort((a, b) => {
          const registryCompare = a.registry.localeCompare(b.registry);
          if (registryCompare !== 0) {
            return registryCompare;
          }
          return a.name.localeCompare(b.name);
        });

        setAllRepositories(sortedRepos);
      }
      
      // Count repositories and tags for each registry
      if (viewMode === 'all' && searchType === 'registry') {
        // In this case we need to load repository counts
        const repoCountsByRegistry: Record<string, number> = {};
        repoCountsByRegistry[selectedRegistry.id || ''] = repoList.length;
      setRegistryRepoCounts(repoCountsByRegistry);
      }
      
      // The fetch completed (repoList may be empty for a registry with no repos,
      // which is a valid state). Mark the initial load complete; the derived
      // displayedRepos memo renders whatever matches the current filters.
      console.log(`Loaded ${repoList.length} repositories for ${selectedRegistry.server}`);
      setInitialLoadComplete(true);
    } catch (error) {
      console.error('Failed to load repositories:', error);
      setError('Failed to load repositories. Please try again.');
      // Even on error, mark load as complete to show error message
      setInitialLoadComplete(true);
      if (process.env.NODE_ENV === 'development') {
        console.log('Initial load marked as complete despite error to show error message');
      }
    } finally {
      setLoading(false);

      // Update loading state
      if (typeof window !== 'undefined') {
        (window as any).__loadingState.loading = false;
        (window as any).__loadingState.displayedReposCount = allRepositories.length;
      }
    }
  }, [
    loading,
    availableRegistries,
    allRepositories,
    viewMode,
    searchType,
    router,
    setAllRepositories,
    setRegistryRepoCounts,
    setRegistryFilter,
    setLoading,
    validateCacheEntry
  ]);

  // The full filtered+sorted list (all pages), derived once in the memo above.
  // Kept as a function for the existing call sites (pagination footer counts).
  const getFilteredRepositories = useCallback(() => filteredRepositories, [filteredRepositories]);

  // Function to handle search when registry type is selected
  const handleRegistrySearch = (query: string) => {
    if (process.env.NODE_ENV === 'development') {
      console.log("Registry search triggered with query:", query);
    }
    
    try {
      // Preserve the current registry ID before filtering
      const currentRegistryData = registryService.getCurrentRegistry();
      const currentRegistryId = currentRegistryData ? currentRegistryData.id : null;
      
      // Get all available registries
      const allAvailableRegistries = registryService.getAllRegistries();
      
      // In "current" mode, only show the current registry
      let registriesToDisplay = allAvailableRegistries;
      if (viewMode === 'current' && currentRegistryId) {
        registriesToDisplay = allAvailableRegistries.filter(r => r.id === currentRegistryId);
      }
      
      // Filter registries by the search query
      const filteredRegistries = query.trim() ? 
        registriesToDisplay.filter(reg => 
          reg.server.toLowerCase().includes(query.toLowerCase())
        ) : registriesToDisplay;
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`Registry search found ${filteredRegistries.length} registries with query "${query}"`);
      }
      
      // Check if registries have actually changed to avoid unnecessary state updates
      const registriesChanged = JSON.stringify(displayedRegistries.map(r => r.id)) !== 
                               JSON.stringify(filteredRegistries.map(r => r.id));
      
      // Always update available registries to ensure we have the complete list
      setAvailableRegistries(allAvailableRegistries);
      
      // Update displayed registries if they've changed
      if (registriesChanged) {
        setDisplayedRegistries(filteredRegistries);
        
        // Skip excessive logging in production
        if (process.env.NODE_ENV === 'development') {
          // Log counts for debugging
          const counts = filteredRegistries.reduce((acc, registry) => {
            if (registry.id) {
              // Ensure we have a count, default to calculating from allRepositories if not in registryRepoCounts
              let count = registryRepoCounts[registry.id] || 0;
              
              // If repository count is 0, try to calculate from allRepositories as a fallback
              if (count === 0 && allRepositories.length > 0) {
                count = allRepositories.filter(repo => repo.registryId === registry.id).length;
                
                // Update the registryRepoCounts for next time
                if (count > 0) {
                  const newCounts = { ...registryRepoCounts };
                  newCounts[registry.id] = count;
                  setRegistryRepoCounts(newCounts);
                }
              }
              
              acc[registry.id] = count;
            }
            return acc;
          }, {} as Record<string, number>);
          
          console.log("Registry counts for display:", counts);
        }
      } else if (process.env.NODE_ENV === 'development') {
        console.log("Registry results haven't changed, skipping re-render");
      }
      
      // Make sure we count repositories for all registries
      if (allRepositories.length > 0) {
        // Calculate counts from in-memory repositories
        const repoCountsByRegistry: Record<string, number> = {};
        allAvailableRegistries.forEach(reg => {
          if (reg.id) {
            // Count repositories for this registry
            const repoCount = allRepositories.filter(repo => repo.registryId === reg.id).length;
            repoCountsByRegistry[reg.id] = repoCount;
          }
        });
        
        // Update the registry repository counts
        setRegistryRepoCounts(repoCountsByRegistry);
      } else {
        // If we don't have repositories yet, load repository counts
        // eslint-disable-next-line react-hooks/immutability -- hoisted const arrow used before declaration; pre-existing
        loadRepositoriesFromAllRegistries();
      }
      
      // Restore the current registry selection
      if (currentRegistryId) {
        registryService.setCurrentRegistry(currentRegistryId);
      }
    } catch (err) {
      console.error("Error during registry search:", err);
    }
  };

  // Main search handler that delegates to specific search handlers
  const handleSearch = useCallback((query: string) => {
    // Prevent duplicate search calls with the same query
    if (query === searchQuery && allRepositories.length > 0) {
      console.log(`Search already applied for query: "${query}", skipping duplicate search`);
      return;
    }

    console.log(`Search triggered with query: "${query}", search type: ${searchType}`);

    // Update the search query state
    setSearchQuery(query);

    if (searchType === 'registry') {
      handleRegistrySearch(query);
    } else {
      // Repository search: the derived `displayedRepos` memo filters by the new
      // query; just jump back to the first page of results.
      setCurrentPage(1);
    }
  }, [searchType, searchQuery, allRepositories.length, setSearchQuery, setCurrentPage]);

  // First load repositories
  useEffect(() => {
    // Track the registry ID we loaded data for to detect real changes
    const registryIdAtLoadTime = registryService.getCurrentRegistryId();
    
    // Store the registry ID we're loading data for to compare later
    if (typeof window !== 'undefined') {
      const lastLoadedRegistry = (window as any).__lastLoadedRegistryId;
      const isRegistryChange = lastLoadedRegistry && lastLoadedRegistry !== registryIdAtLoadTime;
      
      // If registry has changed, force a reload
      if (isRegistryChange) {
        console.log(`Registry has changed from ${lastLoadedRegistry} to ${registryIdAtLoadTime}, forcing reload`);
        loadingInitiated.current = false; // Reset loading state
      }
      
      // Always update the last loaded registry ID
      (window as any).__lastLoadedRegistryId = registryIdAtLoadTime;
    }
    
    // Check if the registry in URL differs from current selection - if so, force a reload
    if (registryFilter && registryFilter !== registryIdAtLoadTime) {
      console.log(`Registry in context (${registryFilter}) differs from current selection (${registryIdAtLoadTime}), forcing reload`);
      registryService.setCurrentRegistry(registryFilter);
      // Force view mode to 'current' when viewing a specific registry
      setViewMode('current');
      loadingInitiated.current = false; // Reset loading state
    }
    
    // Get the current registry ID - this is what we're currently displaying
    const currentRegistryId = registryService.getCurrentRegistryId();
    
    // Check if we already have repositories loaded for the current registry.
    const haveReposForCurrentRegistry =
      viewMode === 'current' &&
      !!currentRegistryId &&
      allRepositories.some(repo => repo.registryId === currentRegistryId);

    // Skip loading if we already have data that matches what we need
    if (loadingInitiated.current &&
      initialLoadComplete &&
      allRepositories.length > 0 &&
        (viewMode !== 'current' || haveReposForCurrentRegistry)) {
      console.log('Skipping repository load - criteria for skipping met');
      return;
    }

    // Also skip if initial load completed with no repositories
    // (e.g., registry doesn't support catalog listing like docker.io or registry.k8s.io)
    if (loadingInitiated.current && initialLoadComplete &&
        allRepositories.length === 0) {
      console.log('Skipping repository load - no repositories available for this registry');
      return;
    }

    // Set the loading initiated flag
    loadingInitiated.current = true;

    // Load repositories
      loadRepositories();

  }, [registryFilter, initialLoadComplete, allRepositories, viewMode, loadRepositories]);
  
  // Update loadRepositoriesFromAllRegistries to use cache validation and fetchRepositoriesForRegistry
  const loadRepositoriesFromAllRegistries = async (forceReload = false) => {
    try {
      setLoading(true);
      
      // Get all registries
      const allRegistries = registryService.getAllRegistries();
      
      // Check if we already have counts for all registries
      let allRegistriesHaveCounts = true;
      
      // Track if this is a view mode change
      const isViewModeChange = (window as any).__isViewModeChange === true;
      
      // Track repositories by registry
      const repoCountsByRegistry: Record<string, number> = {};
      allRegistries.forEach(reg => {
        if (reg.id) {
          repoCountsByRegistry[reg.id] = 0;
          
          // Check if we already have a count for this registry
          if (registryRepoCounts[reg.id] === undefined) {
            allRegistriesHaveCounts = false;
          } else {
            // Use existing count
            repoCountsByRegistry[reg.id] = registryRepoCounts[reg.id];
          }
        }
      });
      
      // If we're just changing view mode and we have all the data, skip loading
      if (isViewModeChange && allRepositories.length > 0 && !forceReload) {
        console.log("View mode change detected, using in-memory data for registry counts");
        
        // Calculate counts from existing repositories
        allRegistries.forEach(reg => {
          if (reg.id) {
            // Count repositories for this registry from in-memory data
            const repoCount = allRepositories.filter(repo => repo.registryId === reg.id).length;
            repoCountsByRegistry[reg.id] = repoCount;
          }
        });
        
        // Update counts
        setRegistryRepoCounts(repoCountsByRegistry);
        setLoading(false);
        return;
      }
      
      // If we already have counts for all registries and not forcing reload, skip loading
      if (!forceReload && allRegistriesHaveCounts && Object.keys(repoCountsByRegistry).length > 0) {
        if (process.env.NODE_ENV === 'development') {
          console.log("Using existing repository counts:", repoCountsByRegistry);
        }
        setLoading(false);
        return;
      }
      
      console.log("Loading repositories from all registries" + (forceReload ? " (forced)" : ""));
      
      // To store all repositories from all registries
      let allReposList: Repository[] = [];
      
      // Load repositories from each registry
      const loadingPromises = allRegistries.map(async (registry) => {
        try {
          console.log(`Loading repositories from ${registry.server}...`);
          
          // Skip registries we already have data for unless forced
          if (!forceReload && registry.id && allRepositories.filter(repo => repo.registryId === registry.id).length > 0) {
            // Get existing repositories for this registry
            const existingRepos = allRepositories.filter(repo => repo.registryId === registry.id);
            console.log(`Using ${existingRepos.length} existing repositories for ${registry.server}`);
            
            // Update count
            repoCountsByRegistry[registry.id] = existingRepos.length;
            
            // Add to our complete list
            allReposList = [...allReposList, ...existingRepos];
            
            return existingRepos.length;
          }
          
          // Use the same caching mechanism as loadRepositories
          const cacheKey = `catalog-${registry.server}`;
          
          // Force validation of cache - this will clean up invalid entries
          validateCacheEntry(cacheKey);
          
          // Skip cache use if forceReload is set
          if (forceReload) {
            repositoryCache.delete(cacheKey);
          }
          
          // Get repositories (will use cache if valid)
          const response = await fetchRepositoriesForRegistry(registry, cacheKey);
          const repositories = response.repositories || [];
          
          // Create Repository objects for this registry
          const registryRepos = repositories.map((name: string) => ({
            name,
            registry: registry.server,
            registryId: registry.id
          }));
          
          // Add to our complete list
          allReposList = [...allReposList, ...registryRepos];
          
          // Track the count of repositories for this registry
          if (registry.id) {
            repoCountsByRegistry[registry.id] = repositories.length;
          }
          
          // Return the count for debugging
          return repositories.length;
        } catch (err) {
          console.error(`Failed to load repositories from ${registry.server}:`, err);
          return 0;
        }
      });
      
      // Wait for all promises to resolve
      await Promise.all(loadingPromises);
      
      console.log(`Loaded a total of ${allReposList.length} repositories from ${allRegistries.length} registries`);
      
      // Sort the combined list
      allReposList.sort((a, b) => {
        // First by registry
        const registryCompare = a.registry.localeCompare(b.registry);
        if (registryCompare !== 0) {
          return registryCompare;
        }
        // Then by name
        return a.name.localeCompare(b.name);
      });
      
      // Update the main repository list with all repositories (displayedRepos
      // derives from this).
      setAllRepositories(allReposList);

      // Set the count of repositories per registry
      setRegistryRepoCounts(repoCountsByRegistry);

      // Mark initial load as complete
      setInitialLoadComplete(true);
      
      if (process.env.NODE_ENV === 'development') {
        console.log("Registry repository counts updated:", repoCountsByRegistry);
      }
    } catch (err) {
      console.error('Failed to load repositories from all registries:', err);
    } finally {
      setLoading(false);
    }
  };

  // Modified fetchRepositoriesForRegistry to validate cache
  const fetchRepositoriesForRegistry = async (registry: Registry, cacheKey: string) => {
    // Track registry switches to force cache refresh
    const isRegistrySwitch = (window as any).__lastLoadedRegistryId 
                           && (window as any).__lastLoadedRegistryId !== registry.id;
    
    // Check if this is the current registry the user has selected
    const isCurrentRegistry = registry.id === registryService.getCurrentRegistryId();
    
    // Track last registry request
    if (typeof window !== 'undefined' && !(window as any).__lastRegistryRequest) {
      (window as any).__lastRegistryRequest = {};
    }
    
    // In memory cache check - if we already have repositories for this registry in allRepositories,
    // we can use those instead of making a new request
    const hasRepositoriesInMemory = allRepositories.some(repo => repo.registryId === registry.id);
    
    if (hasRepositoriesInMemory && !isRegistrySwitch) {
      console.log(`Using in-memory repositories for ${registry.server} without API call`);
      
      // Filter repositories for this registry from memory
      const repoNames = allRepositories
        .filter(repo => repo.registryId === registry.id)
        .map(repo => repo.name);
      
      // Return the filtered repositories instead of making an API call
      return {
        repositories: repoNames
      };
    }
    
    // If we're switching registries, invalidate the cache
    // We want fresh data for the currently selected registry only when we don't have it in memory
    if ((isRegistrySwitch || isCurrentRegistry) && !hasRepositoriesInMemory) {
      console.log(`${isRegistrySwitch ? 'Registry switch detected' : 'Loading current registry'}, invalidating cache for ${registry.server}`);
      repositoryCache.delete(cacheKey);
      pendingRequests.delete(cacheKey);
    }
    
    // Check if we've made a request for this registry very recently (within 2 seconds)
    const now = Date.now();
    const lastRequestTime = (window as any).__lastRegistryRequest?.[cacheKey] || 0;
    const timeSinceLastRequest = now - lastRequestTime;
    
    // Only throttle non-current registries or registries we don't have in memory
    if (timeSinceLastRequest < 2000 && !isRegistrySwitch && (!isCurrentRegistry || hasRepositoriesInMemory)) {
      console.log(`Throttling request for ${registry.server} - last request was ${timeSinceLastRequest}ms ago`);
      
      // If we have pending request, use it instead of creating a new one
      const pendingReq = pendingRequests.get(cacheKey);
      if (pendingReq) {
        console.log(`Using existing in-flight request for ${registry.server}`);
        return pendingReq;
      }
      
      // If we have valid cache, use it despite the recent request
      const cacheIsValid = validateCacheEntry(cacheKey);
      if (cacheIsValid) {
        const cachedData = repositoryCache.get(cacheKey);
        if (cachedData) {
          console.log(`Using cache for ${registry.server} due to throttling`);
          return {
            repositories: cachedData.data
              .filter(repo => repo.registry === registry.server)
              .map(repo => repo.name)
          };
        }
      }
    }
    
    // Update last request time
    if (typeof window !== 'undefined') {
      (window as any).__lastRegistryRequest[cacheKey] = now;
    }
    
    // First validate any existing cache entry
    // Never use cache for current registry during a registry switch or when there's no in-memory data
    const cacheIsValid = !isRegistrySwitch && 
                        (!isCurrentRegistry || hasRepositoriesInMemory) && 
                        validateCacheEntry(cacheKey);
    
    // Check if we've cached this registry before
    const cachedData = repositoryCache.get(cacheKey);
    
    // Either use valid cache or check for pending request
    if (cacheIsValid && cachedData) {
    if (process.env.NODE_ENV === 'development') {
        console.log(`Using validated cache for ${registry.server} (age: ${Math.round((now - cachedData.timestamp)/1000)}s, items: ${cachedData.data.length})`);
      }
      
      // Build response from cache
      return {
        repositories: cachedData.data
          .filter(repo => repo.registry === registry.server)
          .map(repo => repo.name)
      };
    }
    
    // If cache is invalid or missing, check for in-flight request
    let catalogPromise = pendingRequests.get(cacheKey);
    
    if (!catalogPromise) {
      // If no pending request, create a new one
    if (process.env.NODE_ENV === 'development') {
        console.log(`Making new API request for ${registry.server}`);
      }
      
      catalogPromise = registryService.getCatalog(registry, 1000, 1);
      
      // Store the promise to prevent duplicate requests
      pendingRequests.set(cacheKey, catalogPromise);
      
      // Remove from pending requests after it completes
      catalogPromise.finally(() => {
        pendingRequests.delete(cacheKey);
      });
    } else if (process.env.NODE_ENV === 'development') {
      console.log(`Using in-flight request for ${registry.server}`);
    }
    
    // Wait for the request to complete
    const response = await catalogPromise;
    
    // Validate the response
    if (!response || !response.repositories || !Array.isArray(response.repositories)) {
      console.warn(`Invalid response from registry ${registry.server}:`, response);
      throw new Error(`Invalid response from registry ${registry.server}`);
    }
    
    // Cache the result
    const repoList = response.repositories.map((name: string) => ({
      name,
      registry: registry.server,
      registryId: registry.id
    }));
    
    repositoryCache.set(cacheKey, {
      timestamp: now,
      data: repoList
    });
    
    // Debug cache
    if (process.env.NODE_ENV === 'development') {
      console.log(`Cached ${repoList.length} repositories for ${registry.server} at timestamp ${now}`);
    }
    
    return response;
  };

  // Rest of the loadRepositories function can now focus on just loading the
  // repositories needed for the current view mode

  // Set view mode based on available registries
  useEffect(() => {
    // If we only have one registry, force the viewMode to 'current'
    if (availableRegistries.length <= 1 && viewMode === 'all') {
      setViewMode('current');
    }
  }, [availableRegistries, viewMode]);

  // Helper function to get registry name by ID
  const getRegistryNameById = useCallback((registryId?: string): string => {
    if (!registryId) return '';
    
    const registry = availableRegistries.find(r => r.id === registryId);
    return registry ? registry.server : '';
  }, [availableRegistries]);

  // Function to render pagination
  const renderPagination = () => {
    if (getTotalPages() <= 1) return null;
    
    const totalPages = getTotalPages();
    const totalItems = getFilteredRepositories().length;
    const registriesText = viewMode === 'all' ? 'across all registries' : 'in current registry';
    
    // Create page buttons array
    const pageButtons = [];
    
    // First page button
    pageButtons.push(
      <button
        key="first"
        onClick={() => handlePageChange(1)}
        className={`px-3 py-1 rounded-md ${
          currentPage === 1 
            ? 'bg-gray-400 dark:bg-gray-600 text-white cursor-not-allowed'
            : 'bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300'
        }`}
        disabled={currentPage === 1}
        aria-label="First page"
      >
        «
      </button>
    );
    
    // Previous page button
    pageButtons.push(
      <button
        key="prev"
        onClick={() => handlePageChange(currentPage - 1)}
        className={`px-3 py-1 rounded-md ${
          currentPage === 1 
            ? 'bg-gray-400 dark:bg-gray-600 text-white cursor-not-allowed'
            : 'bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300'
        }`}
        disabled={currentPage === 1}
        aria-label="Previous page"
      >
        ‹
      </button>
    );
    
    // Calculate which page buttons to show
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    
    // Adjust if we're near the end
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }
    
    // Add first page with ellipsis if needed
    if (startPage > 1) {
      pageButtons.push(
        <button
          key={1}
          onClick={() => handlePageChange(1)}
          className="px-3 py-1 rounded-md bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300"
          aria-label="Page 1"
        >
          1
        </button>
      );
      
      if (startPage > 2) {
        pageButtons.push(
          <span key="ellipsis1" className="px-2 py-1 text-gray-500 dark:text-gray-400 font-medium">
            ...
          </span>
        );
      }
    }
    
    // Add page buttons
    for (let i = startPage; i <= endPage; i++) {
      pageButtons.push(
        <button
          key={i}
          onClick={() => handlePageChange(i)}
          className={`px-3 py-1 rounded-md ${
            currentPage === i
              ? 'bg-secondaryBlue dark:bg-blue-600 text-white font-bold'
              : 'bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300'
          }`}
          aria-current={currentPage === i ? 'page' : undefined}
          aria-label={`Page ${i}`}
        >
          {i}
        </button>
      );
    }
    
    // Add last page with ellipsis if needed
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pageButtons.push(
          <span key="ellipsis2" className="px-2 py-1 text-gray-500 dark:text-gray-400 font-medium">
            ...
          </span>
        );
      }
      
      pageButtons.push(
        <button
          key={totalPages}
          onClick={() => handlePageChange(totalPages)}
          className="px-3 py-1 rounded-md bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300"
          aria-label={`Page ${totalPages}`}
        >
          {totalPages}
        </button>
      );
    }
    
    // Next page button
    pageButtons.push(
      <button
        key="next"
        onClick={() => handlePageChange(currentPage + 1)}
        className={`px-3 py-1 rounded-md ${
          currentPage === totalPages 
            ? 'bg-gray-400 dark:bg-gray-600 text-white cursor-not-allowed'
            : 'bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300'
        }`}
        disabled={currentPage === totalPages}
        aria-label="Next page"
      >
        ›
      </button>
    );
    
    // Last page button
    pageButtons.push(
      <button
        key="last"
        onClick={() => handlePageChange(totalPages)}
        className={`px-3 py-1 rounded-md ${
          currentPage === totalPages 
            ? 'bg-gray-400 dark:bg-gray-600 text-white cursor-not-allowed'
            : 'bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300'
        }`}
        disabled={currentPage === totalPages}
        aria-label="Last page"
      >
        »
      </button>
    );
    
    return (
      <div className="flex flex-col items-center justify-center mt-6 mb-20 space-y-3 bg-transparent">
        <div className="flex items-center space-x-2">
          {pageButtons}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          Page {currentPage} of {totalPages} ({totalItems} repositories {registriesText})
        </div>
      </div>
    );
  };

  // Total pages for the filtered list, derived once in the memo above.
  const getTotalPages = () => filteredTotalPages;

  // Function to get placeholder text based on search type
  const getSearchPlaceholder = (): string => {
    switch (searchType) {
      case 'repository':
        return 'Search for repositories';
      case 'registry':
        return 'Search for registries';
      default:
        return 'Search for repositories or registries';
    }
  };

  // Memoize these elements to prevent re-rendering
  const renderSkeletonRepositories = useMemo(() => {
    const skeletons = [];
    for (let i = 0; i < 8; i++) {
      skeletons.push(
        <SkeletonCard key={`skeleton-repo-${i}`} showRegistry={viewMode === 'all'} />
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-6">
        {skeletons}
      </div>
    );
  }, [viewMode]);

  const renderSkeletonRegistries = useMemo(() => {
    const skeletons = [];
    for (let i = 0; i < 4; i++) {
      skeletons.push(
        <SkeletonRegistryCard key={`skeleton-reg-${i}`} />
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-6">
        {skeletons}
      </div>
    );
  }, []);

  // (View-mode/search/page filtering is handled by the derived `displayedRepos`
  // memo near the top of the component — no effect needed.)

  // Function to force reload all data - can be used to recover from stale state
  const forceReloadRepositories = useCallback(async () => {
    console.log("Forcing complete repository reload");
    
    // Mark loading as not initiated to allow fresh reload
    loadingInitiated.current = false;
    
    // Reset loading state
    setLoading(true);
    setInitialLoadComplete(false);
    
    // Get current registry
    const currentRegistry = registryService.getCurrentRegistry();
    
    // Reload all registries first
    const allAvailableRegistries = registryService.getAllRegistries();
    setAvailableRegistries(allAvailableRegistries);
    
    if (searchType === 'registry') {
      // In registry mode, update displayed registries
      if (viewMode === 'current' && currentRegistry) {
        setDisplayedRegistries([currentRegistry]);
      } else {
        setDisplayedRegistries(allAvailableRegistries);
      }
    }
    
    try {
      // First reload repositories from all registries for counts
      await loadRepositoriesFromAllRegistries(true); // Force reload
      
      // Then load repositories for the current view
      await loadRepositories();
    } catch (error) {
      console.error("Force reload failed:", error);
      setError("Failed to reload repositories. Please refresh the page.");
      
      // Ensure we exit loading state even on error
      setLoading(false);
      setInitialLoadComplete(true);
    }
  }, [loadRepositories, searchType, viewMode]);

  // Add force reload to recovery useEffect
  useEffect(() => {
    // If loading is true for too long, this indicates a stuck state
    let loadingTimeoutId: NodeJS.Timeout | null = null;
    
    if (loading) {
      // Set a timeout to force-clear loading state if it stays active too long
      loadingTimeoutId = setTimeout(() => {
        console.warn('Loading state has been active for too long, forcing reset');
        setLoading(false);
        
        // Only attempt recovery if initial load hasn't completed yet.
        // If it completed with 0 repos, that's a valid final state — don't loop.
        if (!initialLoadComplete && allRepositories.length === 0) {
          console.log('No repository data available, attempting recovery reload');
          forceReloadRepositories();
        }

        // Always mark initial load complete to avoid blank screens
        setInitialLoadComplete(true);
      }, 15000); // 15 seconds is usually more than enough for any real load
    }

    return () => {
      // Clean up timeout on unmount or when loading state changes
      if (loadingTimeoutId) {
        clearTimeout(loadingTimeoutId);
      }
    };
  }, [loading, allRepositories.length, forceReloadRepositories, initialLoadComplete]);

  // Debug effect to monitor loading state changes
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`Loading state changed to: ${loading ? 'loading' : 'not loading'}`);
      
      if (!loading) {
        console.log('Current repositories state:', {
          allRepositoriesCount: allRepositories.length,
          displayedReposCount: displayedRepos.length,
          initialLoadComplete,
        });
      }
    }
  }, [loading]);

  // Debug utilities for repository cache and loading
  useEffect(() => {
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      // Add debug utility for repository cache
      (window as any).__debugRepositoryCache = () => {
        const cacheInfo: Record<string, any> = {};
        
        repositoryCache.forEach((value, key) => {
          cacheInfo[key] = {
            timestamp: value.timestamp,
            age: `${Math.round((Date.now() - value.timestamp)/1000)}s`,
            expired: Date.now() - value.timestamp > CACHE_EXPIRATION,
            items: value.data.length,
            sample: value.data.length > 0 ? value.data[0] : null
          };
        });
        
        console.log('Repository Cache Contents:', cacheInfo);
        console.log('Pending Requests:', Array.from(pendingRequests.keys()));
        console.log('Loading State:', {
          loading,
          initialLoadComplete,
          allRepositories: allRepositories.length,
          displayedRepos: displayedRepos.length
        });
        
        return cacheInfo;
      };
      
      // Add utility to clear repository cache
      (window as any).__clearRepositoryCache = () => {
        repositoryCache.clear();
        pendingRequests.clear();
        loadingInitiated.current = false;
        console.log('Repository cache and loading state cleared');
        return 'Cache cleared';
      };
      
      // Add utility to force reload repositories
      (window as any).__forceReloadRepositories = () => {
        loadingInitiated.current = false;
        setInitialLoadComplete(false);
        loadRepositories();
        return 'Repository reload triggered';
      };
    }
  }, [loading, initialLoadComplete, allRepositories.length]);

  // Add this function near the other loading functions
  const loadRepositoriesForCurrentRegistry = async () => {
    console.log("Directly loading repositories for current registry as fallback");
    
    try {
      setLoading(true);
      
      // Get current registry
      const currentRegistry = registryService.getCurrentRegistry();
      
      if (!currentRegistry) {
        console.log("No current registry selected");
        setLoading(false);
        return;
      }
      
      // Create cache key for this registry
      const cacheKey = `catalog-${currentRegistry.server}`;
      
      // Always force a fresh request
      repositoryCache.delete(cacheKey);
      pendingRequests.delete(cacheKey);
      
      // Make direct request
      console.log(`Directly requesting repositories from ${currentRegistry.server}`);
      const response = await registryService.getCatalog(currentRegistry, 1000, 1);
      
      if (!response || !response.repositories || !Array.isArray(response.repositories)) {
        throw new Error(`Invalid response from registry ${currentRegistry.server}`);
      }
      
      // Create repository objects
      const repoList = response.repositories.map((name: string) => ({
        name,
        registry: currentRegistry.server,
        registryId: currentRegistry.id
      }));
      
      console.log(`Got ${repoList.length} repositories directly`);
      
      // Update repositories (displayedRepos derives from this).
      setAllRepositories(repoList);
      setInitialLoadComplete(true);

      console.log(`Direct load complete, loaded ${repoList.length} repositories`);
    } catch (error) {
      console.error("Direct repository load failed:", error);
      setError("Failed to load repositories directly. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Then modify the safety timer useEffect to use this function as a last resort
  useEffect(() => {
    // Add a safety timer that will mark the load complete if it takes too long
    if (loading && !initialLoadComplete) {
      const safetyTimer = setTimeout(() => {
        if (!initialLoadComplete) {
          console.warn('Loading safety timeout reached - attempting direct load as last resort');
          
          // Try direct load as last resort
          loadRepositoriesForCurrentRegistry();
        }
      }, 10000); // 10 seconds is plenty for any real load
      
      return () => clearTimeout(safetyTimer);
    }
  }, [loading, initialLoadComplete]);

  // Function to handle page change
  const handlePageChange = (newPage: number) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`Changing to page ${newPage}`);
    }
    // The displayed slice is derived from currentPage; just update the page.
    setCurrentPage(newPage);
  };

  // Toggle view mode between "current" and "all"
  const toggleViewMode = useCallback(() => {
    // Toggle between 'current' and 'all' modes
    const newMode = viewMode === 'current' ? 'all' : 'current';
    
    console.log(`Toggling view mode from ${viewMode} to ${newMode}`);
    
    // Mark this as a view mode change to optimize loading
    if (typeof window !== 'undefined') {
      (window as any).__isViewModeChange = true;
    }
    
    // Update state FIRST to ensure the view mode is properly set
    setViewMode(newMode);
    
    // Update localStorage to persist the preference
    localStorage.setItem('viewMode', newMode);
    localStorage.setItem('allReposMode', newMode === 'all' ? 'true' : 'false');
    
    // When switching to 'all' mode, clear registry filter to show all repositories
    if (newMode === 'all') {
      console.log('Switching to all repositories view - clearing registry filter');
      setRegistryFilter('');
      
      // Always check if we need to load repositories from other registries in "all" mode
      const allAvailableRegistries = registryService.getAllRegistries();
      let needsToLoadMore = false;
      
      // Check if we're missing repositories from any registry
      allAvailableRegistries.forEach(registry => {
        if (registry.id) {
          const hasReposForRegistry = allRepositories.some(repo => repo.registryId === registry.id);
          if (!hasReposForRegistry) {
            console.log(`Missing repositories for registry ${registry.server}, initiating load`);
            needsToLoadMore = true;
          }
        }
      });
      
      // If we're missing repositories, force a load
      if (needsToLoadMore) {
        console.log('Missing repositories from some registries, loading all repositories');
        
        // loadRepositoriesFromAllRegistries now updates displayedRepos directly
        // with fresh data, avoiding stale closure issues
        loadRepositoriesFromAllRegistries(true).then(() => {
          setLoading(false);
          console.log('Finished loading repositories from all registries');
        });
        return; // Skip further processing as we're loading
      }
    }
    
    // If repositories are already loaded, the derived `displayedRepos` memo
    // reflects the new view mode automatically. Otherwise, trigger a load.
    if (allRepositories.length === 0) {
      loadRepositories();
    }
  }, [viewMode, setViewMode, allRepositories, setLoading, loadRepositories, setRegistryFilter]);

  // Function to change search type
  const changeSearchType = (type: SearchType) => {
    if (searchType === type) return;
    
    console.log(`Changing search type to: ${type}`);
    setSearchType(type);
    
    // Reset pagination
    setCurrentPage(1);
    
    if (type === 'registry') {
      // Registry search shows the list of registries; displayedRepos is empty
      // for this search type (handled by the selector).
      const allRegistriesToDisplay = registryService.getAllRegistries();
      setDisplayedRegistries(allRegistriesToDisplay);
    } else if (searchQuery) {
      // Re-apply the current query under the new search type.
      handleSearch(searchQuery);
    }
    // With no query, the derived `displayedRepos` memo already reflects the new
    // search type — nothing else to do.
  };

  // (Registry-filter changes are reflected by the derived `displayedRepos` memo.
  // The previous effect here recomputed the list on every page change WITHOUT
  // re-applying the search query, which is what reset the search when paging.)

  // Use a useEffect to initialize the view mode properly
  useEffect(() => {
    // Get saved view mode from localStorage or default to 'current'
    const savedViewMode = localStorage.getItem('viewMode') || 'current';
    const allReposMode = localStorage.getItem('allReposMode') === 'true';
    
    // Choose the mode consistently 
    const initialMode = allReposMode || savedViewMode === 'all' ? 'all' : 'current';
    
    console.log(`Setting initial view mode to ${initialMode} from localStorage`);
    setViewMode(initialMode);
    
    // If in 'all' mode, clear registry filter to ensure all registries are shown
    if (initialMode === 'all') {
      setRegistryFilter('');
    }
  }, [setViewMode, setRegistryFilter]);
  
  // Ensure we show the toggle when multiple registries are available
  useEffect(() => {
    // Update available registries to ensure toggle is shown
    const allRegistries = registryService.getAllRegistries();
    setAvailableRegistries(allRegistries);
    
    // Load repository counts for all registries — only when switching TO registry search type
    // and only if we don't already have counts
    if (searchType === 'registry' && Object.keys(registryRepoCounts).length === 0) {
      loadRepositoriesFromAllRegistries();
    }
  }, [searchType]);
  
  // Add a dedicated effect to update registry counts whenever registries are shown
  useEffect(() => {
    if (searchType === 'registry' && displayedRegistries.length > 0 && Object.keys(registryRepoCounts).length === 0) {
      // Only load if we haven't recently tried (prevents loop on persistent failure)
      const lastAttempt = (window as any).__lastAllRegistriesLoad ?? 0;
      if (Date.now() - lastAttempt > 10_000) {
        (window as any).__lastAllRegistriesLoad = Date.now();
        console.log('Loading repository counts for displayed registries');
        loadRepositoriesFromAllRegistries();
      }
    }
  }, [searchType, displayedRegistries.length, registryRepoCounts]);
  
  // Update the registry change event listener to handle all registry selection types
  useEffect(() => {
    const handleRegistryChange = (event: CustomEvent) => {
      // Always refresh the registry list so the toggle hides when only 1 registry remains
      const updatedRegistries = registryService.getAllRegistries();
      setAvailableRegistries(updatedRegistries);

      // Special handling for dropdown selection - should ALWAYS switch to individual view
      if (event.detail?.selectedFromDropdown || event.detail?.selectedFromCard) {
        console.log('Registry selected from dropdown/card, forcing individual view mode');
        // Always force to 'current' mode when registry is selected from dropdown/card
        setViewMode('current');
        // Update localStorage for persistence
        localStorage.setItem('viewMode', 'current');
        localStorage.setItem('allReposMode', 'false');
      } 
      // General handling for any registry change
      else if (event.detail?.registryChanged) {
        console.log('Registry selected, switching to individual view mode');
        
        // Set explicit view mode if provided in the event
        if (event.detail?.viewMode) {
          console.log(`Setting view mode to ${event.detail.viewMode} from event`);
          setViewMode(event.detail.viewMode);
        } else {
          // Default to 'current' mode when registry is selected
          console.log('Defaulting to individual view mode (current)');
          setViewMode('current');
        }
        
        // Update localStorage for persistence
        localStorage.setItem('viewMode', 'current');
        localStorage.setItem('allReposMode', 'false');
      }
      // The displayed list updates automatically: switching the registry changes
      // viewMode/the current registry, which the `displayedRepos` memo reacts to.
    };

    // Add event listener
    window.addEventListener(REGISTRY_EVENTS.REGISTRY_CHANGED, handleRegistryChange as EventListener);

    // Clean up on unmount
    return () => {
      window.removeEventListener(REGISTRY_EVENTS.REGISTRY_CHANGED, handleRegistryChange as EventListener);
    };
  }, [setViewMode, setAvailableRegistries]);

  // Add handler for registry card clicks in search results
  const handleRegistryCardClick = useCallback((registry: Registry) => {
    console.log(`Registry card clicked: ${registry.server}`);
    
    // Set the current registry in the service
    registryService.setCurrentRegistry(registry.id || '');
    
    // Always switch to 'current' view mode when selecting a registry
    setViewMode('current');
    setRegistryFilter(registry.id || '');
    
    // Update localStorage for consistency
    localStorage.setItem('viewMode', 'current');
    localStorage.setItem('allReposMode', 'false');
    
    // Set a flag to indicate this was selected from card (similar to dropdown selection)
    if (typeof window !== 'undefined') {
      (window as any).__selectedFromCard = true;
      (window as any).__isViewModeChange = false; // Ensure we don't treat this as a view mode change
      (window as any).__lastViewModeOverride = Date.now(); // Track when this happened
    }
    
    // Reset to page 1; the derived `displayedRepos` memo shows the selected
    // registry's repositories automatically.
    setCurrentPage(1);

    // If we don't have repositories loaded yet, force a load (after a short delay
    // so the registry state is fully updated first).
    if (allRepositories.length === 0 && registry.id) {
      console.log(`No repositories loaded for ${registry.server}, triggering a load`);
      setTimeout(() => {
        loadRepositories();
      }, 50);
    }
    
    // If we're currently in registry search mode, switch back to repository search
    if (searchType === 'registry') {
      console.log('Switching from registry search to repository search');
      setSearchType('repository');
      // Clear search query to show all repositories for this registry
      setSearchQuery('');
    }
    
    // Dispatch registry change event
    const event = new CustomEvent(REGISTRY_EVENTS.REGISTRY_CHANGED, {
      detail: { 
        registry: registry.id,
        previousRegistry: registryService.getCurrentRegistryId(),
        registryChanged: true,
        selectedFromCard: true,
        viewMode: 'current', // Add explicit viewMode to event
        timestamp: Date.now() // Add timestamp for ordering
      }
    });
    window.dispatchEvent(event);
  }, [setViewMode, setRegistryFilter, allRepositories, loadRepositories, setCurrentPage, searchType, setSearchType, setSearchQuery]);

  return (
    <div className="container mx-auto py-6 px-4 max-w-6xl">
      <div className="mb-6 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primaryBlue dark:text-blue-400">Repository Catalog</h1>
          <SessionInfo />
        </div>
        <div className="flex flex-col md:flex-row gap-4">
          {availableRegistries.length > 1 ? (
            <div className="flex items-center">
              <label className="inline-flex items-center cursor-pointer">
                <span className={`mr-3 text-sm font-medium ${viewMode === 'current' ? 'text-primaryBlue dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}>
                  View Individual Registry
                </span>
                <div className="relative">
                  <input 
                    type="checkbox" 
                    checked={viewMode === 'all'} 
                    onChange={() => toggleViewMode()} 
                    className="sr-only peer"
                    aria-label="Toggle between viewing individual or all registries"
                  />
                  <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-secondaryBlue dark:peer-checked:bg-blue-600"></div>
                </div>
                <span className={`ml-3 text-sm font-medium ${viewMode === 'all' ? 'text-primaryBlue dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}>
                  View All Registries
                </span>
              </label>
            </div>
          ) : null}
          <RegistryManager />
        </div>
      </div>

      <div className="my-8 relative pb-12">
        {/* Search and filter section */}
        <div className="mb-6">
          <div className="flex flex-col md:flex-row items-stretch gap-4">
            <div className="flex-grow">
              <SearchBox
                placeholder={getSearchPlaceholder()}
                onSearch={handleSearch}
                initialQuery={searchQuery}
              />
            </div>
            
            {/* Search filter buttons section */}
            <div className="flex border rounded-md divide-x h-[42px] flex-shrink-0 relative z-20 dark:border-gray-600 dark:divide-gray-600">
              <button
                onClick={() => changeSearchType('all')}
                className={`px-3 ${
                  searchType === 'all'
                    ? 'bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-gray-200'
                    : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700'
                } cursor-pointer`}
                disabled={loading && !initialLoadComplete}
                type="button"
              >
                All
              </button>
              <button
                onClick={() => changeSearchType('repository')}
                className={`px-3 ${
                  searchType === 'repository'
                    ? 'bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-gray-200'
                    : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700'
                } cursor-pointer`}
                disabled={loading && !initialLoadComplete}
                type="button"
              >
                By Repository
              </button>
              <button
                onClick={() => changeSearchType('registry')}
                className={`px-3 ${
                  searchType === 'registry'
                    ? 'bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-gray-200'
                    : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700'
                } cursor-pointer`}
                disabled={loading && !initialLoadComplete}
                type="button"
              >
                By Registry
              </button>
            </div>
          </div>
        </div>

        {/* Show skeleton loaders during loading, prefer skeletons over spinner */}
        {loading ? (
          searchType === 'registry' ? renderSkeletonRegistries : renderSkeletonRepositories
        ) : error ? (
          <div className="mb-6 p-4 bg-red-100 text-red-700 rounded-md">
            {error}
          </div>
        ) : (
          <>
            {searchType === 'registry' ? (
              // Registry search results
              <div className="relative">
                {displayedRegistries.length === 0 ? (
                  <div className="text-center p-8 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">No registries found</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-6">
                    {displayedRegistries.map((registry) => {
                      const count = registry.id ? registryRepoCounts[registry.id] : 0;
                      return (
                        <div key={registry.id || registry.server} onClick={() => handleRegistryCardClick(registry)}>
                        <RegistryCard
                          registry={registry}
                          highlightTerm={searchQuery}
                          tagCount={count}
                        />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              // Repository search results
              <>
                {displayedRepos.length === 0 ? (
                  <div className="text-center p-8 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">No repositories found</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-6">
                      {displayedRepos.map((repo: Repository) => (
                        <RepositoryCard
                          key={`${repo.registry}-${repo.name}`}
                          repository={repo}
                          showRegistry={viewMode === 'all'}
                          registryName={getRegistryNameById(repo.registryId)}
                          highlightTerm={searchQuery}
                          highlightRepoTerm={searchQuery}
                        />
                      ))}
                    </div>
                    
                    <div className="mt-8">
                      {renderPagination()}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Wrap the registry page content in a suspense boundary with persistent layout
export default function RegistryPage() {
  return (
    <Suspense fallback={<div className="flex justify-center items-center mt-48"><div className="w-8 h-8 border-t-2 border-b-2 border-gray-900 rounded-full animate-spin"></div></div>}>
      <RegistryPageContent />
    </Suspense>
  );
} 