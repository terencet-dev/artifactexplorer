'use client';

import React, { useState, memo, useEffect, useRef } from 'react';
import { Tag, Registry } from '@/app/types/registry';
import { Tooltip } from '@/components/ui/tooltip';
import { getLifecycleInfo, LifecycleInfo } from '@/app/utils/lifecycleUtils';
import { formatSize as formatSizeUtil } from '@/app/utils/format';
import CopyButton from '@/app/components/CopyButton';

interface TagItemProps {
  tag: Tag;
  repositoryName: string;
  registry?: Registry | null;
  onLoadDetails?: (tag: Tag) => Promise<any>;
  onRetry?: (tagName: string) => void;
}

function TagItem({ tag, repositoryName, registry, onLoadDetails, onRetry }: TagItemProps) {
  const [showPlatformDetails, setShowPlatformDetails] = useState(false);
  const [isLoadingPlatform, setIsLoadingPlatform] = useState(false);
  const [platformInfoLoaded, setPlatformInfoLoaded] = useState(tag.detailed || false);
  const loadingRef = useRef(false);
  const [lifecycleInfo, setLifecycleInfo] = useState<LifecycleInfo | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  
  // Track changes to tag detailed status and update local state
  useEffect(() => {
    if (tag.detailed) {
      console.log(`Tag ${tag.name} is now detailed:`, tag);
      setPlatformInfoLoaded(true);
      setIsLoadingPlatform(false);
      // If we were loading platform info and now it's ready, show it
      if (loadingRef.current) {
        setShowPlatformDetails(true);
        loadingRef.current = false;
      }
    }
  }, [tag.detailed, tag.name, tag]);
  
  // Add effect to fetch lifecycle info
  useEffect(() => {
    const fetchLifecycleInfo = async () => {
      if (!registry) return;
      
      setLifecycleLoading(true);
      try {
        const info = await getLifecycleInfo(registry, repositoryName, tag.name, tag.digest);
        setLifecycleInfo(info);
      } catch (error) {
        console.error('Error fetching lifecycle info:', error);
      } finally {
        setLifecycleLoading(false);
      }
    };
    
    fetchLifecycleInfo();
  }, [tag.name, tag.digest, repositoryName, registry]);

  const handleRetry = () => {
    if (onRetry) {
      onRetry(tag.name);
    }
  };
  
  const handleViewPlatformClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("Platform info button clicked for tag:", tag.name);
    
    if (onLoadDetails) {
      console.log("Calling onLoadDetails callback with tag:", tag);
      // Make sure we're passing the actual tag to the callback
      try {
        const result = await onLoadDetails(tag);
        console.log(`Platform details API call completed for ${tag.name}:`, result);
        
        // Force update state with the result
        if (result) {
          setPlatformInfoLoaded(true);
          setIsLoadingPlatform(false);
          setShowPlatformDetails(true);
        }
      } catch (error) {
        console.error(`Error loading platform details for ${tag.name}:`, error);
        setIsLoadingPlatform(false);
        loadingRef.current = false;
      }
    } else {
      console.error("No onLoadDetails callback provided");
    }
  };

  // Render retry SVG icon
  const renderRetryIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M23 4v6h-6"></path>
      <path d="M1 20v-6h6"></path>
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10"></path>
      <path d="M20.49 15a9 9 0 01-14.85 3.36L1 14"></path>
    </svg>
  );

  // Handle digest display
  const renderDigest = () => {
    if (tag.digest === 'Loading...') {
      // Show loading state
      return (
        <div className="flex items-center">
          <div className="text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded font-mono text-gray-400 dark:text-gray-500 overflow-hidden whitespace-nowrap flex-1 mr-2 animate-pulse">
            Loading digest...
          </div>
        </div>
      );
    } else if (tag.digest === 'Failed to load digest' || tag.digest === 'Error loading digest') {
      // Show error state
      return (
        <div className="flex items-center">
          <div className="text-xs bg-red-50 dark:bg-red-900/30 p-2 rounded font-mono text-red-500 dark:text-red-400 overflow-hidden whitespace-nowrap flex-1 mr-2">
            Failed to load digest
          </div>
          
          {onRetry && (
            <button
              onClick={handleRetry}
              className="p-2 text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
              title="Retry loading digest"
            >
              {renderRetryIcon()}
            </button>
          )}
        </div>
      );
    } else {
      // Show actual digest with copy button - no fixed truncation
      return (
        <div className="flex items-center">
          <div className="text-xs bg-gray-100 dark:bg-gray-700 p-2 rounded font-mono text-gray-800 dark:text-gray-200 overflow-hidden text-ellipsis whitespace-nowrap flex-1 mr-2" title={tag.digest}>
            {tag.digest}
          </div>
          
          <CopyButton
            text={tag.digest || ''}
            label="Copy digest to clipboard"
            size={16}
            className="text-secondaryBlue dark:text-blue-400"
          />
        </div>
      );
    }
  };

  // Render platform info if available
  const renderPlatforms = () => {
    const hasPlatformInfo = tag.detailed && (tag.os || tag.architecture);
    
    // Loading state
    if (isLoadingPlatform) {
      return (
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          <div className="inline-flex items-center px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-xs">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mr-2 animate-spin"
            >
              <path d="M21 12a9 9 0 11-6.219-8.56"></path>
            </svg>
            Loading platform info...
          </div>
        </div>
      );
    }
    
    // Button to load platform info if not loaded yet
    if (!hasPlatformInfo) {
      return (
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          <button
            onClick={handleViewPlatformClick}
            className="inline-flex items-center px-3 py-1 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-800/40 text-blue-700 dark:text-blue-400 rounded text-xs cursor-pointer"
            type="button"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mr-1"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="16"></line>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
            View Platform Info
          </button>
        </div>
      );
    }

    // Render platform info - always show button as "View Platform Info"
    return (
      <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        <button
          onClick={handleViewPlatformClick}
          className="inline-flex items-center px-3 py-1 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-800/40 text-blue-700 dark:text-blue-400 rounded text-xs mb-2 cursor-pointer"
          type="button"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-1"
          >
            {showPlatformDetails ? (
              <>
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="8" y1="12" x2="16" y2="12"></line>
              </>
            ) : (
              <>
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="16"></line>
                <line x1="8" y1="12" x2="16" y2="12"></line>
              </>
            )}
          </svg>
          {showPlatformDetails ? 'Hide Platform Info' : 'View Platform Info'}
        </button>
        
        <div className="mt-1 ml-1 space-y-1">
          {/* Architecture Badge - BLUE */}
          {tag.architecture && (
            <span className="inline-block mr-2 mb-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded text-xs">
              {tag.architecture}
            </span>
          )}
          
          {/* OS Badge - GREEN */}
          {tag.os && (
            <span className="inline-block mr-2 mb-1 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded text-xs">
              {tag.os}
            </span>
          )}
          
          {/* Variant Badges - NEUTRAL */}
          {tag.variants && tag.variants.length > 0 && (
            <>
              {tag.variants.map((variant, index) => (
                <span key={index} className="inline-block mr-2 mb-1 px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 rounded text-xs">
                  {variant}
                </span>
              ))}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-5 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all">
      <div className="flex flex-col">
        <div className="flex justify-between items-start mb-3">
          <h3 className="font-semibold text-gray-800 dark:text-gray-200 text-lg flex items-center">
            {tag.name}
            
            {/* Add EOL warning icon if lifecycle info is available */}
            {lifecycleInfo?.eolDate && (
              <Tooltip content={`EOL: ${lifecycleInfo.formattedEolDate}`}>
                <svg
                  className="ml-2 w-4 h-4 text-red-500"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </Tooltip>
            )}
          </h3>
        </div>
        
        <div className="mt-2">
          <div className="text-sm text-gray-700 dark:text-gray-300 font-medium">Digest:</div>
          {renderDigest()}
        </div>
        
        {tag.size !== undefined && tag.size > 0 && (
          <div className="mt-3 text-sm text-gray-600 dark:text-gray-400">
            <span className="font-medium">Size:</span> {formatSize(tag.size)}
          </div>
        )}

        <div className="mt-3">
          {renderPlatforms()}
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  return formatSizeUtil(bytes, { zeroLabel: '0 B' });
}

// Memoize the component to prevent unnecessary re-renders
export default memo(TagItem); 