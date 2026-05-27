'use client';

import { useState, useEffect, useCallback, memo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import registryService, { RegistryChangedEventDetail } from '@/app/services/registryService';
import { Registry } from '@/app/types/registry';
import ConfirmationModal from './ConfirmationModal';
import { REGISTRY_EVENTS, STORAGE_KEYS } from '@/app/utils/constants';
import { useRepositoryContext } from '@/app/contexts/RepositoryContext';

const RegistryManager = memo(function RegistryManager() {
  const router = useRouter();
  const [registries, setRegistries] = useState<Registry[]>([]);
  const [currentRegistry, setCurrentRegistry] = useState<Registry | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [modalState, setModalState] = useState({
    isOpen: false,
    registryId: '',
    registryServer: ''
  });
  
  // Create ref for the dropdown container
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Get context methods for registry filtering
  const { setRegistryFilter, setViewMode } = useRepositoryContext();

  // Handle click outside of dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    
    // Add event listener when dropdown is open
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    // Clean up event listener
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown]);

  const loadRegistries = useCallback(() => {
    const allRegistries = registryService.getAllRegistries();
    const current = registryService.getCurrentRegistry();
    setRegistries(allRegistries);
    setCurrentRegistry(current);
  }, []);

  // Load registries on component mount
  useEffect(() => {
    loadRegistries();
    // Note: We need loadRegistries as a dependency here
  }, [loadRegistries]);

  // Add an event listener for registry changes
  useEffect(() => {
    const handleRegistryChange = (event: CustomEvent) => {
      const detail = event.detail as RegistryChangedEventDetail;
      
      // Check if this event has the forceUIUpdate flag
      if (detail?.forceUIUpdate) {
        console.log('Received registry changed event with forceUIUpdate flag');
        // Update UI immediately
        const registryId = detail.newRegistryId || registryService.getCurrentRegistryId();
        if (registryId) {
          // Find the corresponding registry in our list
          const foundRegistry = registries.find(r => r.id === registryId);
          if (foundRegistry) {
            setCurrentRegistry(foundRegistry);
            console.log(`Updated UI to show registry: ${foundRegistry.server}`);
          }
        }
      } else if (detail?.lastRegistryRemoved) {
        // If the last registry was removed, handle it
        router.push('/');
      } else {
        // Normal registry change, update our UI by loading fresh data
        loadRegistries();
      }
    };
    
    window.addEventListener(REGISTRY_EVENTS.REGISTRY_CHANGED, handleRegistryChange as EventListener);
    
    return () => {
      window.removeEventListener(REGISTRY_EVENTS.REGISTRY_CHANGED, handleRegistryChange as EventListener);
    };
  }, [registries, router, loadRegistries]);

  const handleSelectRegistry = useCallback((id: string) => {
    // First update the UI state - this helps prevent flickering
    const registry = registries.find(r => r.id === id);
    if (!registry) {
      console.error(`[RegistryManager] Registry with ID ${id} not found`);
      return;
    }
    
    // Immediately update the UI state first to reduce flickering
    setCurrentRegistry(registry);
    setShowDropdown(false);
    
    console.log('[RegistryManager] Selecting registry from dropdown - forcing individual view mode');
    
    // IMPORTANT: Always set to "current" mode (individual registry view) when selecting a specific registry
    setViewMode('current');
    setRegistryFilter(id);
    
    // Now set the registry in localStorage and perform the backend changes
    localStorage.setItem(STORAGE_KEYS.CURRENT_REGISTRY_ID, id);
    
    // Update localStorage to maintain consistency
    localStorage.setItem('viewMode', 'current');
    localStorage.setItem('allReposMode', 'false');
    
    // Set a flag to indicate this was selected from dropdown
    if (typeof window !== 'undefined') {
      (window as any).__selectedFromDropdown = true;
      (window as any).__isViewModeChange = false; // Ensure we don't treat this as a view mode change
      (window as any).__lastViewModeOverride = Date.now(); // Track when this happened
    }
    
    // Dispatch registry-changed event to ensure all components are updated
    const event = new CustomEvent(REGISTRY_EVENTS.REGISTRY_CHANGED, {
      detail: { 
        registry: id,
        previousRegistry: registryService.getCurrentRegistryId(),
        registryChanged: true,
        selectedFromDropdown: true,
        viewMode: 'current', // Add explicit viewMode to event
        timestamp: Date.now() // Add timestamp for ordering
      }
    });
    window.dispatchEvent(event);
    
    // Avoid navigation/page refresh if we're already on the registry page
    // This prevents the flickering issue
    const pathname = window.location.pathname;
    if (pathname !== '/registry') {
      router.push('/registry');
    }
    
    // Asynchronously test connection after UI is updated
    setTimeout(() => {
      registryService.setCurrentRegistry(id).catch(err => {
        console.error(`[RegistryManager] Error setting registry: ${err}`);
      });
    }, 0);
  }, [registries, router, setRegistryFilter, setViewMode]);

  const handleRemoveRegistry = useCallback((id: string, server: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Open the confirmation modal instead of using browser confirm
    setModalState({
      isOpen: true,
      registryId: id,
      registryServer: server
    });
  }, []);

  const confirmRemoveRegistry = useCallback(() => {
    const { registryId } = modalState;
    
    // Call the service to remove the registry
    registryService.removeRegistryNoReload(registryId);
    
    // Close the modal
    setModalState(prev => ({ ...prev, isOpen: false }));
    
    // Registry manager will be updated via the registry-changed event
  }, [modalState]);

  const closeModal = useCallback(() => {
    setModalState(prev => ({ ...prev, isOpen: false }));
  }, []);

  const toggleDropdown = useCallback(() => {
    setShowDropdown(prev => !prev);
  }, []);

  const navigateToConnect = useCallback(() => {
    router.push('/connect');
  }, [router]);

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <div className="flex w-full">
          <div className="relative w-full">
            <button
              onClick={toggleDropdown}
              className="px-5 py-3 bg-white dark:bg-slate-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 font-medium rounded-md text-sm transition duration-200 flex items-center justify-between w-full"
            >
              {currentRegistry ? (
                <div className="flex flex-col items-start overflow-hidden">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{registries.length > 1 ? 'Registries' : 'Registry'}</span>
                  <span className="text-sm font-medium truncate w-full max-w-[280px]">{currentRegistry.server}</span>
                </div>
              ) : (
                <span className="mr-1">Select {registries.length > 1 ? 'Registries' : 'Registry'}</span>
              )}
              <svg className="w-5 h-5 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </button>
            
            {showDropdown && (
              <div className="absolute right-0 z-50 mt-2 w-full min-w-[300px] max-w-md bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg">
                <ul className="py-2 max-h-80 overflow-y-auto">
                  {registries.map((registry) => (
                    <li 
                      key={registry.id} 
                      className={`relative flex items-center px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-700 cursor-pointer ${
                        currentRegistry?.id === registry.id ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                      }`}
                      onClick={() => handleSelectRegistry(registry.id!)}
                    >
                      <div className="w-full pr-10">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 block break-all">{registry.server}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 block">
                          {registry.type === 'authenticated' ? 'Authenticated' : 'Anonymous'}
                        </span>
                      </div>
                      <button
                        className="text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 focus:outline-none absolute right-4 top-1/2 -translate-y-1/2"
                        onClick={(e) => handleRemoveRegistry(registry.id!, registry.server, e)}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                      </button>
                    </li>
                  ))}
                  
                  <li className="border-t border-gray-200 dark:border-gray-700 mt-2 pt-2">
                    <button 
                      className="px-4 py-2 w-full text-left text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-slate-700 flex items-center"
                      onClick={navigateToConnect}
                    >
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                      </svg>
                      Add Registry
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <ConfirmationModal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        onConfirm={confirmRemoveRegistry}
        title="Remove Registry"
        message={`Are you sure you want to remove ${modalState.registryServer} from your registries?`}
        confirmText="Yes, Remove"
        cancelText="Cancel"
      />
    </>
  );
});

export default RegistryManager; 