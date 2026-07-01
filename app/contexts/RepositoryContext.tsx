'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Repository, Registry } from '@/app/types/registry';
import registryService from '@/app/services/registryService';
import { devLog } from '../utils/devLog';

interface RepositoryContextType {
  repositories: Repository[];
  registries: Registry[];
  isLoading: boolean;
  searchQuery: string;
  viewMode: 'current' | 'all';
  searchType: 'all' | 'repository' | 'registry';
  registryRepoCounts: Record<string, number>;
  currentPage: number;
  setRepositories: (repos: Repository[]) => void;
  setRegistries: (registries: Registry[]) => void;
  setIsLoading: (loading: boolean) => void;
  setSearchQuery: (query: string) => void;
  setViewMode: (mode: 'current' | 'all') => void;
  setSearchType: (type: 'all' | 'repository' | 'registry') => void;
  setRegistryRepoCounts: (counts: Record<string, number>) => void;
  setCurrentPage: (page: number) => void;
  clearRepositoryState: () => void;
  error: string | null;
  setError: (error: string | null) => void;
  lastUpdated: number | null;
  registryFilter: string | null;
  setRegistryFilter: (filter: string | null) => void;
  // Debug methods - development only
  debugReset?: () => void;
  debugInspect?: () => any;
}

const defaultState: RepositoryContextType = {
  repositories: [],
  registries: [],
  isLoading: true,
  searchQuery: '',
  viewMode: 'current',
  searchType: 'all',
  registryRepoCounts: {},
  currentPage: 1,
  setRepositories: () => {},
  setRegistries: () => {},
  setIsLoading: () => {},
  setSearchQuery: () => {},
  setViewMode: () => {},
  setSearchType: () => {},
  setRegistryRepoCounts: () => {},
  setCurrentPage: () => {},
  clearRepositoryState: () => {},
  error: null,
  setError: () => {},
  lastUpdated: null,
  registryFilter: null,
  setRegistryFilter: () => {},
};

const RepositoryContext = createContext<RepositoryContextType>(defaultState);

export function useRepositoryContext() {
  return useContext(RepositoryContext);
}

export const RepositoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [registries, setRegistries] = useState<Registry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'all' | 'current'>('current');
  const [searchType, setSearchType] = useState<'all' | 'repository' | 'registry'>('all');
  const [registryRepoCounts, setRegistryRepoCounts] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [registryFilter, setRegistryFilter] = useState<string | null>(null);
  
  // Debug method to inspect the current state
  const debugInspect = useCallback(() => {
    if (process.env.NODE_ENV !== 'development') return null;
    
    devLog('Repository Context State:');
    devLog('- Repositories:', repositories.length);
    devLog('- Error:', error);
    devLog('- Last Updated:', lastUpdated ? new Date(lastUpdated).toISOString() : null);
    devLog('- Registry Filter:', registryFilter);
    
    return {
      repositories,
      error,
      lastUpdated,
      registryFilter
    };
  }, [repositories, error, lastUpdated, registryFilter]);
  
  // Method to clear state
  const clearRepositoryState = useCallback(() => {
    if (process.env.NODE_ENV === 'development') {
      devLog('Clearing repository context state');
    }
    
    setRepositories([]);
    setRegistries([]);
    setIsLoading(true);
    setSearchQuery('');
    setViewMode('current');
    setSearchType('all');
    setRegistryRepoCounts({});
    setCurrentPage(1);
    setError(null);
    setLastUpdated(null);
    setRegistryFilter(null);
  }, []);
  
  // Debug methods - only active in development
  const debugReset = useCallback(() => {
    if (process.env.NODE_ENV !== 'development') return;
    
    devLog('Debug: Resetting repository context');
    clearRepositoryState();
    
    // Clear repository cache from window object if it exists
    if (typeof window !== 'undefined') {
      if ((window as any).__repositoryCache) {
        devLog('Debug: Clearing repository cache');
        (window as any).__repositoryCache.clear();
      }
      
      if ((window as any).__emptyResponseRegistries) {
        devLog('Debug: Clearing empty response registries');
        (window as any).__emptyResponseRegistries.clear();
      }
    }
  }, [clearRepositoryState]);
  
  // Initialize state from local storage if available
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        // Only initialize if repositories are empty
        if (repositories.length === 0) {
          // Check both localStorage keys for view mode - prioritize allReposMode for consistency
          const storedMode = localStorage.getItem('allReposMode') || localStorage.getItem('viewMode');
          if (storedMode === 'all' || storedMode === 'current') {
            setViewMode(storedMode as 'all' | 'current');
            // Make sure both localStorage keys are in sync
            localStorage.setItem('allReposMode', storedMode);
            localStorage.setItem('viewMode', storedMode);
          }
          
          // Add global debug/reset method for context
          (window as any).__resetRepositoryContext = debugReset;
          
          // Add global debug method to inspect context state
          (window as any).__getRepositoryContextState = debugInspect;
        }
      } catch (error) {
        console.error('Error initializing from localStorage:', error);
      }
    }
  }, [repositories.length, debugReset, debugInspect]);

  // Override setViewMode to ensure localStorage stays in sync
  const setViewModeWithStorage = useCallback((mode: 'current' | 'all') => {
    setViewMode(mode);
    // Keep both localStorage keys in sync
    if (typeof window !== 'undefined') {
      localStorage.setItem('allReposMode', mode);
      localStorage.setItem('viewMode', mode);
    }
  }, []);

  useEffect(() => {
    // Set last updated timestamp whenever repositories are updated
    if (repositories.length > 0) {
      setLastUpdated(Date.now());
    }
  }, [repositories]);

  const value = {
    repositories,
    registries,
    isLoading,
    searchQuery,
    viewMode,
    searchType,
    registryRepoCounts,
    currentPage,
    setRepositories,
    setRegistries,
    setIsLoading,
    setSearchQuery,
    setViewMode: setViewModeWithStorage,
    setSearchType,
    setRegistryRepoCounts,
    setCurrentPage,
    clearRepositoryState,
    error,
    setError,
    lastUpdated, 
    registryFilter,
    setRegistryFilter,
    // Add debug methods in development only
    ...(process.env.NODE_ENV === 'development' ? { debugReset, debugInspect } : {})
  };

  return (
    <RepositoryContext.Provider value={value}>
      {children}
    </RepositoryContext.Provider>
  );
}; 
