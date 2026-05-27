'use client';

import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import registryService, { RegistryChangedEventDetail } from '@/app/services/registryService';
import { SESSION_DURATION_MS, STORAGE_KEYS, REGISTRY_EVENTS } from '@/app/utils/constants';

export default function SessionManager() {
  const router = useRouter();

  const handleRegistryChanged = useCallback((event: CustomEvent<RegistryChangedEventDetail>) => {
    // Check if this was the last registry removed
    if (event.detail?.lastRegistryRemoved) {
      // Redirect to home page when the last registry is removed
      router.push('/');
    }
  }, [router]);

  useEffect(() => {
    // Add listener for registry changed events
    window.addEventListener(REGISTRY_EVENTS.REGISTRY_CHANGED, handleRegistryChanged as EventListener);

    return () => {
      window.removeEventListener(REGISTRY_EVENTS.REGISTRY_CHANGED, handleRegistryChanged as EventListener);
    };
  }, [handleRegistryChanged]);

  useEffect(() => {
    // Check if this is a new session
    const handleNewSession = () => {
      const lastActive = localStorage.getItem(STORAGE_KEYS.SESSION_LAST_ACTIVE);
      const currentTime = new Date().getTime();
      
      // If no last active time or session expired, clear registries
      if (!lastActive || (currentTime - parseInt(lastActive)) > SESSION_DURATION_MS) {
        console.log('Session expired or new session - clearing registry data');
        
        // Clear registries
        registryService.clearAllRegistries();
      }
      
      // Update last active time
      localStorage.setItem(STORAGE_KEYS.SESSION_LAST_ACTIVE, currentTime.toString());
    };
    
    // Check on initial load
    handleNewSession();
    
    // Also set up event listener for visibility changes
    // This helps detect when user comes back to the app after some time
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleNewSession();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [router]);
  
  // This component doesn't render anything visible
  return null;
} 