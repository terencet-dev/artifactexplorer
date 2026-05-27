import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { Tag, Registry } from '@/app/types/registry';
import registryService from '@/app/services/registryService';

interface UseDigestSearchProps {
  repositoryName: string;
  registry: Registry | null;
  tags: Tag[];
  searchQuery: string;
}

interface DigestSearchResult {
  matchingTags: Tag[];
  isSearching: boolean;
  foundCount: number;
  searchedCount: number;
  totalToSearch: number;
  progress: number; // 0-100
}

interface LoadedDigestInfo {
  [tagName: string]: {
    digest: string;
    timestamp: number;
  };
}

/**
 * Custom hook for searching tags by digest
 * - Caches results with React Query
 * - Provides progress updates during search
 * - Returns all matching tags and search status
 */
export const useDigestSearch = ({
  repositoryName,
  registry,
  tags,
  searchQuery,
}: UseDigestSearchProps) => {
  const queryClient = useQueryClient();
  const [isDigestSearch, setIsDigestSearch] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{
    searchedCount: number;
    foundCount: number;
    totalToSearch: number;
    progress: number;
  }>({
    searchedCount: 0,
    foundCount: 0,
    totalToSearch: 0,
    progress: 0,
  });

  // Check if the current search is for a digest
  useEffect(() => {
    if (!searchQuery) {
      setIsDigestSearch(false);
      return;
    }

    const lowerQuery = searchQuery.toLowerCase().trim();
    const isDigest = lowerQuery.includes(':') || 
                    (lowerQuery.length > 8 && /^[a-f0-9]+$/.test(lowerQuery));
    
    setIsDigestSearch(isDigest);
  }, [searchQuery]);

  // Reset progress when search query changes
  useEffect(() => {
    if (!isDigestSearch) {
      return;
    }
    
    // Reset progress state when starting a new search
    setSearchProgress({
      searchedCount: 0,
      foundCount: 0,
      totalToSearch: tags.length,
      progress: 0,
    });
  }, [searchQuery, isDigestSearch, tags.length]);

  // Generate key for the repository-wide digest cache
  const repositoryDigestCacheKey = useMemo(
    () => ['repositoryDigests', registry?.id || 'no-registry', repositoryName],
    [registry?.id, repositoryName]
  );

  // Generate a unique query key for this specific search
  const searchQueryKey = [
    'digestSearch',
    registry?.id || 'no-registry',
    repositoryName,
    searchQuery,
  ];

  // Function to load digests and find matches
  const searchDigests = useCallback(async () => {
    if (!registry || !isDigestSearch || !searchQuery || tags.length === 0) {
      return { matchingTags: [], isComplete: true };
    }

    const lowerSearch = searchQuery.toLowerCase().trim();
    const decodedRepositoryName = decodeURIComponent(repositoryName);
    
    // Get the repository digest cache if it exists
    const cachedDigests = queryClient.getQueryData<LoadedDigestInfo>(repositoryDigestCacheKey) || {};
    
    // Find out which tags already have digests loaded in our tags array
    // and which ones need to be loaded from cache or API
    const tagsWithLoadedDigests: Tag[] = [];
    const tagsNeedingDigests: Tag[] = [];
    
    for (const tag of tags) {
      // If the tag already has a valid digest in its data, use that
      if (tag.digest && 
          tag.digest !== 'Loading...' && 
          tag.digest !== 'Failed to load digest' && 
          tag.digest !== 'Error loading digest') {
        tagsWithLoadedDigests.push(tag);
      } 
      // Check if the digest exists in our cache and is still valid
      else if (cachedDigests[tag.name]?.digest) {
        const cachedTag = {
          ...tag,
          digest: cachedDigests[tag.name].digest,
          loadingDigest: false,
          digestError: false,
          detailed: true
        };
        tagsWithLoadedDigests.push(cachedTag);
      } 
      // No valid digest found, need to load it
      else {
        tagsNeedingDigests.push(tag);
      }
    }
    
    // Find initial matches from already loaded digests
    const initialMatches = tagsWithLoadedDigests.filter(tag => 
      tag.digest && tag.digest.toLowerCase().includes(lowerSearch)
    );
    
    // If there are no tags needing digest loading, return only initial matches
    if (tagsNeedingDigests.length === 0) {
      setSearchProgress({
        searchedCount: tags.length,
        foundCount: initialMatches.length,
        totalToSearch: tags.length,
        progress: 100,
      });
      
      return { 
        matchingTags: initialMatches,
        isComplete: true
      };
    }
    
    // Start with matches from already loaded digests
    const result = [...initialMatches];
    let processed = 0;
    
    // Initialize progress with tags that already have digests
    setSearchProgress({
      searchedCount: tagsWithLoadedDigests.length,
      foundCount: initialMatches.length,
      totalToSearch: tags.length,
      progress: (tagsWithLoadedDigests.length / tags.length) * 100
    });
    
    // Process remaining tags in batches to avoid overwhelming the browser
    const batchSize = 5;
    const batches = Math.ceil(tagsNeedingDigests.length / batchSize);
    
    // Prepare a collection of newly loaded digests to update the cache
    const newDigestCache: LoadedDigestInfo = {...cachedDigests};
    
    for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
      const batchStart = batchIndex * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, tagsNeedingDigests.length);
      const batch = tagsNeedingDigests.slice(batchStart, batchEnd);
      
      // Process batch concurrently
      const batchResults = await Promise.all(
        batch.map(async (tag) => {
          try {
            const manifest = await registryService.getManifest(registry, decodedRepositoryName, tag.name);
            
            // Extract digest from manifest
            let digest: string | undefined;
            
            // Try to get digest from manifest
            if (manifest.digest) {
              digest = manifest.digest;
            } else if (manifest.manifests && manifest.manifests.length > 0 && manifest.manifests[0].digest) {
              digest = manifest.manifests[0].digest;
            } else if (manifest.fsLayers && manifest.fsLayers.length > 0 && manifest.fsLayers[0].blobSum) {
              digest = manifest.fsLayers[0].blobSum;
            } else if (manifest.config && manifest.config.digest) {
              digest = manifest.config.digest;
            }
            
            const finalDigest = digest || 'No digest available';
            
            // Store in cache for future use
            if (digest) {
              newDigestCache[tag.name] = {
                digest: finalDigest,
                timestamp: Date.now()
              };
            }
            
            // Update the tag with the digest
            const updatedTag = {
              ...tag,
              digest: finalDigest,
              digestError: false,
              loadingDigest: false,
              detailed: true,
            };
            
            // Check if the digest matches the search query
            const isMatch = digest && digest.toLowerCase().includes(lowerSearch);
            
            // Increment processed count
            processed++;
            
            // Update progress at most every 5 tags to avoid too many state updates
            if (processed % 5 === 0 || processed === tagsNeedingDigests.length) {
              setSearchProgress(prev => {
                const searchedCount = tagsWithLoadedDigests.length + processed;
                return {
                  searchedCount,
                  foundCount: prev.foundCount + (isMatch ? 1 : 0),
                  totalToSearch: tags.length,
                  progress: (searchedCount / tags.length) * 100
                };
              });
            }
            
            // For individual matches, update the matching count immediately
            if (isMatch) {
              setSearchProgress(prev => ({
                ...prev,
                foundCount: prev.foundCount + 1,
              }));
            }
            
            return { updatedTag, isMatch };
          } catch {
            // Handle error and increment processed count
            processed++;
            
            // Update progress at most every 5 tags to avoid too many state updates
            if (processed % 5 === 0 || processed === tagsNeedingDigests.length) {
              setSearchProgress(prev => {
                const searchedCount = tagsWithLoadedDigests.length + processed;
                return {
                  ...prev,
                  searchedCount,
                  progress: (searchedCount / tags.length) * 100
                };
              });
            }
            
            return { 
              updatedTag: {
                ...tag,
                digest: 'Error loading digest',
                digestError: true,
                loadingDigest: false
              }, 
              isMatch: false 
            };
          }
        })
      );
      
      // Add matching tags to result
      batchResults.forEach(({ updatedTag, isMatch }) => {
        if (isMatch) {
          result.push(updatedTag);
        }
      });
    }
    
    // Update the repository digest cache for future searches
    queryClient.setQueryData(repositoryDigestCacheKey, newDigestCache);
    
    // Ensure we set progress to 100% when complete
    setSearchProgress(prev => ({
      ...prev,
      searchedCount: tags.length,
      progress: 100
    }));
    
    return { 
      matchingTags: result,
      isComplete: true
    };
  }, [registry, isDigestSearch, searchQuery, tags, repositoryName, queryClient, repositoryDigestCacheKey]);
  
  // Set up the React Query
  const { data, isPending, isRefetching } = useQuery({
    queryKey: searchQueryKey,
    queryFn: searchDigests,
    enabled: !!registry && isDigestSearch && !!searchQuery && tags.length > 0,
    staleTime: 30 * 60 * 1000, // 30 minutes - longer stale time for digest searches
    refetchOnWindowFocus: false,
  });
  
  const result: DigestSearchResult = {
    matchingTags: data?.matchingTags || [],
    isSearching: isPending || isRefetching || !data?.isComplete,
    foundCount: searchProgress.foundCount,
    searchedCount: searchProgress.searchedCount,
    totalToSearch: searchProgress.totalToSearch,
    progress: searchProgress.progress
  };
  
  return result;
}; 