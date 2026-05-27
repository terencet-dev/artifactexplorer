/**
 * Safe localStorage utilities with type safety and SSR compatibility
 */

// Type guard to check if we're in a browser environment
export const isBrowser = (): boolean => typeof window !== 'undefined';

/**
 * Get an item from localStorage with proper type casting
 */
export function getStorageItem<T>(key: string): T | null {
  if (!isBrowser()) return null;
  
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) as T : null;
  } catch (error) {
    console.error(`Error getting item from localStorage: ${key}`, error);
    return null;
  }
}

/**
 * Set an item in localStorage with error handling
 */
export function setStorageItem<T>(key: string, value: T): boolean {
  if (!isBrowser()) return false;
  
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Error setting item in localStorage: ${key}`, error);
    return false;
  }
}

/**
 * Remove an item from localStorage
 */
export function removeStorageItem(key: string): boolean {
  if (!isBrowser()) return false;
  
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error(`Error removing item from localStorage: ${key}`, error);
    return false;
  }
}

/**
 * Clear all items from localStorage matching a prefix
 */
export function clearStorageItemsByPrefix(prefix: string): boolean {
  if (!isBrowser()) return false;
  
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
    return true;
  } catch (error) {
    console.error(`Error clearing items with prefix: ${prefix}`, error);
    return false;
  }
} 