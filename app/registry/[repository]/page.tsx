'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense, useRef, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import RegistryManager from '@/app/components/RegistryManager';
import SearchBox from '@/app/components/SearchBox';
import TagGridTable from '@/app/components/TagGridTable';
import { Tag, Registry, ManifestResponse } from '@/app/types/registry';
import registryService from '@/app/services/registryService';
import { useRepositoryContext } from '@/app/contexts/RepositoryContext';
import SkeletonTagGrid from '@/app/components/SkeletonTagGrid';
import { REGISTRY_EVENTS } from '@/app/utils/constants';
import { getLifecycleInfo, LifecycleInfo } from '@/app/utils/lifecycleUtils';
import { useDigestSearch } from '@/app/hooks/useDigestSearch';
import DigestSearchBanner from '@/app/components/DigestSearchBanner';
import DigestSearchSkeleton from '@/app/components/DigestSearchSkeleton';

interface RepositoryPageProps {
  params: Promise<{
    repository: string;
  }>;
}

// Create a client component that uses useSearchParams
function RepositoryDetailContent({ params }: RepositoryPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // In Next.js 15+, params is a Promise - use React.use() to unwrap it
  const resolvedParams = use(params);
  const encodedRepositoryName = resolvedParams.repository;
  const repositoryName = decodeURIComponent(encodedRepositoryName);
  const [tags, setTags] = useState<Tag[]>([]);
  const [filteredTags, setFilteredTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeRegistry, setActiveRegistry] = useState<Registry | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [displayedTags, setDisplayedTags] = useState<Tag[]>([]);
  const pageSize = 20;
  const [isLoadingDigests, setIsLoadingDigests] = useState(false);
  const [totalPages, setTotalPages] = useState(0);
  const [tagsWithRequestedDigests, setTagsWithRequestedDigests] = useState<Set<string>>(new Set());
  const [searchType, setSearchType] = useState<'tag' | 'digest'>('tag');
  const digestLoadTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  
  // Get registry ID from URL or use current registry
  const registryId = searchParams.get('registry');

  // Access the repository context to maintain state across navigation
  const { viewMode } = useRepositoryContext();

  // Create a cache for tags to avoid redundant API calls
  const tagCache = React.useRef<Map<string, {
    timestamp: number,
    tags: Tag[],
    registry: Registry
  }>>(new Map());

  // Cache expiration time (5 minutes)
  const CACHE_EXPIRATION = 5 * 60 * 1000;

  // Function to generate cache key for tags
  const getTagCacheKey = useCallback((registry: Registry, repoName: string): string => {
    return `tags-${registry.id}-${repoName}`;
  }, []);

  // Check if tags are cached and valid
  const getTagsFromCache = useCallback((registry: Registry, repoName: string): Tag[] | null => {
    const cacheKey = getTagCacheKey(registry, repoName);
    const cachedData = tagCache.current.get(cacheKey);
    
    if (!cachedData) {
      console.log(`No cached tags found for ${repoName}`);
      return null;
    }
    
    const now = Date.now();
    const isExpired = now - cachedData.timestamp > CACHE_EXPIRATION;
    
    if (isExpired) {
      console.log(`Cached tags for ${repoName} are expired, fetching fresh data`);
      tagCache.current.delete(cacheKey);
      return null;
    }
    
    console.log(`Using ${cachedData.tags.length} cached tags for ${repoName}`);
    return cachedData.tags;
  }, [getTagCacheKey]);

  // Wrap setLoading with logging
  const setLoadingWithLogging = useCallback((newLoadingState: boolean) => {
    setLoading(newLoadingState);
  }, [setLoading]);

  // Track if a tag request is in progress for a specific repository
  const pendingTagRequests = React.useRef<Map<string, Promise<any>>>(new Map());

  // Define the search filter function before it's used
  const applySearchFilter = useCallback((tags: Tag[], searchText: string) => {
    if (!searchText || searchText.trim() === '') {
      return tags;
    }
    
    const lowerSearch = searchText.toLowerCase().trim();
    return tags.filter(tag => tag.name.toLowerCase().includes(lowerSearch));
  }, []);

  // Calculate size from manifest layers
  const calculateManifestSize = (manifest: ManifestResponse): number => {
    let size = 0;
    
    // For v2/OCI manifests with layers
    if (manifest.layers && Array.isArray(manifest.layers)) {
      size = manifest.layers.reduce((total: number, layer: any) => total + (layer.size || 0), 0);
    }
    
    // For manifest lists/indexes — sum the descriptor sizes of all child manifests.
    // Each manifests[].size is the compressed size of that platform's manifest descriptor.
    // This avoids extra API calls to fetch each child manifest's layers.
    else if (manifest.manifests && Array.isArray(manifest.manifests) && manifest.manifests.length > 0) {
      size = manifest.manifests.reduce((total: number, m: any) => total + (m.size || 0), 0);
    }
    
    // For v1 manifests with fsLayers
    else if (manifest.fsLayers && Array.isArray(manifest.fsLayers)) {
      // fsLayers typically don't contain size info directly, so we can't calculate
      // accurate size from them, but we can count the number of layers
      size = manifest.fsLayers.length * 1024; // rough estimate
    }
    
    // If manifest has a size property directly (some registries add this)
    else if (manifest.size && typeof manifest.size === 'number') {
      size = manifest.size;
    }
    
    return size;
  };

  // Function to safely extract the digest from various manifest formats
  const extractDigestFromManifest = (manifest: ManifestResponse): string | undefined => {
    // First, prioritize the top-level digest property which should be the
    // Docker-Content-Digest from the HTTP header - the true tag digest
    if (manifest.digest) {
      console.log(`Using top-level digest from manifest: ${manifest.digest}`);
      return manifest.digest;
    }
    
    // For manifest lists/indexes - these are also valid tag-level digests
    if (manifest.manifests && manifest.manifests.length > 0 && manifest.manifests[0].digest) {
      console.log(`Using digest from manifest list: ${manifest.manifests[0].digest}`);
      return manifest.manifests[0].digest;
    }
    
    // For v1 manifests - less ideal but can be used
    if (manifest.fsLayers && manifest.fsLayers.length > 0 && manifest.fsLayers[0].blobSum) {
      console.log(`Using digest from v1 manifest fsLayers: ${manifest.fsLayers[0].blobSum}`);
      return manifest.fsLayers[0].blobSum;
    }
    
    // Last resort: config digest from v2/OCI manifests (not the correct tag digest)
    if (manifest.config && manifest.config.digest) {
      console.log(`WARNING: Using config digest (not ideal): ${manifest.config.digest}`);
      return manifest.config.digest;
    }
    
    // Fallback when no digest is found
    console.log(`WARNING: No digest found in manifest`);
    return undefined;
  };

  // Function to load digests for tags - now accepts the actual tags to load instead of computing a page slice
  const loadTagDigests = useCallback(async (registry: Registry, tagsToLoad: Tag[]) => {
    if (!registry || isLoadingDigests || tagsToLoad.length === 0) {
      return;
    }
    
    // Set the loading flag to prevent concurrent digest loading
    setIsLoadingDigests(true);
    
    // Always decode repository name before using it in API calls
    const decodedRepositoryName = decodeURIComponent(repositoryName);
    
    console.log(`Loading digests for ${decodedRepositoryName}, ${tagsToLoad.length} tags (activeRegistry: ${registry.server})`);
    
    // Check if all tags already have digests loaded
    // If so, skip the loading process entirely
    const tagsNeedingDigests = tagsToLoad.filter(
      tag => tag.digest === 'Loading...' || !tag.digest || 
             tag.digest === 'Failed to load digest' || 
             tag.digest === 'Error loading digest'
    );
    
    if (tagsNeedingDigests.length === 0) {
      console.log('All tags in current page already have digests, skipping API calls');
      setIsLoadingDigests(false);
      return;
    }
    
    try {
      // Load digests for each tag in parallel, with a concurrency limit
      const batchSize = 5; // Load 5 digests at a time
      const batches = Math.ceil(tagsNeedingDigests.length / batchSize);
      
      // Create batches of requests
      for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
        const batchStart = batchIndex * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, tagsNeedingDigests.length);
        const batch = tagsNeedingDigests.slice(batchStart, batchEnd);
        
        // Set each tag to loading state
        batch.forEach(tag => {
          if (tag.digest !== 'Loading...') {
            tag.digest = 'Loading...';
            tag.loadingDigest = true;
          }
        });
        
        // Update state to show loading
        const updateTagsWithLoadingState = (tags: Tag[]): Tag[] => 
          tags.map(t => {
            const batchTag = batch.find(bt => bt.name === t.name);
            return batchTag ? { ...t, ...batchTag } : t;
          });
        
        setTags(updateTagsWithLoadingState);
        setFilteredTags(prevFiltered => updateTagsWithLoadingState(prevFiltered));
        setDisplayedTags(prevDisplayed => updateTagsWithLoadingState(prevDisplayed));
        
        // Create promise batch (handle loading errors per tag rather than stopping the whole batch)
        const results = await Promise.all(
          batch.map(async (tag) => {
            try {
              const manifest = await registryService.getManifest(registry, decodedRepositoryName, tag.name);
              
              // Extract digest and size
              const digest = extractDigestFromManifest(manifest);
              const size = calculateManifestSize(manifest);
              
              // Extract configMediaType if available
              let configMediaType = undefined;
              if (manifest.config && manifest.config.mediaType) {
                configMediaType = manifest.config.mediaType;
              }
              // For manifest lists/indexes, extract first child's mediaType if available
              else if (manifest.manifests && manifest.manifests.length > 0) {
                if (manifest.manifests[0].mediaType) {
                  configMediaType = manifest.manifests[0].mediaType;
                }
              }
              
              // For manifest lists/indexes, extract platform info from manifests[].platform
              // This data is already in the response — no extra API calls needed
              const isManifestList = manifest.manifests && Array.isArray(manifest.manifests) && manifest.manifests.length > 0;
              let manifestPlatforms: Array<{ architecture: string; os: string; variant?: string }> | undefined = undefined;
              
              if (isManifestList) {
                manifestPlatforms = manifest.manifests!
                  .filter((m: any) => m.platform && m.platform.architecture && m.platform.os)
                  .map((m: any) => ({
                    architecture: m.platform.architecture,
                    os: m.platform.os,
                    ...(m.platform.variant ? { variant: m.platform.variant } : {})
                  }));
              }
              
              // Update platformMap with mediaType immediately
              // This ensures artifact type is available as soon as the manifest is loaded
              // regardless of platform loading state
              setPlatformMap(prev => ({
                ...prev,
                [tag.name]: {
                  ...prev[tag.name],
                  mediaType: manifest.mediaType,
                  configMediaType: configMediaType,
                  isManifestList: !!isManifestList,
                  // For manifest lists, populate platforms and mark as detailed immediately
                  ...(isManifestList && manifestPlatforms && manifestPlatforms.length > 0 ? {
                    platforms: manifestPlatforms,
                    architecture: manifestPlatforms.length > 1 ? 'multi-arch' : manifestPlatforms[0].architecture,
                    os: manifestPlatforms.length > 1 ? 'multi-os' : manifestPlatforms[0].os,
                    detailed: true,
                    loading: false,
                  } : {
                    // Make sure we don't override existing platform details if they exist
                    ...(prev[tag.name] ? {
                      architecture: prev[tag.name].architecture, 
                      os: prev[tag.name].os,
                      variant: prev[tag.name].variant,
                      detailed: prev[tag.name].detailed
                    } : {})
                  })
                }
              }));
              
              return {
                tag,
                digest: digest || 'No digest available',
                size: size || 0,
                error: false
              };
            } catch (err) {
              console.error(`Error loading manifest for ${tag.name}:`, err);
              const errorMessage = err instanceof Error ? err.message : 'Unknown error';
              return {
                tag,
                error: true,
                errorMessage,
                digest: 'Error loading digest'
              };
            }
          })
        );
        
        // Update tags with digest information
        const updateTagsWithDigests = (tags: Tag[]): Tag[] => 
          tags.map(t => {
            const result = results.find(r => r.tag.name === t.name);
            if (result) {
              if (result.error) {
                return {
                  ...t,
                  loadingDigest: false,
                  digestError: true,
                  digestErrorMessage: result.errorMessage,
                  digest: result.digest
                };
              } else {
                return {
                  ...t,
                  digest: result.digest,
                  size: result.size,
                  loadingDigest: false,
                  digestError: false,
                  detailed: true
                };
              }
            }
            return t;
          });
        
        setTags(updateTagsWithDigests);
        setFilteredTags(prevFiltered => updateTagsWithDigests(prevFiltered));
        setDisplayedTags(prevDisplayed => updateTagsWithDigests(prevDisplayed));
      }
    } finally {
      setIsLoadingDigests(false);
    }
  }, [repositoryName, extractDigestFromManifest, calculateManifestSize]);

  // Function to update the displayed tags based on pagination
  const updateDisplayedTags = useCallback((tagArray: Tag[], page: number) => {
    const startIndex = (page - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, tagArray.length);
    setDisplayedTags(tagArray.slice(startIndex, endIndex));
    setCurrentPage(page);
  }, [pageSize]);

  // Function to load tags for a specific registry
  const loadTagsForRegistry = useCallback(async (registry: Registry) => {
    if (!registry) {
      console.error('Cannot load tags: No registry provided');
      setLoadingWithLogging(false);
      return;
    }
    
    setLoadingWithLogging(true);
    setError(null);
    
    // Make sure repository name is properly decoded when used for API calls
    const decodedRepositoryName = decodeURIComponent(repositoryName);
    
    // Check if we have pending request for this repository
    const cacheKey = getTagCacheKey(registry, decodedRepositoryName);
    if (pendingTagRequests.current.has(cacheKey)) {
      console.log(`Using pending request for tags of ${decodedRepositoryName}`);
      try {
        await pendingTagRequests.current.get(cacheKey);
        
        // Check if tags are now available in cache after pending request
        const cachedTags = getTagsFromCache(registry, decodedRepositoryName);
        if (cachedTags) {
          setTags(cachedTags);
          const filtered = applySearchFilter(cachedTags, searchQuery);
          setFilteredTags(filtered);
          setTotalPages(Math.ceil(filtered.length / pageSize));
          updateDisplayedTags(filtered, 1);
          setLoadingWithLogging(false);
          return;
        }
      } catch (error) {
        // If pending request failed, continue to make a new request
        console.error('Pending request failed:', error);
      }
    }
    
    // Check if we have valid cached tags first
    const cachedTags = getTagsFromCache(registry, decodedRepositoryName);
    if (cachedTags) {
      setTags(cachedTags);
      const filtered = applySearchFilter(cachedTags, searchQuery);
      setFilteredTags(filtered);
      setTotalPages(Math.ceil(filtered.length / pageSize));
      updateDisplayedTags(filtered, 1);
      setLoadingWithLogging(false);
      return;
    }
    
    // Make request and store the promise
    const requestPromise = (async () => {
      try {
        const tagsResponse = await registryService.getTags(registry, decodedRepositoryName);
        if (!tagsResponse || !tagsResponse.tags) {
          throw new Error('Invalid response format');
        }
        return tagsResponse;
      } catch (error) {
        throw error;
      }
    })();
    
    pendingTagRequests.current.set(cacheKey, requestPromise);
    
    try {
      const tagsResponse = await requestPromise;
      
      // Successfully loaded tags
      if (tagsResponse && tagsResponse.tags && Array.isArray(tagsResponse.tags)) {
        // Create tag objects with necessary properties
        const loadedTags: Tag[] = tagsResponse.tags.map(tagName => {
          // Create base tag object
          const tag: Tag = {
            name: tagName,
            digest: 'Loading...', // Initialize with placeholder to avoid undefined
            detailed: false
          };
          
          return tag;
        });
        
        // Sort tags by name
        loadedTags.sort((a, b) => {
          // Handle special tags like "latest"
          if (a.name === 'latest' && b.name !== 'latest') return -1;
          if (a.name !== 'latest' && b.name === 'latest') return 1;
          
          // Try to sort numerically if tags are version numbers
          const versionA = a.name.match(/^v?(\d+)\.(\d+)\.(\d+)/);
          const versionB = b.name.match(/^v?(\d+)\.(\d+)\.(\d+)/);
          
          if (versionA && versionB) {
            // Compare version parts numerically
            for (let i = 1; i < 4; i++) {
              const numA = parseInt(versionA[i], 10);
              const numB = parseInt(versionB[i], 10);
              if (numA !== numB) {
                return numB - numA; // Newest version first
              }
            }
          }
          
          // Default to reverse alphabetical (new tags often have higher letters/numbers)
          return b.name.localeCompare(a.name);
        });
        
        // Cache the result
        tagCache.current.set(cacheKey, {
          timestamp: Date.now(),
          tags: loadedTags,
          registry
        });
        
        // Update state with tags
        setTags(loadedTags);
        const filtered = applySearchFilter(loadedTags, searchQuery);
        setFilteredTags(filtered);
        setTotalPages(Math.ceil(filtered.length / pageSize));
        updateDisplayedTags(filtered, 1);
              } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      // Handle 404 errors as "Repository not found in this registry"
      if (error instanceof Error) {
        if (error.message.includes('404')) {
          setError(`Repository "${repositoryName}" doesn't exist in registry ${registry.server}`);
        } else {
          setError(`Error loading tags: ${error.message}`);
        }
      } else {
        setError('Failed to load tags. Please try again later.');
      }
      console.error('Error loading tags:', error);
      setTags([]);
      setFilteredTags([]);
      setDisplayedTags([]);
    } finally {
      pendingTagRequests.current.delete(cacheKey);
      setLoadingWithLogging(false);
    }
  }, [
    repositoryName, 
    getTagCacheKey, 
    getTagsFromCache, 
    updateDisplayedTags, 
    searchQuery, 
    applySearchFilter,
    pageSize,
    setLoadingWithLogging
  ]);

  // Function to load tags
  const loadTags = useCallback(async () => {
    if (!registryId) {
      // No registry ID, load the current registry
      const currentRegistry = registryService.getCurrentRegistry();
      if (!currentRegistry) {
        setError('No registry selected. Please select a registry first.');
        setLoadingWithLogging(false);
        return;
      }
      setActiveRegistry(currentRegistry);
      loadTagsForRegistry(currentRegistry);
    } else {
      // Use the specified registry ID
      const registries = registryService.getAllRegistries();
      const registry = registries.find(r => r.id === registryId);
      if (!registry) {
        setError(`Registry with ID ${registryId} not found.`);
        setLoadingWithLogging(false);
        return;
      }
      setActiveRegistry(registry);
      loadTagsForRegistry(registry);
    }
  }, [registryId, loadTagsForRegistry, setLoadingWithLogging]);

  useEffect(() => {
    // This only runs once on initial mount
    loadTags();
  }, [loadTags]);

  // Use our custom digest search hook
  const { 
    matchingTags: digestSearchResults, 
    isSearching: isDigestSearching,
    foundCount,
    searchedCount,
    totalToSearch,
    progress 
  } = useDigestSearch({
    repositoryName,
    registry: activeRegistry,
    tags,
    searchQuery
  });

  // Check if the current search is a digest search
  const isDigestSearch = useMemo(() => {
    if (!searchQuery) return false;
    
    const lowerQuery = searchQuery.toLowerCase().trim();
    return lowerQuery.includes(':') || (lowerQuery.length > 8 && /^[a-f0-9]+$/.test(lowerQuery));
  }, [searchQuery]);

  // Update filterTags to use digestSearchResults for digest searches
  const filterTags = useMemo(() => {
    if (!searchQuery.trim()) {
      return tags;
    }
    
    const lowerSearch = searchQuery.toLowerCase().trim();
    
    // If this is a digest search, use the results from our digest search hook
    if (isDigestSearch) {
      return digestSearchResults;
    }
    
    // Regular tag name search - use existing logic
    return tags.filter(tag => 
      tag.name.toLowerCase().includes(lowerSearch) || 
      (tag.digest && 
       tag.digest !== 'Loading...' && 
       tag.digest !== 'Failed to load digest' && 
       tag.digest !== 'Error loading digest' && 
       tag.digest.toLowerCase().includes(lowerSearch))
    );
  }, [tags, searchQuery, isDigestSearch, digestSearchResults]);
  
  // Apply filter when tags, search query or search type changes
  useEffect(() => {
    // Only update filtered tags if the filter result has changed
    const newFilteredTags = filterTags;
    
    // Check if the filtered result is actually different
    const hasFilterChanged = 
      newFilteredTags.length !== filteredTags.length || 
      newFilteredTags.some((tag, i) => i >= filteredTags.length || filteredTags[i]?.name !== tag.name);
    
    if (hasFilterChanged) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`Applying filter: ${newFilteredTags.length} of ${tags.length} tags match criteria`);
      }
      setFilteredTags(newFilteredTags);
      
      // Reset to page 1 when filter changes
      if (currentPage !== 1) {
        setCurrentPage(1);
      }
      
      // Update total pages
      const newTotalPages = Math.max(1, Math.ceil(newFilteredTags.length / pageSize));
      setTotalPages(newTotalPages);
    }
  }, [filterTags, filteredTags, tags.length, currentPage, pageSize]);

  // Memoize the displayed tags computation to avoid redundant updates
  const memoizedDisplayedTags = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, filteredTags.length);
    return filteredTags.slice(startIndex, endIndex);
  }, [filteredTags, currentPage, pageSize]);

  // Set displayed tags whenever the memoized value changes
  useEffect(() => {
    setDisplayedTags(memoizedDisplayedTags);
    
    // If this is a digest search and we need to update the total pages
    if (isDigestSearch && digestSearchResults.length > 0) {
      const newTotalPages = Math.max(1, Math.ceil(digestSearchResults.length / pageSize));
      if (newTotalPages !== totalPages) {
        setTotalPages(newTotalPages);
      }
    }
  }, [memoizedDisplayedTags, isDigestSearch, digestSearchResults.length, pageSize, totalPages]);

  // Ensure loading state is cleared after a reasonable timeout to prevent UI being stuck
  useEffect(() => {
    // Only run this safety check if we're in a loading state
    if (loading) {
      const timeoutId = setTimeout(() => {
        // If we've been loading for too long, force it to complete
        if (process.env.NODE_ENV === 'development') {
          console.log('Safety timeout: Ensuring loading state is cleared');
        }
        setLoadingWithLogging(false);
      }, 5000); // 5-second safety timeout
      
      return () => clearTimeout(timeoutId);
    }
  }, [loading, setLoadingWithLogging]);
  
  // Create a stable reference to the event handler using useRef to prevent recreating it on every render
  const registryChangeHandlerRef = useRef<((event: Event) => void) | undefined>(undefined);

  // Initialize the registry change handler once - this won't change between renders
  useEffect(() => {
    // Create the handler function once
    registryChangeHandlerRef.current = (event: Event) => {
      // Get current registry from service
      const newRegistry = registryService.getCurrentRegistry();
      
      // Skip update if registry ID hasn't changed
      if (activeRegistry && newRegistry && activeRegistry.id === newRegistry.id) {
        return;
      }
      
      // Skip update if no registry is available (shouldn't happen)
      if (!newRegistry) {
        return;
      }
      
      // Update active registry
      setActiveRegistry(newRegistry);
      
      // Load tags for the new registry
      loadTags();
    };
    
    // Listen for registry changes using the stable reference
    const handler = registryChangeHandlerRef.current;
    if (handler) {
      window.addEventListener(REGISTRY_EVENTS.REGISTRY_CHANGED, handler);
    }
      
    // Cleanup listener on unmount
    return () => {
      if (handler) {
        window.removeEventListener(REGISTRY_EVENTS.REGISTRY_CHANGED, handler);
      }
    };
  }, []); // Empty dependency array ensures this only runs once

  // Get placeholder text for the combined search
  const getSearchPlaceholder = (): string => {
    return 'Search by tag name or digest...';
  };

  // Update handleSearch to handle digest searches differently
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    
    // The filter logic will now be handled by our useDigestSearch hook for digest searches
    // and by the filterTags function for tag searches
    
    // Reset to page 1 for new searches
    setCurrentPage(1);

  }, []);

  // Function to handle page change
  const handlePageChange = useCallback((newPage: number) => {
    console.log(`Changing to page ${newPage}`);
    
    // First update the current page
    setCurrentPage(newPage);
    
    // Calculate what tags should be displayed on this page
    const startIndex = (newPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, filteredTags.length);
    const newDisplayedTags = filteredTags.slice(startIndex, endIndex);
    
    // Check if any tag in this page needs its digest loaded
    const needsDigestLoading = newDisplayedTags.some(
      tag => tag.digest === 'Loading...' || tag.digest === 'Failed to load digest'
    );
    
    // Update displayed tags immediately
    setDisplayedTags(newDisplayedTags);
    
    // Load digests for the displayed tags if needed
    if (activeRegistry && needsDigestLoading) {
      console.log(`Page ${newPage} has tags needing digest loading`);
      // Use a small timeout to ensure the page change renders first
      setTimeout(() => {
        loadTagDigests(activeRegistry, newDisplayedTags);
      }, 50);
    } else {
      console.log(`Page ${newPage} - no digest loading needed`);
    }
  }, [activeRegistry, filteredTags, pageSize, loadTagDigests]);

  // Add platformMap state to store platform information separately
  const [platformMap, setPlatformMap] = useState<Record<string, {
    architecture?: string;
    os?: string;
    variant?: string[];
    loading?: boolean;
    detailed?: boolean;
    error?: boolean;
    errorMessage?: string;
    mediaType?: string;
    configMediaType?: string;
    isManifestList?: boolean;
    platforms?: Array<{ architecture: string; os: string; variant?: string }>;
  }>>({});

  // Handle loading platform details for a tag
  const handleLoadTagDetails = useCallback(async (tag: Tag) => {
    console.log(`Page component: Loading platform details for tag: ${tag.name}`);
    
    if (!activeRegistry) {
      console.error('Cannot load platform details: No active registry');
      return tag;
    }
    
    // Get key for platform map - using tag name as it's more consistent than digest
    const platformKey = tag.name;
    
    // Get existing platform info (if any)
    const existingPlatform = platformMap[platformKey];
    
    // Check if platform info already loaded
    if (existingPlatform && existingPlatform.detailed) {
      console.log(`Tag ${tag.name} already has platform details in platform map`);
      return tag;
    }
    
    // Set loading state in platformMap while preserving mediaType if exists
    setPlatformMap(prev => ({
      ...prev,
      [platformKey]: {
        ...prev[platformKey],
        loading: true,
        // Preserve mediaType if it exists
        mediaType: prev[platformKey]?.mediaType
      }
    }));
    
    try {
      console.log(`Sending API call to getTagPlatformDetails for ${tag.name} from registry ${activeRegistry.server}`);
      
      // Make explicit API call with await
      const platformResponse = await registryService.getTagPlatformDetails(activeRegistry, repositoryName, tag);
      
      console.log(`Received platform details API response for ${tag.name}:`, platformResponse);
      
      // Extract platform info
      let architecture: string | undefined = undefined;
      let os: string | undefined = undefined;
      let variant: string[] | undefined = undefined;
      let platforms: Array<{ architecture: string; os: string; variant?: string }> | undefined = undefined;
      let isManifestList = false;
      
      // Extract from platforms array if available (returned by manifest list handling)
      if (platformResponse.platforms && Array.isArray(platformResponse.platforms) && platformResponse.platforms.length > 0) {
        const firstPlatform = platformResponse.platforms[0];
        if (typeof firstPlatform !== 'string') {
          // Multi-platform manifest list
          isManifestList = platformResponse.platforms.length > 1;
          platforms = (platformResponse.platforms as Array<{ architecture: string; os: string; variant?: string }>);
          architecture = platformResponse.architecture;
          os = platformResponse.os;
          variant = firstPlatform.variant ? [firstPlatform.variant] : undefined;
        }
      }
      
      // Use direct properties if available (single-manifest case)
      if (!platforms) {
        architecture = platformResponse.architecture || architecture;
        os = platformResponse.os || os;
        variant = platformResponse.variants || variant;
      }
      
      // Use mediaType/configMediaType from getTagPlatformDetails (no separate getManifest needed)
      const mediaType = platformResponse.mediaType;
      const configMediaType = platformResponse.configMediaType;

      // Update platform map with the loaded platform details and mediaType
      setPlatformMap(prev => ({
        ...prev,
        [platformKey]: {
          architecture,
          os,
          variant,
          platforms,
          isManifestList,
          loading: false,
          detailed: true,
          error: false,
          mediaType: mediaType || prev[platformKey]?.mediaType,
          configMediaType: configMediaType || prev[platformKey]?.configMediaType
        }
      }));
      
      return tag;
    } catch (error) {
      console.error(`API call failed for ${tag.name}:`, error);
      
      // Update platform map with error state
      setPlatformMap(prev => ({
        ...prev,
        [platformKey]: {
          loading: false,
          detailed: true,
          error: true,
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        }
      }));
      
      return tag;
    }
  }, [activeRegistry, repositoryName, platformMap]);

  // Handle retry for a specific tag digest
  const handleRetryTagDigest = useCallback(async (tagName: string) => {
    console.log(`Retrying digest load for tag ${tagName}`);
    
    if (!activeRegistry) {
      console.error('Cannot retry: No active registry');
      return;
    }
    
    const decodedRepositoryName = decodeURIComponent(repositoryName);
    
    // Update tag state to show loading
    const updateTagToLoading = (tagArray: Tag[]): Tag[] => {
      return tagArray.map(t => {
        if (t.name === tagName) {
          return { ...t, digest: 'Loading...', loadingDigest: true, digestError: false };
        }
        return t;
      });
    };
    
    setTags(updateTagToLoading(tags));
    setFilteredTags(updateTagToLoading(filteredTags));
    setDisplayedTags(updateTagToLoading(displayedTags));
    
    try {
      const manifest = await registryService.getManifest(activeRegistry, decodedRepositoryName, tagName);
      const digest = extractDigestFromManifest(manifest);
      const size = calculateManifestSize(manifest);
      
      // Extract configMediaType if available
      let configMediaType = undefined;
      if (manifest.config && manifest.config.mediaType) {
        configMediaType = manifest.config.mediaType;
      } 
      // For manifest lists/indexes, extract first child's mediaType if available
      else if (manifest.manifests && manifest.manifests.length > 0) {
        if (manifest.manifests[0].mediaType) {
          configMediaType = manifest.manifests[0].mediaType;
        }
      }
      
      // Update platformMap with mediaType immediately, preserving any existing platform details
      setPlatformMap(prev => ({
        ...prev,
        [tagName]: {
          ...prev[tagName],
          mediaType: manifest.mediaType,
          configMediaType: configMediaType,
          // Make sure we don't override existing platform details if they exist
          ...(prev[tagName] ? {
            architecture: prev[tagName].architecture,
            os: prev[tagName].os,
            variant: prev[tagName].variant,
            detailed: prev[tagName].detailed
          } : {})
        }
      }));
      
      // Update tag in all arrays
      const updateTag = (tagArray: Tag[]): Tag[] => {
        return tagArray.map(t => {
          if (t.name === tagName) {
            return {
              ...t,
              digest: digest || 'No digest available',
              size: size || 0,
              loadingDigest: false,
              digestError: false,
              detailed: true
            };
          }
          return t;
        });
      };
      
      setTags(updateTag(tags));
      setFilteredTags(updateTag(filteredTags));
      setDisplayedTags(updateTag(displayedTags));
    } catch (error) {
      console.error(`Retry failed for ${tagName}:`, error);
      
      // Set error state for the tag in all arrays
      const updateTagWithError = (tagArray: Tag[]): Tag[] => {
        return tagArray.map(t => {
          if (t.name === tagName) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const is404 = errorMessage.includes('404') || errorMessage.includes('not found');
            
            return {
              ...t,
              loadingDigest: false,
              digestError: true,
              digestErrorMessage: is404
                ? 'Tag not found on server'
                : `Error: ${errorMessage.slice(0, 100)}`
            };
          }
          return t;
        });
      };
      
      setTags(updateTagWithError(tags));
      setFilteredTags(updateTagWithError(filteredTags));
      setDisplayedTags(updateTagWithError(displayedTags));
    }
  }, [activeRegistry, registryService, repositoryName, tags]);

  // Function to render pagination
  const renderPagination = () => {
    if (totalPages <= 1) return null;
    
    // Create page buttons array
    const pageButtons = [];
    
    // First page button
    pageButtons.push(
      <button
        key="first"
        onClick={() => handlePageChange(1)}
        className={`px-3 py-1 rounded-md ${
          currentPage === 1 
            ? 'bg-gray-400 text-white cursor-not-allowed'
            : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
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
            ? 'bg-gray-400 text-white cursor-not-allowed'
            : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
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
          key="1"
          onClick={() => handlePageChange(1)}
          className="px-3 py-1 rounded-md bg-gray-200 hover:bg-gray-300 text-gray-700"
          aria-label="Page 1"
        >
          1
        </button>
      );
      
      if (startPage > 2) {
        pageButtons.push(
          <span key="ellipsis1" className="px-2 py-1 text-gray-500 font-medium">
            ...
          </span>
        );
      }
    }
    
    // Page number buttons
    for(let i = startPage; i <= endPage; i++) {
      pageButtons.push(
        <button
          key={i}
          onClick={() => handlePageChange(i)}
          className={`px-3 py-1 rounded-md ${
            currentPage === i 
              ? 'bg-secondaryBlue text-white dark:bg-blue-600' 
              : 'bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300'
          }`}
          aria-label={`Page ${i}`}
          aria-current={currentPage === i ? 'page' : undefined}
        >
          {i}
        </button>
      );
    }
    
    // If there are more pages after endPage, show ellipsis
    if (endPage < totalPages - 1) {
      pageButtons.push(
        <span key="ellipsis-end" className="px-3 py-1 text-gray-700 dark:text-gray-300">
          ...
        </span>
      );
    }
    
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
          Page {currentPage} of {totalPages} ({filteredTags.length} tags)
        </div>
      </div>
    );
  };

  // Add a recovery mechanism for tag loading failures
  useEffect(() => {
    // If we're not loading but have no tags displayed, and have a registry,
    // try to recover by reloading tags
    if (!loading && 
        displayedTags.length === 0 && 
        tags.length === 0 && 
        activeRegistry && 
        !error) {
      console.log('Recovery: No tags displayed despite loading completed, attempting to reload');
      
      // Use a small delay to avoid immediate reload
      const recoveryTimer = setTimeout(() => {
        // Check if we still need to recover
        if (displayedTags.length === 0 && tags.length === 0) {
          console.log('Executing recovery reload');
          
          // Clear any cached data for this repository first
          const cacheKey = getTagCacheKey(activeRegistry, repositoryName);
          tagCache.current.delete(cacheKey);
          
          // Try loading tags again
          loadTags();
        }
      }, 1500);
      
      return () => clearTimeout(recoveryTimer);
    }
  }, [loading, displayedTags.length, tags.length, activeRegistry, error, repositoryName, loadTags, getTagCacheKey]);
  
  // Ensure loading state is cleared after a timeout if we have data but loading is still true
  useEffect(() => {
    if (loading && displayedTags.length > 0) {
      const timeoutId = setTimeout(() => {
        console.log('Safety timeout: Loading still true but tags are displayed, clearing loading state');
        setLoadingWithLogging(false);
      }, 500);
      
      return () => clearTimeout(timeoutId);
    }
  }, [loading, displayedTags.length, setLoadingWithLogging]);
  
  // Ensure digests are loaded for visible tags whenever they change
  useEffect(() => {
    // Only load digests if we're not already loading and have tags to display
    if (!loading && 
        !isLoadingDigests && 
        displayedTags.length > 0 && 
        activeRegistry) {
      
      // Check if any tags need digest loading
      const tagsNeedingDigests = displayedTags.filter(
        tag => tag.digest === 'Loading...' || 
               tag.digest === 'Failed to load digest' ||
               tag.digest === 'Error loading digest' ||
               !tag.digest
      );
      
      if (tagsNeedingDigests.length > 0) {
        console.log(`Loading digests for ${tagsNeedingDigests.length} tags after display update`);
        
        // Use debounce to avoid making too many API calls in quick succession
        clearTimeout(digestLoadTimeoutRef.current);
        digestLoadTimeoutRef.current = setTimeout(() => {
          // Load digests for the actual displayed tags that need them
          loadTagDigests(activeRegistry, displayedTags);
        }, 100);
      }
    }
    
    // Clear timeout on component unmount
    return () => {
      clearTimeout(digestLoadTimeoutRef.current);
    };
  }, [loading, isLoadingDigests, displayedTags, activeRegistry, loadTagDigests]);

  // Function to handle registry change
  const handleRegistryChange = useCallback((registry: Registry) => {
    if (registry && (!activeRegistry || activeRegistry.id !== registry.id)) {
      setActiveRegistry(registry);
      loadTagsForRegistry(registry);
    }
  }, [activeRegistry, loadTagsForRegistry]);

  // Function to ensure platform details are loaded for visible tags
  useEffect(() => {
    // Only process if we're not loading and have tags to display
    if (!loading && 
        displayedTags.length > 0 && 
        activeRegistry) {
      
      // Check which tags need platform details by looking at the platformMap
      const tagsNeedingPlatformDetails = displayedTags.filter(tag => {
        const platformInfo = platformMap[tag.name];
        // Need to load if platformInfo doesn't exist or is not detailed
        return !platformInfo || (!platformInfo.detailed && !platformInfo.loading);
      });
      
      if (tagsNeedingPlatformDetails.length > 0) {
        console.log(`Loading platform details for ${tagsNeedingPlatformDetails.length} tags`);
        
        // Add a small delay to not block rendering
        const timeoutId = setTimeout(() => {
          // Process tags in sequence to avoid race conditions
          const processTagsSequentially = async () => {
            for (const tag of tagsNeedingPlatformDetails) {
              try {
                // Mark as loading in the platformMap before the API call
                setPlatformMap(prev => ({
                  ...prev,
                  [tag.name]: {
                    ...prev[tag.name],
                    loading: true
                  }
                }));
                
                await handleLoadTagDetails(tag);
              } catch (err) {
                console.error(`Failed to load platform details for ${tag.name}:`, err);
              }
            }
          };
          
          processTagsSequentially();
        }, 300);
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [displayedTags, loading, activeRegistry, handleLoadTagDetails, platformMap]);

  // Save tags with detailed info to localStorage for consumption by tag detail page
  useEffect(() => {
    if (tags.length > 0 && activeRegistry) {
      // Only save tags that have fully loaded digests and detail info
      const tagsWithDetails = tags.filter(tag => 
        tag.digest && tag.digest !== 'Loading...' && !tag.digestError
      );
      
      if (tagsWithDetails.length > 0) {
        try {
          const decodedRepositoryName = decodeURIComponent(repositoryName);
          const cacheKey = `tags-${activeRegistry.server}-${decodedRepositoryName}-details`;
          
          // Store tag details in localStorage for the tag detail page to use
          localStorage.setItem(cacheKey, JSON.stringify(tagsWithDetails));
          console.log(`Saved ${tagsWithDetails.length} detailed tags to localStorage for tag detail page`);
        } catch (e) {
          console.error('Error saving tag details to localStorage:', e);
        }
      }
    }
  }, [tags, activeRegistry, repositoryName]);

  const [lifecycleInfoMap, setLifecycleInfoMap] = useState<Record<string, LifecycleInfo | null>>({});
  const [isLoadingLifecycleInfo, setIsLoadingLifecycleInfo] = useState(false);
  
  // Use a ref to track which tags have been processed to avoid infinite loops
  const processedLifecycleTagsRef = useRef<Set<string>>(new Set());
  
  // Reset lifecycle info when repository or registry changes
  useEffect(() => {
    processedLifecycleTagsRef.current.clear();
    setLifecycleInfoMap({});
  }, [repositoryName, activeRegistry?.id]);

  // Function to load lifecycle info for all visible tags
  const loadLifecycleInfo = useCallback(async (registry: Registry, visibleTags: Tag[]) => {
    if (!registry || !registry.id || visibleTags.length === 0) {
      return;
    }
    
    // Filter to only tags we haven't processed yet
    const tagsToProcess = visibleTags.filter(
      tag => !processedLifecycleTagsRef.current.has(tag.name)
    );
    
    if (tagsToProcess.length === 0) {
      return;
    }
    
    setIsLoadingLifecycleInfo(true);
    console.log(`[Repository] Loading lifecycle info for ${tagsToProcess.length} tags`);
    
    const decodedRepositoryName = decodeURIComponent(repositoryName);
    const newInfoMap: Record<string, LifecycleInfo | null> = {};
    
    // Mark these tags as being processed
    tagsToProcess.forEach(tag => processedLifecycleTagsRef.current.add(tag.name));
    
    // Process tags in batches to avoid too many concurrent requests
    const batchSize = 5;
    for (let i = 0; i < tagsToProcess.length; i += batchSize) {
      const batch = tagsToProcess.slice(i, Math.min(i + batchSize, tagsToProcess.length));
      
      await Promise.all(
        batch.map(async (tag) => {
          try {
            const info = await getLifecycleInfo(registry, decodedRepositoryName, tag.name, tag.digest);
            newInfoMap[tag.name] = info;
            
            if (info?.eolDate) {
              console.log(`[Repository] Found EOL date for ${tag.name}: ${info.formattedEolDate}`);
            }
          } catch (error) {
            console.error(`[Repository] Error fetching lifecycle info for ${tag.name}:`, error);
            newInfoMap[tag.name] = null;
          }
        })
      );
    }
    
    // Use functional update to merge with existing state without dependency
    setLifecycleInfoMap(prev => ({ ...prev, ...newInfoMap }));
    setIsLoadingLifecycleInfo(false);
  }, [repositoryName]);
  
  // Load lifecycle info when displayed tags change
  useEffect(() => {
    if (!loading && displayedTags.length > 0 && activeRegistry && !isLoadingLifecycleInfo) {
      // Wait until digests are loaded
      const allDigestsLoaded = displayedTags.every(tag => 
        tag.digest && 
        tag.digest !== 'Loading...' && 
        !tag.digestError
      );
      
      if (allDigestsLoaded) {
        loadLifecycleInfo(activeRegistry, displayedTags);
      }
    }
  }, [displayedTags, loading, activeRegistry, isLoadingLifecycleInfo, loadLifecycleInfo]);

  return (
    <div className="container mx-auto px-4">
      <div className="flex flex-wrap items-center justify-between gap-y-4">
        <div>
          <nav aria-label="breadcrumb" className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            <ol className="flex items-center gap-2">
              <li>
                <Link 
                  href="/registry" 
                  className="hover:underline text-blue-600 dark:text-blue-400 font-medium"
                >
                  Catalog
                </Link>
              </li>
              <li>
                <span className="mx-1">→</span>
              </li>
              <li className="text-gray-800 dark:text-gray-200 font-medium truncate max-w-[250px] md:max-w-md">
                {repositoryName}
              </li>
            </ol>
          </nav>
          <h1 className="text-2xl md:text-3xl font-bold mb-2 text-gray-800 dark:text-white">
            {repositoryName}
          </h1>
        </div>
        
        {/* Registry switcher */}
        <div className="w-full md:w-auto">
          <RegistryManager />
        </div>
      </div>

      <div className="my-6">
        {/* Search box */}
        <div className="flex items-stretch">
          <div className="flex-grow">
            <SearchBox
              placeholder={getSearchPlaceholder()}
              onSearch={handleSearch}
              initialQuery={searchQuery}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-md">
          {error}
        </div>
      )}

      {/* Show the digest search banner when searching for digests */}
      {isDigestSearch && (
        <DigestSearchBanner
          isSearching={isDigestSearching}
          foundCount={foundCount}
          searchedCount={searchedCount}
          totalToSearch={totalToSearch}
          progress={progress}
          searchQuery={searchQuery}
        />
      )}

      {loading ? (
        <SkeletonTagGrid />
      ) : isDigestSearch && isDigestSearching && digestSearchResults.length === 0 ? (
        <DigestSearchSkeleton />
      ) : (
        <>
          {filteredTags.length === 0 ? (
            <div className="text-center p-8 bg-gray-50 dark:bg-slate-800/50 rounded-lg">
              <p className="text-gray-500 dark:text-gray-400">No tags or digests found</p>
            </div>
          ) : (
            <div className="pb-10 bg-transparent">
              <TagGridTable 
                tags={displayedTags}
                repositoryName={repositoryName}
                onRetry={(tagName) => handleRetryTagDigest(tagName)}
                platformMap={platformMap}
                lifecycleInfoMap={lifecycleInfoMap}
              />
              
              <div className="mt-8">
                {renderPagination()}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Wrap the repository detail page content in a suspense boundary
export default function RepositoryPage({ params }: RepositoryPageProps) {
  return (
    <Suspense fallback={
      <div className="container mx-auto py-6 px-4 max-w-6xl min-h-[70vh] flex items-center justify-center dark:bg-slate-900">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
          <div className="h-4 w-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    }>
      <RepositoryDetailContent params={params} />
    </Suspense>
  );
} 