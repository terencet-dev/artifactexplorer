'use client';

import React, { useState, useEffect } from 'react';
import { Registry } from '@/app/types/registry';
import { useRouter } from 'next/navigation';
import registryService from '@/app/services/registryService';
import { REGISTRY_EVENTS } from '@/app/utils/constants';
import { useRepositoryContext } from '@/app/contexts/RepositoryContext';
import { STORAGE_KEYS } from '@/app/utils/constants';

interface RegistryCardProps {
  registry: Registry;
  highlightTerm?: string;
  tagCount?: number;
}

// Simple highlight component
const Highlight = ({ text = '', highlight = '' }) => {
  if (!highlight.trim()) {
    return <span>{text}</span>;
  }
  
  const regex = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  
  return (
    <span>
      {parts.map((part, i) => 
        regex.test(part) ? 
          <span key={i} className="bg-amber-100 dark:bg-amber-600/40 text-amber-900 dark:text-amber-50 px-0.5 rounded">{part}</span> : 
          <span key={i}>{part}</span>
      )}
    </span>
  );
};

const RegistryCard: React.FC<RegistryCardProps> = ({ registry, highlightTerm = '', tagCount }) => {
  const router = useRouter();
  const [count, setCount] = useState<number | null>(tagCount !== undefined ? tagCount : null);
  const [isLoading, setIsLoading] = useState<boolean>(tagCount === undefined ? true : false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Get context methods for registry filtering
  const { } = useRepositoryContext();

  useEffect(() => {
    // If tagCount is explicitly provided, use it and skip API calls
    if (tagCount !== undefined) {
      setCount(tagCount);
      setIsLoading(false);
      setErrorMsg(null);
      return;
    }

    // For cases where we need to fetch the count
    const loadCount = async () => {
      try {
        setIsLoading(true);
        
        // For authenticated registries, don't try to get repository counts directly
        // They typically require auth and will return 401
        if (registry.type === 'authenticated') {
          setCount(null);
          setErrorMsg('Authentication required');
          setIsLoading(false);
          return;
        }
        
        // Only fetch repositories for anonymous registries
        const response = await registryService.getRepositories(registry);
        
        if (response && response.repositories && Array.isArray(response.repositories)) {
          // Successfully got repositories
          setCount(response.repositories.length);
          setErrorMsg(null);
        } else {
          // Invalid response format
          console.error(`Invalid response format for ${registry.server}:`, response);
          setCount(0);
          setErrorMsg('Could not load repositories');
        }
      } catch (error) {
        console.error(`Error loading repository count for ${registry.server}:`, error);
        
        // Check if it's a 401 Unauthorized error
        const is401Error = error instanceof Error && 
          (error.message.includes('401') || 
           error.message.toLowerCase().includes('unauthorized'));
        
        if (is401Error) {
          // For auth errors, don't show a count of 0
          setCount(null);
          setErrorMsg('Authentication required');
        } else {
          // For other errors
          setCount(0);
          setErrorMsg('Could not load repositories');
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadCount();
  }, [registry, tagCount]);

  const handleCardClick = () => {
    // Store the current registry ID in localStorage to prevent UI sync issues
    if (registry.id) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_REGISTRY_ID, registry.id);
    }
    
    // Set current registry in service and update mode to 'current'
    registryService.setCurrentRegistry(registry.id || '');
    localStorage.setItem('allReposMode', 'current');
    
    // Only navigate to the specific registry page if not already there
    const pathname = window.location.pathname;
    if (pathname !== '/registry') {
      router.push(`/registry/${registry.id}`);
    }
    
    // Dispatch an event to notify other components about the registry change
    // Include forceUIUpdate flag to ensure all components reflect the change
    const event = new CustomEvent(REGISTRY_EVENTS.REGISTRY_CHANGED, {
      detail: {
        newRegistryId: registry.id,
        forceUIUpdate: true
      }
    });
    window.dispatchEvent(event);
  };

  return (
    <div 
      className="p-5 bg-white dark:bg-slate-800 rounded-lg shadow-sm hover:shadow-md transition duration-200 border border-gray-200 dark:border-gray-700 cursor-pointer"
      onClick={handleCardClick}
    >
      <div className="flex flex-col">
        <div className="flex justify-between items-start">
          <div className="flex-grow">
            <h3 className="text-lg font-semibold mb-1 text-gray-900 dark:text-white">
              <Highlight 
                text={registry.server} 
                highlight={highlightTerm} 
              />
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {registry.type === 'authenticated' ? 'Authenticated' : 'Anonymous'} Registry
            </p>
          </div>
          <div className="ml-4 flex-shrink-0 text-right">
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {tagCount !== undefined ? (
                // If tagCount is explicitly provided from parent, always use it regardless of loading state
                `${tagCount} ${tagCount === 1 ? 'Repository' : 'Repositories'}`
              ) : isLoading ? (
                "Fetching count..."
              ) : count !== null ? (
                // If we have a count from our own fetch, show it
                `${count} ${count === 1 ? 'Repository' : 'Repositories'}`
              ) : registry.type === 'authenticated' ? (
                // For authenticated registries without a count, show browse message
                <span className="text-blue-600 dark:text-blue-400">Browse Repositories</span>
              ) : errorMsg ? (
                // For other error messages
                <span className="text-gray-500 dark:text-gray-400">{errorMsg}</span>
              ) : (
                "" // Fallback empty string
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegistryCard; 