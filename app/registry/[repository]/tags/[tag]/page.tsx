'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { useRouter, useSearchParams } from 'next/navigation';
import registryService from '@/app/services/registryService';
import { Tag, Registry, ManifestResponse, Referrer } from '@/app/types/registry';
import SkeletonTagDetail from '@/app/components/SkeletonTagDetail';
import { discoverReferrers, fetchSbomLayerInfo } from './actions';
import { getLifecycleInfo, LifecycleInfo, getEolMessage } from '@/app/utils/lifecycleUtils';
import { highlightSearchTerms, syntaxHighlightJson } from '@/app/utils/syntaxHighlight';
import { ArtifactCardList } from '@/app/components/ArtifactCard';
import ArtifactManifestPanel from '@/app/components/ArtifactManifestPanel';
import useArtifactTypes from '@/app/hooks/useArtifactTypes';
import { formatSize } from '@/app/utils/format';
import CopyButton from '@/app/components/CopyButton';
import { isSbomArtifact } from '@/app/utils/constants';

interface TagDetailPageProps {
  params: Promise<{
    repository: string;
    tag: string;
  }>
}

export default function TagDetailPage({ params }: TagDetailPageProps) {
  // In Next.js 15+, params is a Promise - use React.use() to unwrap it
  const resolvedParams = use(params);
  const { repository: encodedRepositoryName, tag: encodedTagName } = resolvedParams;
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Decode the repository and tag names for display
  const repositoryName = decodeURIComponent(encodedRepositoryName);
  const tagName = decodeURIComponent(encodedTagName);
  
  // Get platform information and digest from URL parameters if available
  const architectureFromParams = searchParams.get('architecture');
  const osFromParams = searchParams.get('os');
  const digestFromParams = searchParams.get('digest');
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tagDetails, setTagDetails] = useState<Tag | null>(null);
  const [activeRegistry, setActiveRegistry] = useState<Registry | null>(null);
  const [manifest, setManifest] = useState<ManifestResponse | null>(null);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [referrers, setReferrers] = useState<Referrer[] | null>(null);
  const [referrersLoading, setReferrersLoading] = useState(false);
  const [referrersError, setReferrersError] = useState<string | null>(null);
  const [referrersLoaded, setReferrersLoaded] = useState(false);
  const [manifestSearchQuery, setManifestSearchQuery] = useState('');
  const [referrersSearchQuery, setReferrersSearchQuery] = useState('');
  const [referrersTreeOutput, setReferrersTreeOutput] = useState<string>('');
  const [lifecycleInfo, setLifecycleInfo] = useState<LifecycleInfo | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  // State for supply chain artifact manifest side panel
  const [selectedReferrer, setSelectedReferrer] = useState<Referrer | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const { getArtifactType } = useArtifactTypes();
  
  // Convert tag details to a user-friendly form, using URL parameters if available
  const displayTagDetails = {
    name: tagName,
    // Prioritize digest from URL params (from tag list) over the one from manifest
    digest: digestFromParams || tagDetails?.digest || 'Loading...',
    size: tagDetails?.size,
    architecture: architectureFromParams || tagDetails?.architecture || 'Loading...',
    os: osFromParams || tagDetails?.os || 'Loading...',
  };
  
  // Format the artifact reference URI - properly decoded for display
  // Always prioritize the tag's digest from URL parameters (from tag list) over manifest digest
  const artifactURI = activeRegistry && (digestFromParams || tagDetails?.digest) ? 
    `${activeRegistry.server}/${repositoryName}@${digestFromParams || tagDetails?.digest}` : 
    'Loading...';
  
  // Load tag details on mount
  useEffect(() => {
    const loadTagDetails = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Get current registry
        const registry = registryService.getCurrentRegistry();
        
        if (!registry) {
          throw new Error('Registry not found. Please select a valid registry.');
        }
        
        setActiveRegistry(registry);
        
        // Check if tag data is already in session storage cache
        const cacheKey = `tags-${registry.server}-${repositoryName}`;
        let cachedTag: Tag | null = null;
        
        if (typeof window !== 'undefined') {
          try {
            // First try to get detailed tag info directly from localStorage
            // This is populated by the repository page and has complete tag details
            const detailsKey = `tags-${registry.server}-${repositoryName}-details`;
            const cachedDetails = localStorage.getItem(detailsKey);
            
            if (cachedDetails) {
              try {
                const tagDetails = JSON.parse(cachedDetails);
                console.log(`Found ${tagDetails.length} cached detailed tags`);
                
                const matchingTag = tagDetails.find((t: any) => t.name === tagName);
                if (matchingTag && matchingTag.digest && matchingTag.digest !== 'Loading...') {
                  console.log(`Found cached tag details for ${tagName} with digest ${matchingTag.digest.substring(0, 12)}...`);
                  cachedTag = matchingTag;
                  
                  // Use all available details from cache
                  const tagWithCompleteDetails = {
                    ...matchingTag,
                    // Ensure we have all available fields
                    architecture: matchingTag.architecture || undefined,
                    os: matchingTag.os || undefined,
                    size: matchingTag.size || undefined,
                    digest: matchingTag.digest,
                    detailed: true
                  };
                  
                  setTagDetails(tagWithCompleteDetails);
                  
                  // Set artifact URI immediately since we have the digest
                  console.log(`Setting artifact URI from cached data: ${registry.server}/${repositoryName}@${matchingTag.digest}`);
                  
                  // Skip loading manifest if we have digest already
                  setManifestLoading(false);
                  
                  // We'll still load manifest data separately for more details
                  try {
                    const manifestData = await registryService.getManifest(
                      registry,
                      repositoryName,
                      tagName
                    );
                    setManifest(manifestData);
                  } catch (manifestErr) {
                    console.error('Error loading manifest:', manifestErr);
                    setManifestError(manifestErr instanceof Error ? manifestErr.message : 'Failed to load manifest');
                  }
                  
                  setLoading(false);
                  return; // Exit early if we found cached data
                }
              } catch (e) {
                console.error('Error parsing localStorage cached tag details:', e);
              }
            }
            
            // Fall back to session storage if localStorage doesn't have the data
            const cachedData = sessionStorage.getItem(cacheKey);
            if (cachedData) {
              const parsed = JSON.parse(cachedData);
              if (parsed.data && parsed.data.tags && Array.isArray(parsed.data.tags)) {
                // Look for this tag in already cached tags
                console.log(`Checking sessionStorage cache for tag data: ${tagName}`);
                
                // For this to work, the tags need to have been loaded with detailed info
                const loadedTags = window.localStorage.getItem(`${cacheKey}-details`);
                if (loadedTags) {
                  try {
                    const tagDetails = JSON.parse(loadedTags);
                    const matchingTag = tagDetails.find((t: any) => t.name === tagName);
                    if (matchingTag && matchingTag.digest && matchingTag.digest !== 'Loading...') {
                      console.log(`Found cached tag details in sessionStorage for ${tagName}`);
                      cachedTag = matchingTag;
                      
                      // Use platform details from cache if available
                      const tagWithPlatformDetails = {
                        ...matchingTag,
                        // Ensure architecture, os, and other platform details are included
                        architecture: matchingTag.architecture || undefined,
                        os: matchingTag.os || undefined,
                        detailed: true
                      };
                      
                      setTagDetails(tagWithPlatformDetails);
                      
                      // Skip loading manifest if we have digest already
                      setManifestLoading(false);
                      
                      // We'll still load manifest data separately for more details
                      try {
                        const manifestData = await registryService.getManifest(
                          registry,
                          repositoryName,
                          tagName
                        );
                        setManifest(manifestData);
                      } catch (manifestErr) {
                        console.error('Error loading manifest:', manifestErr);
                        setManifestError(manifestErr instanceof Error ? manifestErr.message : 'Failed to load manifest');
                      }
                      
                      setLoading(false);
                      return; // Exit early if we found cached data
                    }
                  } catch (e) {
                    console.error('Error parsing sessionStorage cached tag details:', e);
                  }
                }
              }
            }
          } catch (e) {
            console.error('Error retrieving from cache:', e);
          }
        }
        
        // If we don't have cached data, proceed with normal loading
        console.log(`No cached data found for ${tagName}, loading from API`);
        
        // Create a tag object with any known platform information from URL parameters
        const tagObj: Tag = {
          name: tagName,
          detailed: false,
          // Preserve URL parameter platform data if available
          architecture: architectureFromParams || undefined,
          os: osFromParams || undefined
        };
        
        // Load tag platform details
        const tagWithDetails = await registryService.getTagPlatformDetails(
          registry,
          repositoryName,
          tagObj
        );
        
        // Make sure we don't overwrite URL parameter data if the API didn't return these values
        if (architectureFromParams && !tagWithDetails.architecture) {
          tagWithDetails.architecture = architectureFromParams;
        }
        
        if (osFromParams && !tagWithDetails.os) {
          tagWithDetails.os = osFromParams;
        }
        
        setTagDetails(tagWithDetails);
        
        // Load manifest in the same initial request
        try {
          setManifestLoading(true);
          const manifestData = await registryService.getManifest(
            registry,
            repositoryName,
            tagName
          );
          setManifest(manifestData);
          
          // If tag details still missing digest or size, populate from manifest
          if (manifestData.digest && (!tagWithDetails.digest || tagWithDetails.digest === 'Loading...')) {
            setTagDetails(prev => prev ? { ...prev, digest: manifestData.digest } : prev);
          }
          
          setManifestLoading(false);
        } catch (manifestErr) {
          console.error('Error loading manifest:', manifestErr);
          setManifestError(manifestErr instanceof Error ? manifestErr.message : 'Failed to load manifest');
          setManifestLoading(false);
        }
      } catch (err) {
        console.error('Error loading tag details:', err);
        setError(err instanceof Error ? err.message : 'Failed to load tag details');
      } finally {
        setLoading(false);
      }
    };
    
    loadTagDetails();
  }, [repositoryName, tagName]);
  
  // Load referrers (OCI References/SBOM info) for the current tag
  const loadReferrers = async () => {
    // Only load if not already loading
    if (referrersLoading) {
      console.log('Already loading referrers, skipping duplicate request');
      return;
    }
    
    // Don't reload if already loaded (unless forced)
    if (referrersLoaded && referrers && referrers.length > 0) {
      console.log('Referrers already loaded, skipping duplicate request');
      return;
    }
    
    if (!activeRegistry?.id) {
      setReferrersError("Registry information is needed to load referrers");
      setReferrersLoading(false);
      return;
    }

    // We can load referrers without a digest, the server action will handle it
    // using the tag name instead
    setReferrersLoading(true);
    setReferrersError('');
    
    try {
      // Get credentials if available from the credential store
      let credentials: { username?: string; password?: string } | undefined;
      try {
        // Import dynamically to avoid SSR issues
        const { getCredential } = await import('@/app/utils/credentialStore');
        
        // Only attempt to get credentials if we're in the browser
        if (typeof window !== 'undefined') {
          // Check if we have credentials for the registry
          const creds = getCredential(activeRegistry);
          if (creds && creds.username && creds.password) {
            console.log(`Found credentials for registry ${activeRegistry.server}, using for referrers API call`);
            credentials = {
              username: creds.username,
              password: creds.password
            };
          } else {
            console.log(`No credentials found for registry ${activeRegistry.server}`);
          }
        }
      } catch (e) {
        console.error('Error getting credentials:', e);
      }
      
      // Use server action instead of API call
      console.log(`Loading referrers for ${repositoryName}:${tagName}${credentials ? ' with credentials' : ''}`);
      const result = await discoverReferrers(
        activeRegistry.server,
        repositoryName,
        tagName,
        activeRegistry.id,
        credentials
      );
      
      if (result.success) {
        console.log('Server action completed successfully');
        
        // Handle successful response
        if (result.noReferrers) {
          console.log('No supply chain artifacts found');
          setReferrersTreeOutput(result.treeOutput); // Only show the root artifact
          setReferrers([]);
          // Set a specific "no referrers" error that will be handled differently in the UI
          setReferrersError('No supply chain artifacts found for this image');
        } else {
          setReferrersTreeOutput(result.treeOutput);
          setReferrers(result.raw || []);
          // Clear any previous error if we now have data
          setReferrersError('');

          // Enrich SBOM referrers with actual blob size (background, non-blocking)
          const sbomRefs = (result.raw || []).filter(
            (r: Referrer) => isSbomArtifact(r.artifactType)
          );
          if (sbomRefs.length > 0 && activeRegistry) {
            Promise.allSettled(
              sbomRefs.map(async (ref: Referrer) => {
                const layerResult = await fetchSbomLayerInfo(
                  activeRegistry.server,
                  repositoryName,
                  ref.digest,
                  activeRegistry.id || activeRegistry.server,
                  credentials
                );
                if (layerResult.success && layerResult.layerInfo.size > 0) {
                  return { digest: ref.digest, size: layerResult.layerInfo.size };
                }
                return null;
              })
            ).then((results) => {
              const sizeMap = new Map<string, number>();
              for (const r of results) {
                if (r.status === 'fulfilled' && r.value) {
                  sizeMap.set(r.value.digest, r.value.size);
                }
              }
              if (sizeMap.size > 0) {
                setReferrers((prev) =>
                  prev ? prev.map((ref) =>
                    sizeMap.has(ref.digest)
                      ? { ...ref, size: sizeMap.get(ref.digest)! }
                      : ref
                  ) : prev
                );
              }
            });
          }
        }
      } else {
        // Handle error response - result.error and result.details are now guaranteed to be strings
        console.error('Server action error:', result.error, result.details);
        setReferrers([]);
        setReferrersTreeOutput('');
        
        // Set a more user-friendly error message
        if (result.error === 'Tag not found') {
          setReferrersError(`Tag '${tagName}' not found in repository. Please check that the tag exists.`);
        } else if (result.error === 'Authentication failed' || 
                  result.details.includes('401') || 
                  result.details.includes('Unauthorized') ||
                  result.details.toLowerCase().includes('authentication')) {
          setReferrersError(`Authentication error: Unable to access supply chain artifacts. 
                          Please check your registry credentials or ensure you have permissions to access this repository.`);
        } else if (result.details.includes('404') || result.details.includes('Not Found')) {
          setReferrersError(`The supply chain artifacts could not be found for this image. 
                          The repository or tag may not exist.`);
        } else if (result.details.includes('500') || result.details.includes('Internal Server Error')) {
          setReferrersError(`The registry encountered an internal error while retrieving supply chain artifacts. 
                          This may be a temporary issue. Please try again later.`);
        } else {
          setReferrersError(result.details || result.error);
        }
      }
    } catch (error) {
      console.error('Error loading referrers:', error);
      setReferrersError(error instanceof Error ? error.message : 'Error loading referrers');
      setReferrers([]);
      setReferrersTreeOutput('');
    } finally {
      setReferrersLoading(false);
      setReferrersLoaded(true);
    }
  };
  
  // Add effect to load lifecycle info
  useEffect(() => {
    const loadLifecycleInfo = async () => {
      if (!activeRegistry || !tagName) return;
      
      setLifecycleLoading(true);
      try {
        const info = await getLifecycleInfo(
          activeRegistry, 
          repositoryName, 
          tagName, 
          digestFromParams || tagDetails?.digest
        );
        setLifecycleInfo(info);
      } catch (error) {
        console.error('Error loading lifecycle info:', error);
      } finally {
        setLifecycleLoading(false);
      }
    };
    
    if (activeRegistry && repositoryName && tagName && !loading) {
      loadLifecycleInfo();
    }
  }, [activeRegistry, repositoryName, tagName, digestFromParams, tagDetails?.digest, loading]);
  
  // Render the skeleton loader for the manifest or referrers
  const renderSkeleton = () => (
    <div className="animate-pulse">
      <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-3/4 mb-3"></div>
      <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-full mb-3"></div>
      <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-5/6 mb-3"></div>
      <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-2/3 mb-3"></div>
      <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-full mb-3"></div>
    </div>
  );
  
  // Handler for clicking a supply chain artifact card
  const handleArtifactCardClick = (referrer: Referrer) => {
    setSelectedReferrer(referrer);
    setIsPanelOpen(true);
  };

  const closePanelHandler = () => {
    setIsPanelOpen(false);
  };
  
  // Render the manifest content with syntax highlighting
  const renderManifestContent = () => {
    if (manifestLoading) {
      return renderSkeleton();
    }
    
    if (manifestError) {
      return (
        <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-md">
          Error: {manifestError}
        </div>
      );
    }
    
    if (!manifest) {
      return (
        <div className="p-4 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-md">
          No manifest data available.
        </div>
      );
    }
    
    const manifestText = JSON.stringify(manifest, null, 2);
    
    return (
      <div className="relative">
        <CopyButton
          text={manifestText}
          label="Copy manifest to clipboard"
          size={20}
          className="absolute top-2 right-2 p-2 text-gray-600 dark:text-gray-400 z-10"
        />
        <pre className="bg-white dark:bg-slate-800 p-4 rounded-md overflow-x-auto text-sm font-mono border border-gray-200 dark:border-gray-700">
          <code>
            {manifestSearchQuery.trim() ? 
              highlightSearchTerms(manifestText, manifestSearchQuery) : 
              syntaxHighlightJson(manifestText, manifestSearchQuery)
            }
          </code>
        </pre>
      </div>
    );
  };
  
  // Render the referrers content as structured artifact cards
  const renderReferrersContent = () => {
    if (referrersLoading) {
      return renderSkeleton();
    }
    
    // Consolidate the different "no artifacts" cases into a single, consistent UI
    if (referrersError || (!referrers || referrers.length === 0) && !referrersTreeOutput) {
      // Check for specific error types to provide better UX
      const isNoReferrersError = referrersError === 'No supply chain artifacts found for this image' || 
                               ((!referrers || referrers.length === 0) && !referrersTreeOutput);
      const isAuthError = referrersError && 
                        (referrersError.includes('Authentication') || 
                         referrersError.includes('authentication') ||
                         referrersError.includes('Unauthorized') || 
                         referrersError.includes('401'));
      
      return (
        <div className="p-6 bg-white dark:bg-slate-800 rounded-md border border-gray-200 dark:border-gray-700">
          <div className="flex flex-col items-center text-center">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              className={`h-12 w-12 mb-4 ${isNoReferrersError ? 'text-blue-500' : isAuthError ? 'text-yellow-500' : 'text-red-500'}`}
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              {isNoReferrersError ? (
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={1.5} 
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
                />
              ) : isAuthError ? (
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={1.5} 
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
                />
              ) : (
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={1.5} 
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
                />
              )}
            </svg>
            
            <h3 className={`text-lg font-medium mb-2 ${
              isNoReferrersError ? 'text-blue-700 dark:text-blue-400' : 
              isAuthError ? 'text-yellow-700 dark:text-yellow-400' : 
              'text-red-700 dark:text-red-400'
            }`}>
              {isNoReferrersError ? 'No Supply Chain Artifacts' : 
               isAuthError ? 'Authentication Error' : 
               'Error Discovering Supply Chain Artifacts'}
            </h3>
            
            <div className="text-sm mb-4 max-w-lg">
              {isNoReferrersError ? (
                <p className="text-gray-600 dark:text-gray-300">
                  This image does not have any associated supply chain artifacts.
                </p>
              ) : isAuthError ? (
                <p className="text-gray-600 dark:text-gray-300">
                  Unable to access supply chain artifacts. Please check your registry credentials or ensure you have permissions to access this repository.
                </p>
              ) : (
                <p className="text-red-600 dark:text-red-300">
                  {referrersError}
                </p>
              )}
            </div>
            
            {!isNoReferrersError && (
              <button
                onClick={() => {
                  setReferrersLoaded(false);
                  loadReferrers();
                }}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  isAuthError 
                    ? 'bg-yellow-100 hover:bg-yellow-200 text-yellow-800 dark:bg-yellow-800/30 dark:hover:bg-yellow-700/40 dark:text-yellow-200' 
                    : 'bg-red-100 hover:bg-red-200 text-red-800 dark:bg-red-800/30 dark:hover:bg-red-700/40 dark:text-red-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 2v6h-6"></path>
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
                    <path d="M3 12a9 9 0 0 0 6.7 15L13 21"></path>
                    <path d="M13 21h6v-6"></path>
                  </svg>
                  Try Again
                </div>
              </button>
            )}
          </div>
        </div>
      );
    }

    // Render artifact cards (works for both tree-output and legacy/raw referrer data)
    if (referrers && referrers.length > 0) {
      return (
        <ArtifactCardList
          referrers={referrers}
          getArtifactTypeLabel={(type) => getArtifactType(type)}
          searchQuery={referrersSearchQuery}
          onCardClick={handleArtifactCardClick}
          registryServer={activeRegistry?.server}
          repositoryName={repositoryName}
        />
      );
    }

    return null;
  };
  
  // Render tag details with proper formatting
  const renderTagDetails = () => {
    // Show skeletons only while initial loading is in progress
    const isLoaded = !loading && tagDetails !== null;
    const isDigestLoading = !isLoaded || !tagDetails?.digest || tagDetails?.digest === 'Loading...';
    
    // Platform from any source
    const arch = tagDetails?.architecture || architectureFromParams;
    const os = tagDetails?.os || osFromParams;
    const platformText = arch && os ? `${os}/${arch}` : arch || os || (isLoaded ? 'Unavailable' : '');
    const isPlatformLoading = !isLoaded && !arch && !os;
    
    // Size — formatSize handles undefined/0 gracefully
    const sizeText = isLoaded ? formatSize(tagDetails?.size) : '';
    
    // Use proper artifact URI immediately if digest is available
    const displayArtifactURI = isDigestLoading ? 'Loading...' : 
      `${activeRegistry?.server || ''}/${repositoryName}@${tagDetails?.digest}`;
    
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
        {/* Tag name */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Tag</h3>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">{tagName}</p>
        </div>
        
        {/* Digest */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Digest</h3>
          <div className="flex items-center">
            {!isDigestLoading ? (
              <p className="text-sm font-mono text-gray-900 dark:text-white truncate">
                {displayTagDetails.digest}
              </p>
            ) : (
              <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
            )}
            {!isDigestLoading && (
              <CopyButton
                text={displayTagDetails.digest}
                label="Copy digest to clipboard"
                size={14}
                className="ml-2 text-gray-500 dark:text-gray-400"
              />
            )}
          </div>
        </div>
        
        {/* Platform (combined architecture and OS) */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Platform</h3>
          {isPlatformLoading ? (
            <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
          ) : (
            <p className="text-sm text-gray-900 dark:text-white">{platformText}</p>
          )}
        </div>
        
        {/* Size */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Size</h3>
          {!isLoaded ? (
            <div className="h-5 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
          ) : (
            <p className="text-sm text-gray-900 dark:text-white">{sizeText}</p>
          )}
        </div>
        
        {/* Reference URI */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Reference URI</h3>
          <div className="flex items-center">
            {displayArtifactURI !== 'Loading...' ? (
              <p className="text-sm font-mono text-gray-900 dark:text-white truncate">
                {displayArtifactURI}
              </p>
            ) : (
              <div className="h-5 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
            )}
            {displayArtifactURI !== 'Loading...' && (
              <CopyButton
                text={displayArtifactURI}
                label="Copy reference URI to clipboard"
                size={14}
                className="ml-2 text-gray-500 dark:text-gray-400"
              />
            )}
          </div>
        </div>
      </div>
    );
  };
  
  return (
    <div className="container mx-auto px-4 pb-24">
      <div className="mb-6">
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
            <li>
              <Link 
                href={`/registry/${encodedRepositoryName}`}
                className="hover:underline text-blue-600 dark:text-blue-400 font-medium"
              >
                {repositoryName}
              </Link>
            </li>
            <li>
              <span className="mx-1">→</span>
            </li>
            <li className="text-gray-800 dark:text-gray-200 font-medium truncate max-w-[250px] md:max-w-md">
              {tagName}
            </li>
          </ol>
        </nav>
      </div>
      
      {loading ? (
        <SkeletonTagDetail />
      ) : error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border dark:border-red-900 border-red-200 rounded-md p-4 my-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error loading tag details</h3>
              <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                <p>{error}</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* EOL banner - shows different colors based on status */}
          {lifecycleInfo?.eolDate && lifecycleInfo.eolStatus && (() => {
            const eolMessage = getEolMessage(lifecycleInfo);
            
            // Define styles based on EOL status
            const statusStyles = {
              expired: {
                container: 'bg-red-100 dark:bg-red-950 border-red-500 dark:border-red-600',
                icon: 'text-red-600 dark:text-red-500',
                text: 'text-red-800 dark:text-red-200',
                title: 'End of Life',
                iconPath: (
                  <>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </>
                )
              },
              warning: {
                container: 'bg-yellow-100 dark:bg-yellow-950 border-yellow-500 dark:border-yellow-600',
                icon: 'text-yellow-600 dark:text-yellow-500',
                text: 'text-yellow-800 dark:text-yellow-200',
                title: 'Upcoming End of Life',
                iconPath: (
                  <>
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </>
                )
              },
              upcoming: {
                container: 'bg-green-100 dark:bg-green-950 border-green-500 dark:border-green-600',
                icon: 'text-green-600 dark:text-green-500',
                text: 'text-green-800 dark:text-green-200',
                title: 'Scheduled End of Life',
                iconPath: (
                  <>
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </>
                )
              }
            };
            
            const styles = statusStyles[lifecycleInfo.eolStatus];
            
            return (
              <div className={`mb-4 p-4 ${styles.container} border-l-4 rounded-md shadow-sm`}>
                <div className="flex items-start">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`h-5 w-5 mr-3 mt-0.5 flex-shrink-0 ${styles.icon}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {styles.iconPath}
                  </svg>
                  <div className={styles.text}>
                    <h3 className="font-medium text-lg">{styles.title}</h3>
                    <p className="mt-1">
                      {eolMessage}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}
          
          {/* Tag information section */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-4 text-gray-800 dark:text-white">
              {displayTagDetails.name}
            </h1>
            
            {renderTagDetails()}
          </div>
          
          {/* Tabs for manifests and referrers */}
          <Tabs defaultValue="manifest" className="mb-8" onValueChange={(value) => {
            if (value === 'referrers' && !referrersLoaded) {
              loadReferrers();
            }
          }}>
            <TabsList className="w-full border-b border-gray-200 dark:border-gray-700 mb-4 bg-transparent rounded-none p-0 h-auto">
              <TabsTrigger value="manifest" className="flex-1 rounded-t-md rounded-b-none border-b-2 border-transparent data-[state=active]:border-blue-500 dark:data-[state=active]:border-blue-400">
                Manifest
              </TabsTrigger>
              <TabsTrigger value="referrers" className="flex-1 rounded-t-md rounded-b-none border-b-2 border-transparent data-[state=active]:border-blue-500 dark:data-[state=active]:border-blue-400">
                Supply Chain Artifacts
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="manifest" className="mt-4">
              <div className="mb-4">
                <Input
                  type="text"
                  placeholder="Search in manifest..."
                  value={manifestSearchQuery}
                  onChange={(e) => setManifestSearchQuery(e.target.value)}
                  className="w-full placeholder:text-gray-500 dark:placeholder:text-gray-400 text-gray-900 dark:text-gray-100"
                  aria-label="Search in manifest"
                />
              </div>
              {renderManifestContent()}
            </TabsContent>
            
            <TabsContent value="referrers" className="mt-4">
              <div className="mb-4">
                <Input
                  type="text"
                  placeholder="Search in supply chain artifacts..."
                  value={referrersSearchQuery}
                  onChange={(e) => setReferrersSearchQuery(e.target.value)}
                  className="w-full placeholder:text-gray-500 dark:placeholder:text-gray-400 text-gray-900 dark:text-gray-100"
                  aria-label="Search in supply chain artifacts"
                />
              </div>
              {renderReferrersContent()}
            </TabsContent>
          </Tabs>

          {/* Supply chain artifact manifest side panel */}
          <ArtifactManifestPanel
            isOpen={isPanelOpen}
            onClose={closePanelHandler}
            referrer={selectedReferrer}
            artifactTypeLabel={getArtifactType(selectedReferrer?.artifactType || selectedReferrer?.mediaType)}
            activeRegistry={activeRegistry}
            repositoryName={repositoryName}
          />
        </>
      )}
    </div>
  );
} 