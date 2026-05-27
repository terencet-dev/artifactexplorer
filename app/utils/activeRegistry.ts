import { Registry } from '@/app/types/registry';

/**
 * Get the active registry from local storage
 */
export function getActiveRegistry(): Registry | null {
  if (typeof window === 'undefined') {
    return null;
  }
  
  try {
    const activeRegistryString = localStorage.getItem('activeRegistry');
    if (!activeRegistryString) {
      return null;
    }
    
    const registry = JSON.parse(activeRegistryString) as Registry;
    return registry;
  } catch (error) {
    console.error('Error getting active registry from storage:', error);
    return null;
  }
} 