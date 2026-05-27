'use client';

import React from 'react';
import { Tag, Registry } from '@/app/types/registry';
import Link from 'next/link';
import useArtifactTypes from '@/app/hooks/useArtifactTypes';
import { Tooltip } from '@/components/ui/tooltip';
import { LifecycleInfo, getEolMessage } from '@/app/utils/lifecycleUtils';
import { formatSize } from '@/app/utils/format';
import CopyButton from '@/app/components/CopyButton';

interface TagGridTableProps {
  tags: Tag[];
  repositoryName: string;
  onRetry?: (tagName: string) => void;
  lifecycleInfoMap?: Record<string, LifecycleInfo | null>;
  platformMap?: Record<string, {
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
  }>;
}

export default function TagGridTable({ 
  tags, 
  repositoryName, 
  onRetry, 
  platformMap = {},
  lifecycleInfoMap = {} 
}: TagGridTableProps) {
  const { getArtifactType } = useArtifactTypes();

  const renderRetryButton = (tagName: string) => {
    if (!onRetry) return null;
    
    return (
      <button
        onClick={() => onRetry(tagName)}
        className="ml-2 p-1 text-blue-500 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
        title="Retry loading digest"
        aria-label="Retry loading digest"
      >
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
          aria-hidden="true"
        >
          <path d="M23 4v6h-6"></path>
          <path d="M1 20v-6h6"></path>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10"></path>
          <path d="M20.49 15a9 9 0 01-14.85 3.36L1 14"></path>
        </svg>
      </button>
    );
  };

  const renderPlatformInfo = (tag: Tag) => {
    const platformInfo = platformMap[tag.name];
    
    if (platformInfo === undefined || platformInfo.loading === true) {
      return (
        <div className="flex gap-1">
          <span className="px-2 py-0.5 text-xs rounded-full bg-gray-200 animate-pulse dark:bg-gray-700 w-14 h-5" />
          <span className="px-2 py-0.5 text-xs rounded-full bg-gray-200 animate-pulse dark:bg-gray-700 w-14 h-5" />
        </div>
      );
    }
    
    // Multi-arch manifest list: show all platform badges
    if (platformInfo.isManifestList && platformInfo.platforms && platformInfo.platforms.length > 0) {
      const platforms = platformInfo.platforms;
      // Deduplicate architectures for display
      const uniqueArchOsList = platforms.map(p => {
        const label = p.variant ? `${p.architecture}/${p.variant}` : p.architecture;
        return { label, os: p.os };
      });
      // Get unique OS values, filtering out "unknown"
      const uniqueOsSet = new Set(platforms.map(p => p.os).filter(os => os.toLowerCase() !== 'unknown'));
      const uniqueOsArray = Array.from(uniqueOsSet);
      
      const tooltipText = `Platforms (${platforms.length}):\n${platforms.map(p => `${p.os}/${p.architecture}${p.variant ? `/${p.variant}` : ''}`).join('\n')}`;
      
      return (
        <Tooltip content={tooltipText}>
          <div className="flex gap-1 flex-wrap cursor-help">
            {uniqueOsArray.length === 1 && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                {uniqueOsArray[0]}
              </span>
            )}
            {uniqueArchOsList.map((item, i) => (
              <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100">
                {item.label}
              </span>
            ))}
          </div>
        </Tooltip>
      );
    }
    
    let arch = platformInfo.architecture?.trim() || "";
    let os = platformInfo.os?.trim() || "";
    
    if (arch.toLowerCase() === "unknown" || arch.toLowerCase() === "multi-arch") arch = "";
    if (os.toLowerCase() === "unknown" || os.toLowerCase() === "multi-os") os = "";
    
    const hasArch = Boolean(arch);
    const hasOS = Boolean(os);
    
    if (!hasArch && !hasOS && platformInfo.detailed === true) {
      return (
        <span className="px-2 py-0.5 text-xs rounded-full border text-gray-500 dark:text-gray-300">
          unknown
        </span>
      );
    }
    
    if (hasArch || hasOS) {
      return (
        <div className="flex gap-1">
          {hasArch && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100">
              {arch}
            </span>
          )}
          {hasOS && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
              {os}
            </span>
          )}
        </div>
      );
    }
    
    return (
      <div className="flex gap-1">
        <span className="px-2 py-0.5 text-xs rounded-full bg-gray-200 animate-pulse dark:bg-gray-700 w-14 h-5" />
        <span className="px-2 py-0.5 text-xs rounded-full bg-gray-200 animate-pulse dark:bg-gray-700 w-14 h-5" />
      </div>
    );
  };

  const renderDigest = (tag: Tag) => {
    if (!tag.digest || tag.digest === 'Loading...') {
      return (
        <span className="block w-28 h-5 bg-gray-200 rounded animate-pulse dark:bg-gray-700" />
      );
    }
    
    if (tag.digestError || tag.digest === 'Failed to load digest' || tag.digest === 'Error loading digest') {
      return (
        <div className="flex items-center">
          <span className="text-red-500 dark:text-red-400">Failed to load digest</span>
          {onRetry && renderRetryButton(tag.name)}
        </div>
      );
    }
    
    // Using the full digest for better searchability, but with styling to handle long content
    return (
      <div className="flex items-center w-full">
        <div 
          className="text-xs font-mono overflow-hidden text-ellipsis whitespace-nowrap flex-1 text-gray-800 dark:text-gray-200 pr-1"
          style={{ maxWidth: "calc(100% - 30px)" }}
          title={tag.digest}
        >
          {tag.digest}
        </div>
        
        <CopyButton
          text={tag.digest || ''}
          label="Copy digest to clipboard"
          size={16}
          className="ml-1 text-secondaryBlue dark:text-blue-400 flex-shrink-0"
        />
      </div>
    );
  };

  const renderSize = (tag: Tag) => {
    if (tag.size === undefined || tag.size === 0) {
      if (tag.digest === 'Loading...' || !tag.digest) {
        return <span className="block w-20 h-5 bg-gray-200 rounded animate-pulse dark:bg-gray-700" />;
      }
      return 'Unknown';
    }
    
    return formatSize(tag.size);
  };

  const renderArtifactType = (tag: Tag) => {
    const platformInfo = platformMap[tag.name];
    
    if (platformInfo === undefined) {
      return (
        <span className="block w-24 h-5 bg-gray-200 rounded animate-pulse dark:bg-gray-700" />
      );
    }
    
    const manifestMediaType = platformInfo.mediaType;
    const configMediaType = platformInfo.configMediaType;
    
    if (manifestMediaType || configMediaType) {
      const determineArtifactType = () => {
        if (configMediaType) {
          const configTypeMapping = getArtifactType(configMediaType);
          if (configTypeMapping !== 'Unknown') {
            return configTypeMapping;
          }
          
          if (configMediaType.includes('container.image') || 
              configMediaType.includes('docker.container')) {
            return "Container Image";
          }
          
          if (configMediaType.includes('helm')) return "Helm Chart";
          if (configMediaType.includes('cosign')) return "Cosign Signature";
          if (configMediaType.includes('notary')) return "Notary Signature";
          if (configMediaType.includes('wasm')) return "WebAssembly Module";
          
          const typeParts = configMediaType.split('.');
          if (typeParts.length >= 2) {
            const typeName = typeParts[typeParts.length - 2];
            return typeName.charAt(0).toUpperCase() + typeName.slice(1);
          }
        }
        
        if (manifestMediaType) {
          const manifestTypeMapping = getArtifactType(manifestMediaType);
          if (manifestTypeMapping !== 'Unknown') {
            return manifestTypeMapping;
          }
          
          if (manifestMediaType.includes("oci.image.manifest") && !configMediaType) {
            return "OCI Image";
          }
          
          if (manifestMediaType.includes("docker.distribution.manifest")) {
            if (manifestMediaType.includes("list")) {
              return "Docker Manifest List";
            }
            return "Docker Manifest";
          }
          
          if (manifestMediaType.includes("manifest.list")) return "Manifest List";
          if (manifestMediaType.includes("manifest")) return "Manifest";
          if (manifestMediaType.includes("index")) return "Image Index";
          
          const manifestTypeParts = manifestMediaType.split('.');
          if (manifestTypeParts.length >= 2) {
            const typeName = manifestTypeParts[manifestTypeParts.length - 2];
            return typeName.charAt(0).toUpperCase() + typeName.slice(1);
          }
        }
        
        return "Unknown";
      };
      
      const artifactType = determineArtifactType();
      
      if (artifactType === 'Unknown') {
        return (
          <span className="text-gray-400 italic">Unknown</span>
        );
      }
      
      return artifactType;
    }
    
    return (
      <span className="text-gray-400 italic">Unknown</span>
    );
  };

  const renderEolWarning = (tagName: string) => {
    const lifecycleInfo = lifecycleInfoMap[tagName];
    if (!lifecycleInfo || !lifecycleInfo.eolDate || !lifecycleInfo.eolStatus) return null;
    
    const tooltipMessage = getEolMessage(lifecycleInfo);
    
    // Determine color based on EOL status
    const colorClasses = {
      expired: 'text-red-500',
      warning: 'text-yellow-500',
      upcoming: 'text-green-500'
    };
    
    const iconColor = colorClasses[lifecycleInfo.eolStatus];
    
    // Use different icons based on status
    if (lifecycleInfo.eolStatus === 'expired') {
      // Warning triangle for expired
      return (
        <Tooltip content={tooltipMessage}>
          <svg
            className={`ml-2 w-5 h-5 ${iconColor} inline-block flex-shrink-0`}
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
      );
    } else {
      // Clock icon for warning and upcoming
      return (
        <Tooltip content={tooltipMessage}>
          <svg
            className={`ml-2 w-5 h-5 ${iconColor} inline-block flex-shrink-0`}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </Tooltip>
      );
    }
  };

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col className="w-[25%] min-w-[180px]" />
          <col className="w-[20%] min-w-[160px] hidden md:table-column" />
          <col className="w-[30%] min-w-[180px]" />
          <col className="w-[15%] min-w-[120px]" />
          <col className="w-[10%] min-w-[80px]" />
        </colgroup>
        <thead>
          <tr className="bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700">
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-200">Tag</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-200 hidden md:table-cell">Artifact Type</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-200">Digest</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-200">Platform</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-200">Size</th>
          </tr>
        </thead>
        <tbody>
          {tags.length === 0 ? (
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                No tags found
              </td>
            </tr>
          ) : (
            tags.map((tag) => (
              <tr 
                key={tag.name} 
                className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-800/80 transition-colors"
              >
                <td className="px-4 py-3 text-sm text-gray-800 dark:text-gray-200 font-medium">
                  <div className="flex items-center whitespace-nowrap">
                    {renderEolWarning(tag.name)}
                    <div className="overflow-hidden text-ellipsis ml-1">
                      <Link 
                        href={{
                          pathname: `/registry/${encodeURIComponent(repositoryName)}/tags/${encodeURIComponent(tag.name)}`,
                          query: {
                            ...(platformMap[tag.name] ? {
                              architecture: platformMap[tag.name].architecture,
                              os: platformMap[tag.name].os
                            } : {}),
                            ...(tag.digest && tag.digest !== 'Loading...' && !tag.digestError ? {
                              digest: tag.digest
                            } : {})
                          }
                        }}
                        className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline truncate"
                        title={tag.name}
                      >
                        {tag.name}
                      </Link>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hidden md:table-cell overflow-hidden">
                  <div className="truncate" title={typeof renderArtifactType(tag) === 'string' ? renderArtifactType(tag).toString() : ''}>
                    {renderArtifactType(tag)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {renderDigest(tag)}
                </td>
                <td className="px-4 py-3.5">
                  {renderPlatformInfo(tag)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                  {renderSize(tag)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
} 