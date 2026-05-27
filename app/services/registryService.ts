'use client';

import {
  Registry,
  CatalogResponse,
  TagsResponse,
  ManifestResponse,
  Tag,
  Repository,
  AuthenticatedRegistry,
  RepositoriesResponse,
} from '@/app/types/registry';
import { 
  STORAGE_KEYS, 
  REGISTRY_API_ENDPOINT, 
  REGISTRY_API_VERSION,
  DEFAULT_PAGE_SIZE,
  REGISTRY_EVENTS
} from '@/app/utils/constants';
import { clearStorageItemsByPrefix, removeStorageItem, getStorageItem, setStorageItem } from '../utils/storage';
import { AppError, logError } from '../utils/error';

// Import the credential store
import { getCredential } from '@/app/utils/credentialStore';
import { getAuthHeaders } from '@/app/utils/registry';
import { isAuthenticatedRegistry } from '@/app/utils/registryUtils';
import { getCredentialById } from '@/app/utils/credentialStore';
import { 
  debugCredentialStore,
  clearCredential,
  clearAllCredentials,
  storeCredential,
  debugAllCredentials
} from '@/app/utils/credentialStore';
import { devLog } from '../utils/devLog';

// Define type for registry changed event details
export interface RegistryChangedEventDetail {
  lastRegistryRemoved?: boolean;
  forceUIUpdate?: boolean;
  newRegistryId?: string;
  registry?: string;
  previousRegistry?: string | null;
  registryChanged?: boolean;
  selectedFromCard?: boolean;
  selectedFromDropdown?: boolean;
  viewMode?: 'all' | 'current';
  viewModeChanged?: boolean;
  forceReload?: boolean;
}

// Generate a unique ID for registry
const generateRegistryId = (): string => 
  `registry-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// Helper to create a registry without password
function removePasswordFromRegistry(registry: Registry): Registry {
  if (isAuthenticatedRegistry(registry)) {
    const { password, username, ...rest } = registry;
    return { ...rest, type: 'authenticated' } as Registry; // TypeScript needs this cast
  }
  return registry;
}

// Helper function to handle API requests with retries
async function fetchWithRetry<T>(
  url: string, 
  options: RequestInit, 
  retries = 2,
  retryDelay = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        devLog(`Retry attempt ${attempt}/${retries} for ${url}`);
      }
      
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error ${response.status}: ${errorText}`);
      }
      
      return await response.json() as T;
    } catch (error) {
      console.error(`Request failed (attempt ${attempt + 1}/${retries + 1}):`, error);
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < retries) {
        // Wait before retrying with exponential backoff
        await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
      }
    }
  }
  
  throw lastError || new Error(`Failed to fetch ${url} after ${retries + 1} attempts`);
}

// Set cache expiration time (5 minutes for authenticated, 30 minutes for anonymous)
const CACHE_EXPIRATION = {
  AUTHENTICATED: 15 * 60 * 1000, // 15 minutes (increased from 5 minutes)
  ANONYMOUS: 30 * 60 * 1000     // 30 minutes
};

// Track recent API calls to prevent redundant requests
const recentApiCalls = new Map<string, number>();
// Throttle time - don't repeat the same call within this timeframe
const API_THROTTLE_MS = 10000; // 10 seconds

// Negative cache — remember registries that recently failed to prevent retry storms
const failedRegistryCache = new Map<string, { timestamp: number; error: string }>();
const NEGATIVE_CACHE_MS = 60_000; // don't retry a failed registry for 60 seconds

class RegistryService {
  private getAuthorizationHeader(registry: Registry): string | null {
    if (registry.type === 'authenticated') {
      // Ensure we have a registry ID to use for credential lookup
      const registryId = registry.id || registry.server;
      
      if (registryId) {
        try {
          // Get credentials from credential store
          const credentials = getCredentialById(registryId);
          
          if (credentials && credentials.username && credentials.password) {
            devLog(`[RegistryService] Found credentials for ${registryId}`);
            const auth = btoa(`${credentials.username}:${credentials.password}`);
            return `Basic ${auth}`;
          }
        } catch (error) {
          console.error(`[RegistryService] Error retrieving credentials:`, error);
        }
      }
      
      // Fallback to registry object if available
      if ((registry as AuthenticatedRegistry).username && (registry as AuthenticatedRegistry).password) {
        const auth = btoa(`${(registry as AuthenticatedRegistry).username}:${(registry as AuthenticatedRegistry).password}`);
        return `Basic ${auth}`;
      }
    }
    return null;
  }

  /**
   * Resolve credentials for an authenticated registry.
   * Checks the registry object first, then falls back to the credential store.
   * Mutates the registry parameter to attach credentials if found.
   * Returns true if credentials were resolved, false otherwise.
   */
  private resolveCredentials(registry: Registry, callerName: string): boolean {
    if (registry.type !== 'authenticated') return true; // No credentials needed

    // If registry already has direct credentials, nothing to do
    const authRegistry = registry as AuthenticatedRegistry;
    if (authRegistry.username && authRegistry.password) {
      devLog(`[RegistryService] ${callerName}: Registry has direct credentials`);
      return true;
    }

    // Use server name as fallback ID if registry ID is missing
    const registryId = registry.id || registry.server;

    if (!registryId) {
      console.error(`[RegistryService] ${callerName}: Authenticated registry has no ID or server name`);
      return false;
    }

    try {
      devLog(`[RegistryService] ${callerName}: Resolving credentials for ${registry.server} (ID: ${registryId})`);

      // Try the registry ID first
      let credentials = getCredentialById(registryId);

      // If not found and ID differs from server, try server URL
      if (!credentials && registryId !== registry.server) {
        devLog(`[RegistryService] ${callerName}: No credentials for ID ${registryId}, trying server URL ${registry.server}`);
        credentials = getCredentialById(registry.server);
      }

      if (credentials && credentials.username && credentials.password) {
        devLog(`[RegistryService] ${callerName}: Credentials resolved for ${registry.server}`);
        (registry as AuthenticatedRegistry).username = credentials.username;
        (registry as AuthenticatedRegistry).password = credentials.password;
        return true;
      }

      console.warn(`[RegistryService] ${callerName}: No valid credentials found for ${registry.server} (ID: ${registryId})`);
      return false;
    } catch (error: any) {
      console.error(`[RegistryService] ${callerName}: Error resolving credentials:`, error?.message || error);
      return false;
    }
  }

  private async fetchWithProxy(url: string, registry: Registry, method: string = 'GET', headers: Record<string, string> = {}, signal?: AbortSignal): Promise<any> {
    // Add default Accept header if not set
    if (!headers['Accept']) {
      headers['Accept'] = 'application/json';
    }

    // Create request body
    const requestBody: any = {
      url,
      method,
      registry: registry.server,
      headers,
    };

    // Include authentication information for server-side use
    if (registry.type === 'authenticated') {
      // Ensure we have a registry ID to use for credential lookup
      // If id is missing, fall back to server URL as the ID
      const registryId = registry.id || registry.server;
      
      if (!registryId) {
        console.error(`[RegistryService] fetchWithProxy: Authenticated registry missing both ID and server URL`);
        throw new Error('Cannot authenticate - missing registry identification');
      }
      
      // For authenticated registries, set up the auth object
      const authObj: any = { 
        registryType: 'authenticated',
        // For token-based registries like ACR, indicate that token auth is needed
        needsTokenAuth: true 
      };
      
      // Include registry ID for credential lookup
      authObj.registryId = registryId;
      // Also include the registry server URL for fallback credential lookup
      authObj.registry = registry.server;
      devLog(`[RegistryService] fetchWithProxy: Including registryId ${registryId} in auth object`);
      
      // ALWAYS include direct credentials from registry object if available
      // This is crucial for ensuring authentication works reliably
      const authRegistry = registry as AuthenticatedRegistry;
      if (authRegistry.username && authRegistry.password) {
        devLog(`[RegistryService] fetchWithProxy: Including direct credentials from registry object`);
        authObj.credentials = {
          username: authRegistry.username,
          password: authRegistry.password
        };
      }
      
      // Check if credentials exist in the store
      let credentialsExist = false;
      try {
        // Use imported functions directly
        devLog(`[RegistryService] fetchWithProxy: Verifying credentials for ${registryId}`);
        
        // Debug current state of credential store
        debugCredentialStore();
        
        // Try both the registry ID and server URL as fallback
        let credentials = getCredentialById(registryId);
        
        // If no credentials found and registryId isn't the same as server, try server URL
        if (!credentials && registryId !== registry.server) {
          devLog(`[RegistryService] fetchWithProxy: No credentials found for ID ${registryId}, trying server URL ${registry.server}`);
          credentials = getCredentialById(registry.server);
          
          // If found with server URL, update the registryId in the auth object
          if (credentials) {
            devLog(`[RegistryService] fetchWithProxy: Found credentials using server URL instead of ID`);
            authObj.registryId = registry.server;
          }
        }
        
        credentialsExist = !!(credentials && credentials.username && credentials.password);
        devLog(`[RegistryService] fetchWithProxy: Credential check for ${registryId}: ${credentialsExist ? '✅ FOUND' : '❌ NOT FOUND'}`);
        
        if (credentialsExist && credentials) {
          devLog(`[RegistryService] fetchWithProxy: Valid credentials found for ${registryId}, username: ${credentials.username}`);
        }
      } catch (error: any) {
        console.error('[RegistryService] fetchWithProxy: Error checking credentials:', error?.message || error);
      }
      
      // Add the auth object to the request body
      requestBody.auth = authObj;
    }

    try {
      if (process.env.NODE_ENV === 'development') {
        devLog(`Sending ${method} request to ${url.split('?')[0]}`);
        if (registry.type === 'authenticated') {
          devLog(`Request for authenticated registry: ${registry.server} (ID: ${registry.id || 'unknown'})`);
          devLog(`Authorization header present: ${!!headers['Authorization']}`);
          devLog(`Auth object in request: ${JSON.stringify(requestBody.auth, (key, value) => 
            key === 'credentials' && value ? { ...value, password: '***' } : value
          )}`);
        }
      }
      
      const response = await fetch(REGISTRY_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: errorText };
        }
        
        // Log detailed error for debugging
        console.error(`Registry request failed:`, {
          status: response.status,
          url: url.split('?')[0], // Don't log query params
          errorData,
          registryType: registry.type,
          registryId: registry.id,
          headers: Object.keys(headers),
          authHeaderPresent: !!headers['Authorization']
        });
        
        throw new Error(`Registry request failed: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      // Rethrow the error to be handled by the calling method
      console.error(`Error in fetchWithProxy for ${url.split('?')[0]}:`, error);
      throw error;
    }
  }

  private isRequestThrottled(registry: Registry, endpoint: string): boolean {
    if (!registry || !endpoint) return false;
    
    // Create a unique key for this registry + endpoint combination
    const throttleKey = `${registry.server}:${registry.id || ''}:${endpoint}`;
    
    // Check if we've made this request recently
    const lastRequestTime = recentApiCalls.get(throttleKey);
    if (lastRequestTime) {
      const timeSinceLastRequest = Date.now() - lastRequestTime;
      
      // For authenticated registries, apply throttling more aggressively
      if (registry.type === 'authenticated' && timeSinceLastRequest < API_THROTTLE_MS) {
        devLog(`[RegistryService] Throttling request to ${endpoint} for ${registry.server} (${timeSinceLastRequest}ms since last request)`);
        return true;
      }
    }
    
    // Update the last request time
    recentApiCalls.set(throttleKey, Date.now());
    
    // Clean up old entries to prevent memory leaks
    if (recentApiCalls.size > 100) {
      // Keep only the 50 most recent entries
      const entries = Array.from(recentApiCalls.entries());
      entries.sort((a, b) => b[1] - a[1]); // Sort by timestamp (newest first)
      
      recentApiCalls.clear();
      entries.slice(0, 50).forEach(([key, value]) => {
        recentApiCalls.set(key, value);
      });
    }
    
    return false;
  }

  async getCatalog(registry: Registry, pageSize: number = 20, page: number = 1): Promise<CatalogResponse> {
    try {
      // --- Negative cache: skip registries that recently failed ---
      const negKey = `catalog-fail-${registry.server}`;
      const negEntry = failedRegistryCache.get(negKey);
      if (negEntry && Date.now() - negEntry.timestamp < NEGATIVE_CACHE_MS) {
        devLog(`[RegistryService] Skipping ${registry.server} catalog — recently failed (${negEntry.error}). Retry in ${Math.ceil((NEGATIVE_CACHE_MS - (Date.now() - negEntry.timestamp)) / 1000)}s`);
        return { repositories: [] };
      }

      // Create a cache key that includes page and pageSize
      const cacheKey = `catalog-${registry.server}-${pageSize}-${page}`;
      
      // Check if the request is being throttled (for authenticated registries)
      if (registry.type === 'authenticated' && this.isRequestThrottled(registry, '_catalog')) {
        devLog(`[RegistryService] Request throttled for ${registry.server}, using cached data or returning empty result`);
        
        // Try to use cached data if available
        if (typeof window !== 'undefined') {
          const cachedData = sessionStorage.getItem(cacheKey);
          if (cachedData) {
            try {
              const parsed = JSON.parse(cachedData);
              devLog(`[RegistryService] Using cached catalog for throttled request to ${registry.server}`);
              return parsed.data;
            } catch (e) {
              console.error('[RegistryService] Error parsing cached catalog data for throttled request:', e);
            }
          }
        }
        
        // If no cache is available, return an empty result instead of making an API call
        return { repositories: [] };
      }
      
      // Determine cache expiration based on registry type
      const cacheExpiration = registry.type === 'anonymous' 
        ? CACHE_EXPIRATION.ANONYMOUS
        : CACHE_EXPIRATION.AUTHENTICATED;
      
      // Check if we have cached results
      if (typeof window !== 'undefined') {
        const cachedData = sessionStorage.getItem(cacheKey);
        if (cachedData) {
          try {
            const parsed = JSON.parse(cachedData);
            // Use cache based on registry type's expiration time
            if (parsed.timestamp && Date.now() - parsed.timestamp < cacheExpiration) {
              devLog(`Using cached catalog for ${registry.server} page ${page} (cache valid for ${Math.round((cacheExpiration)/60000)} minutes)`);
              return parsed.data;
            } else {
              devLog(`Cache expired for ${registry.server} catalog, fetching fresh data`);
            }
          } catch (e) {
            console.error('Error parsing cached catalog data:', e);
          }
        }
      }
      
      // Add debugging for authentication
      if (registry.type === 'authenticated') {
        devLog(`getCatalog: Using authenticated registry: ${registry.server}, registryId: ${registry.id || 'undefined'}`);
      }

      // Build headers with proper authentication
      let headers: Record<string, string> = {
        'Accept': 'application/json'
      };
      
      // Add appropriate authentication headers for authenticated registries
      if (registry.type === 'authenticated') {
        if (registry.id) {
          // First try to get credentials from credential store
          const credentials = getCredential(registry);
          if (credentials && credentials.username && credentials.password) {
            devLog(`getCatalog: Found credentials for registry ${registry.server}, using credential store`);
            // Use credential store values
            const auth = btoa(`${credentials.username}:${credentials.password}`);
            headers['Authorization'] = `Basic ${auth}`;
          } else {
            console.warn(`getCatalog: No credentials found in credential store for ${registry.server}`);
            
            // Fallback: try to use any credentials that might be on the registry object directly
            if ((registry as AuthenticatedRegistry).username && (registry as AuthenticatedRegistry).password) {
              devLog(`getCatalog: Using credentials from registry object for ${registry.server}`);
              const auth = btoa(`${(registry as AuthenticatedRegistry).username}:${(registry as AuthenticatedRegistry).password}`);
              headers['Authorization'] = `Basic ${auth}`;
            } else {
              console.warn(`getCatalog: No credentials available for authenticated registry ${registry.server}`);
            }
          }
        } else {
          console.warn(`getCatalog: Authenticated registry ${registry.server} missing ID, cannot retrieve credentials`);
        }
      }
      
      // OCI Distribution Spec pagination uses n for limit and last for the starting point
      // For pagination by page number, we need to compute the correct last value
      let url = `https://${registry.server}/v2/_catalog?n=${pageSize}`;
      
      // If not first page, add the last parameter
      if (page > 1) {
        // We need the last repository name from the previous page to paginate correctly
        // This is a simplified implementation - in real world scenarios you'd want to
        // properly track the last repository name from previous responses
        const lastItem = localStorage.getItem(`registry-${registry.server}-page-${page-1}-last`);
        if (lastItem) {
          url += `&last=${lastItem}`;
        } else {
          // If we don't have the last item, fall back to offset-based pagination
          // This might not work with all registries but is a reasonable fallback
          url += `&last=${(page - 1) * pageSize}`;
        }
      }
      
      devLog(`Fetching catalog from ${registry.server} (type: ${registry.type})`);
      
      const response = await this.fetchWithProxy(url, registry, 'GET', headers);
      
      // Store the last item name for future pagination if there are repositories
      if (response.repositories && response.repositories.length > 0) {
        localStorage.setItem(
          `registry-${registry.server}-page-${page}-last`, 
          response.repositories[response.repositories.length - 1]
        );
      }
      
      // Cache the results if we have a window object (client-side)
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({
            timestamp: Date.now(),
            data: response
          }));
          devLog(`Cached catalog for ${registry.server} page ${page}, expires in ${Math.round(cacheExpiration/60000)} minutes`);
        } catch (e) {
          console.error('Error caching catalog data:', e);
        }
      }
      
      return response;
    } catch (error) {
      console.error(`Failed to fetch catalog from ${registry.server}:`, error);
      // Negative cache: remember this failure to prevent retry storms
      const negKey = `catalog-fail-${registry.server}`;
      failedRegistryCache.set(negKey, {
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getTags(registry: Registry, repositoryName: string): Promise<TagsResponse> {
    try {
      devLog(`[RegistryService] getTags: Fetching tags for ${repositoryName} from ${registry.server} (type: ${registry.type})`);
      
      // Create a cache key for this repository's tags
      const cacheKey = `tags-${registry.server}-${repositoryName}`;

      // Check if the request is being throttled (for authenticated registries)
      if (registry.type === 'authenticated' && this.isRequestThrottled(registry, `${repositoryName}/tags`)) {
        devLog(`[RegistryService] Request throttled for tags of ${repositoryName}, using cached data or returning empty result`);
        
        // Try to use cached data if available
        if (typeof window !== 'undefined') {
          const cachedData = sessionStorage.getItem(cacheKey);
          if (cachedData) {
            try {
              const parsed = JSON.parse(cachedData);
              devLog(`[RegistryService] Using cached tags for throttled request to ${repositoryName}`);
              return parsed.data;
            } catch (e) {
              console.error('[RegistryService] Error parsing cached tags data for throttled request:', e);
            }
          }
        }
        
        // If no cache is available, return an empty result instead of making an API call
        return { 
          name: repositoryName,
          tags: [] 
        };
      }
      
      // Determine cache expiration based on registry type
      const cacheExpiration = registry.type === 'anonymous' 
        ? CACHE_EXPIRATION.ANONYMOUS
        : CACHE_EXPIRATION.AUTHENTICATED;
      
      // Check if we have cached results
      if (typeof window !== 'undefined') {
        const cachedData = sessionStorage.getItem(cacheKey);
        if (cachedData) {
          try {
            const parsed = JSON.parse(cachedData);
            // Use cache based on registry type's expiration time
            if (parsed.timestamp && Date.now() - parsed.timestamp < cacheExpiration) {
              devLog(`[RegistryService] getTags: Using cached tags for ${repositoryName} (cache valid for ${Math.round((cacheExpiration)/60000)} minutes)`);
              return parsed.data;
            } else {
              devLog(`[RegistryService] getTags: Cache expired for ${repositoryName} tags, fetching fresh data`);
            }
          } catch (e) {
            console.error('[RegistryService] getTags: Error parsing cached tags data:', e);
          }
        }
      }
      
      // Resolve credentials for authenticated registries
      this.resolveCredentials(registry, 'getTags');
      
      // Create special headers for tags request if needed
      // Some registries might have special requirements for tags requests
      const headers: Record<string, string> = {
        'Accept': 'application/json'
      };
      
      // Make the request using fetchWithProxy which handles authentication
      const url = `https://${registry.server}/v2/${repositoryName}/tags/list`;
      devLog(`[RegistryService] getTags: Calling fetchWithProxy for ${url}`);
      
      // Let fetchWithProxy handle the credentials and token request
      const result = await this.fetchWithProxy(url, registry, 'GET', headers);
      
      if (!result || !result.tags) {
        // If result doesn't have tags array, return empty array
        console.warn(`[RegistryService] getTags: Invalid tags response from ${registry.server} for ${repositoryName}:`, result);
        return { 
          name: repositoryName,
          tags: [] 
        };
      }
      
      // Cache the results if we have a window object (client-side)
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({
            timestamp: Date.now(),
            data: result
          }));
          devLog(`[RegistryService] getTags: Cached ${result.tags.length} tags for ${repositoryName}, expires in ${Math.round(cacheExpiration/60000)} minutes`);
        } catch (e) {
          console.error('[RegistryService] getTags: Error caching tags data:', e);
        }
      }
      
      devLog(`[RegistryService] getTags: Successfully fetched ${result.tags.length} tags for ${repositoryName}`);
      return result;
    } catch (error) {
      console.error(`[RegistryService] Failed to fetch tags for ${repositoryName}:`, error);
      throw error;
    }
  }

  /**
   * Fetch a blob by digest from a registry.
   * Returns the parsed JSON (for JSON blobs) or raw text.
   */
  async getBlob(registry: Registry, repositoryName: string, digest: string): Promise<any> {
    try {
      this.resolveCredentials(registry, 'getBlob');
      const url = `https://${registry.server}/v2/${repositoryName}/blobs/${digest}`;
      devLog(`[RegistryService] getBlob: Fetching blob ${digest} from ${registry.server}/${repositoryName}`);
      return await this.fetchWithProxy(url, registry);
    } catch (error) {
      console.error(`[RegistryService] getBlob: Failed to fetch blob ${digest}:`, error);
      throw error;
    }
  }

  async getManifest(registry: Registry, repositoryName: string, tag: string): Promise<ManifestResponse> {
    try {
      // Add a more comprehensive set of Accept headers to handle different registry types
      const headers = {
        'Accept': 'application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.v1+json,application/json'
      };
      
      devLog(`[RegistryService] getManifest: Fetching manifest for ${repositoryName}:${tag} from ${registry.server} (type: ${registry.type})`);
      
      // Resolve credentials for authenticated registries
      this.resolveCredentials(registry, 'getManifest');
      
      const url = `https://${registry.server}/v2/${repositoryName}/manifests/${tag}`;
      devLog(`[RegistryService] getManifest: Calling fetchWithProxy for ${url}`);
      
      const result = await this.fetchWithProxy(url, registry, 'GET', headers);
      
      // Check if response is wrapped with headers from registry API
      let manifestData: any;
      let tagDigestFromHeader: string | undefined;
      
      if (result && typeof result === 'object' && result.data && result.headers) {
        // We received a wrapped response with headers
        manifestData = result.data;
        // Extract Docker-Content-Digest from headers - this is the true tag digest
        if (result.headers['docker-content-digest']) {
          tagDigestFromHeader = result.headers['docker-content-digest'];
          devLog(`[RegistryService] getManifest: Found Docker-Content-Digest header: ${tagDigestFromHeader}`);
        }
      } else {
        // Direct data response
        manifestData = result;
      }
      
      // Ensure the response has a valid schemaVersion, which all manifest types should have
      if (!manifestData || !manifestData.schemaVersion) {
        console.warn('[RegistryService] getManifest: Received invalid manifest format:', manifestData);
        // Try to construct a minimal valid response
        if (typeof manifestData === 'object') {
          // Add minimal required fields if missing
          if (!manifestData.schemaVersion) manifestData.schemaVersion = 0;
          
          // If the header provided a digest, prioritize it
          if (tagDigestFromHeader) {
            manifestData.digest = tagDigestFromHeader;
            devLog(`[RegistryService] getManifest: Using Docker-Content-Digest from header for tag digest`);
          }
          // Otherwise use any direct digest property
          else if (manifestData.digest) {
            devLog(`[RegistryService] getManifest: Using manifest digest property: ${manifestData.digest}`);
          }
          
          return manifestData as ManifestResponse;
        }
        
        // If we can't make anything useful from the response, return minimal stub with header digest if available
        return {
          schemaVersion: 0,
          digest: tagDigestFromHeader || `unknown:${Date.now()}`, // Use header digest or generate a fake one
          mediaType: 'unknown',
        };
      }
      
      // If we have a valid manifest but no digest property, add it from the header
      if (tagDigestFromHeader && !manifestData.digest) {
        manifestData.digest = tagDigestFromHeader;
        devLog(`[RegistryService] getManifest: Added Docker-Content-Digest from header to manifest response`);
      }
      
      return manifestData as ManifestResponse;
    } catch (error) {
      console.error(`[RegistryService] getManifest: Failed to fetch manifest for ${repositoryName}:${tag}:`, error);
      throw error;
    }
  }

  // Method to get detailed platform information
  async getTagPlatformDetails(registry: Registry, repositoryName: string, tag: Tag): Promise<Tag> {
    devLog(`[RegistryService] getTagPlatformDetails: Called for ${repositoryName}:${tag.name}`);
    
    // Compute total size from a manifest response
    const computeManifestSize = (m: ManifestResponse): number | undefined => {
      // Manifest list / OCI index: sum of all child manifest sizes
      if (m.manifests && Array.isArray(m.manifests) && m.manifests.length > 0) {
        const total = m.manifests.reduce((sum: number, child: { size?: number }) => sum + (child.size || 0), 0);
        if (total > 0) return total;
      }
      // Single manifest with layers: sum layers + config
      if (m.layers && Array.isArray(m.layers)) {
        const layersSize = m.layers.reduce((sum: number, l: { size?: number }) => sum + (l.size || 0), 0);
        const configSize = m.config?.size || 0;
        const total = layersSize + configSize;
        if (total > 0) return total;
      }
      // Fallback: manifest's own size field or config size
      if (m.size && m.size > 0) return m.size;
      if (m.config?.size && m.config.size > 0) return m.config.size;
      return undefined;
    };

    try {
      // Ensure we have credentials for authenticated registries
      // Resolve credentials for authenticated registries
      this.resolveCredentials(registry, 'getTagPlatformDetails');
      
      // First, try to get the manifest which might contain platform info
      devLog(`[RegistryService] getTagPlatformDetails: Fetching manifest for ${repositoryName}:${tag.name}`);
      const manifest = await this.getManifest(registry, repositoryName, tag.name);
      devLog(`[RegistryService] getTagPlatformDetails: Received manifest for ${repositoryName}:${tag.name}`, manifest);
      
      // Extract platform info from the manifest if available
      const updatedTag: Tag = {
        ...tag,
        detailed: true,
        // Copy digest from manifest so tag detail page can display it
        digest: manifest.digest || tag.digest,
        // Compute total size from manifest structure
        size: computeManifestSize(manifest) || tag.size,
        // Attach manifest metadata so callers don't need a separate getManifest() call
        mediaType: manifest.mediaType,
        configMediaType: manifest.config?.mediaType || (manifest.manifests?.[0]?.mediaType),
      };
      
      // If the manifest has direct platform info
      if (manifest.platform) {
        devLog(`[RegistryService] getTagPlatformDetails: Manifest has direct platform info: ${JSON.stringify(manifest.platform)}`);
        updatedTag.architecture = manifest.platform.architecture;
        updatedTag.os = manifest.platform.os;
        if (manifest.platform.variant) {
          updatedTag.variants = [manifest.platform.variant];
        }
        if (manifest.platform.features) {
          updatedTag.features = manifest.platform.features;
        }
        return updatedTag;
      }
      
      // Handle manifest lists/OCI indexes — extract platforms from manifests[].platform
      // No extra API calls needed: the platform info is embedded in each child descriptor
      if (manifest.manifests && Array.isArray(manifest.manifests) && manifest.manifests.length > 0) {
        devLog(`[RegistryService] getTagPlatformDetails: Detected manifest list with ${manifest.manifests.length} entries for ${repositoryName}:${tag.name}`);
        
        const platforms = manifest.manifests
          .filter(m => m.platform && m.platform.architecture && m.platform.os)
          .map(m => ({
            os: m.platform!.os,
            architecture: m.platform!.architecture,
            ...(m.platform!['os.version'] ? { 'os.version': m.platform!['os.version'] } : {}),
            ...(m.platform!.variant ? { variant: m.platform!.variant } : {}),
            ...(m.platform!.features ? { features: m.platform!.features } : {}),
          }));
        
        if (platforms.length > 0) {
          updatedTag.platforms = platforms;
          // Set primary architecture/os from first platform for backward compatibility
          updatedTag.architecture = platforms.length > 1 ? 'multi-arch' : platforms[0].architecture;
          updatedTag.os = platforms.length > 1 ? 'multi-os' : platforms[0].os;
          devLog(`[RegistryService] getTagPlatformDetails: Extracted ${platforms.length} platforms from manifest list`);
        } else {
          updatedTag.architecture = 'unknown';
          updatedTag.os = 'unknown';
        }
        
        return updatedTag;
      }
      
      // Try to get platform info from config blob if available (single manifests only)
      if (manifest.config && manifest.config.digest) {
        try {
          // Format the digest to remove the "sha256:" prefix for the blob URL
          const configDigest = manifest.config.digest;
          const url = `https://${registry.server}/v2/${repositoryName}/blobs/${configDigest}`;
          devLog(`[RegistryService] getTagPlatformDetails: Fetching config blob from ${url}`);
          const configBlob = await this.fetchWithProxy(url, registry);
          devLog(`[RegistryService] getTagPlatformDetails: Retrieved config blob:`, configBlob);
          
          // Extract architecture and OS from config
          if (configBlob && configBlob.architecture && configBlob.os) {
            updatedTag.architecture = configBlob.architecture;
            updatedTag.os = configBlob.os;
            if (configBlob.variant) {
              updatedTag.variants = [configBlob.variant];
            }
            if (configBlob.os_version) {
              updatedTag.os = `${updatedTag.os} ${configBlob.os_version}`;
            }
            devLog(`[RegistryService] getTagPlatformDetails: Extracted platform info from blob: arch=${updatedTag.architecture}, os=${updatedTag.os}`);
          }
        } catch (err) {
          console.error(`[RegistryService] getTagPlatformDetails: Failed to fetch config blob for ${repositoryName}:${tag.name}:`, err);
          // Continue even if blob fetch fails, we still want to return partial info
        }
      }
      
      // If we still couldn't get architecture and OS, try to use annotations
      if ((!updatedTag.architecture || !updatedTag.os) && manifest.annotations) {
        devLog(`[RegistryService] getTagPlatformDetails: Checking annotations for platform info`);
        if (manifest.annotations['org.opencontainers.image.architecture']) {
          updatedTag.architecture = manifest.annotations['org.opencontainers.image.architecture'];
        }
        if (manifest.annotations['org.opencontainers.image.os']) {
          updatedTag.os = manifest.annotations['org.opencontainers.image.os'];
        }
      }
      
      // If we still couldn't identify the platform, set default values
      if (!updatedTag.architecture) {
        updatedTag.architecture = 'unknown';
      }
      if (!updatedTag.os) {
        updatedTag.os = 'unknown';
      }
      
      devLog(`[RegistryService] getTagPlatformDetails: Returning tag with platform info: arch=${updatedTag.architecture}, os=${updatedTag.os}`);
      return updatedTag;
    } catch (error) {
      console.error(`[RegistryService] getTagPlatformDetails: Failed to fetch platform details for ${repositoryName}:${tag.name}:`, error);
      // Return tag with detailed flag true even on failure, to prevent repeated attempts
      const fallbackTag = { ...tag, detailed: true, architecture: 'unknown', os: 'unknown' };
      devLog(`[RegistryService] getTagPlatformDetails: Returning fallback tag:`, fallbackTag);
      return fallbackTag;
    }
  }

  // Registry management functions
  getAllRegistries(): Registry[] {
    try {
      const registriesJSON = localStorage.getItem(STORAGE_KEYS.REGISTRIES);
      const registries = registriesJSON ? JSON.parse(registriesJSON) : [];
      
      // Filter out sensitive data from authenticated registries
      return registries.map((registry: Registry) => {
        if (isAuthenticatedRegistry(registry)) {
          return removePasswordFromRegistry(registry);
        }
        return registry;
      });
    } catch (error) {
      console.error('Failed to get registries:', error);
      return [];
    }
  }

  saveRegistries(registries: Registry[]): void {
    if (typeof window === 'undefined') return;
    try {
      // Store the registry metadata in localStorage, but without sensitive fields
      const registriesToStore = registries.map(registry => {
        if (isAuthenticatedRegistry(registry)) {
          return removePasswordFromRegistry(registry);
        }
        return registry;
      });
      
      localStorage.setItem(STORAGE_KEYS.REGISTRIES, JSON.stringify(registriesToStore));
      this.dispatchRegistryChangedEvent();
    } catch (error) {
      logError(new AppError('Failed to save registries', 'REGISTRY_SAVE_ERROR', { error }));
    }
  }

  // Store registry connection info using the registry service
  addRegistry(registry: Registry): string {
    if (typeof window === 'undefined') return '';
    
    try {
      // Use server name as ID for simplicity and consistency
      // This makes it easier to recover credentials
      const registryId = registry.id || registry.server;
      const registryWithId = { ...registry, id: registryId };
      
      devLog(`[RegistryService] Adding registry: ${registryWithId.server} with ID: ${registryId}`);
      devLog(`[RegistryService] Registry type: ${registryWithId.type}`);
      
      // Get current registries
      const registries = this.getAllRegistries();
      
      // Check if registry with same server already exists
      const existingIndex = registries.findIndex(r => r.server === registry.server);
      
      // Always clean up existing credentials for this server to prevent conflicts
      if (existingIndex >= 0) {
        const existingRegistry = registries[existingIndex];
        if (existingRegistry.id) {
          devLog(`[RegistryService] Removing existing registry and credentials: ${existingRegistry.server} (ID: ${existingRegistry.id})`);
          
          // Remove old credentials to avoid any chance of invalid credential reuse
          try {
            // First clear with the registry ID
            clearCredential({ id: existingRegistry.id });
            // Also clear with the server name for backward compatibility
            clearCredential({ id: existingRegistry.server });
            
            // If they're different, also try the registry server as a fallback
            if (existingRegistry.id !== existingRegistry.server) {
              clearCredential({ id: existingRegistry.server });
            }
            
            // For good measure, clear session storage related to this registry
            const cacheKeysToRemove = [];
            for (let i = 0; i < sessionStorage.length; i++) {
              const key = sessionStorage.key(i);
              if (key && (key.includes(existingRegistry.server) || key.includes(existingRegistry.id))) {
                cacheKeysToRemove.push(key);
              }
            }
            
            cacheKeysToRemove.forEach(key => {
              devLog(`[RegistryService] Clearing cache entry when replacing registry: ${key}`);
              sessionStorage.removeItem(key);
            });
            
            // Also clear throttling records
            const throttleKeys = [
              `${existingRegistry.server}:${existingRegistry.id}:_catalog`,
              `${existingRegistry.server}::_catalog`
            ];
            throttleKeys.forEach(key => recentApiCalls.delete(key));
            
          } catch (error) {
            console.error(`[RegistryService] Error clearing existing credentials:`, error);
          }
        }
      }
      
      // If it's an authenticated registry, store credentials in credential store
      if (isAuthenticatedRegistry(registryWithId)) {
        devLog(`[RegistryService] Registry is authenticated, storing credentials...`);
        
        // First, ensure the registry has valid credentials
        if (!registryWithId.username || !registryWithId.password) {
          console.error(`[RegistryService] ERROR: Missing credentials for authenticated registry ${registryWithId.server}`);
          console.error(`[RegistryService] Username: ${registryWithId.username ? 'provided' : 'missing'}, Password: ${registryWithId.password ? 'provided' : 'missing'}`);
          throw new Error(`Cannot add authenticated registry without username and password`);
        }
        
        try {
          // Import the credential store functions - get a fresh reference each time
          devLog(`[RegistryService] Credential store state BEFORE storing credentials:`);
          debugAllCredentials();
          
          // Store the credentials with both the registry ID and the server URL
          // This provides redundancy in credential lookup
          devLog(`[RegistryService] Storing credentials for registry ID: ${registryId}`);
          storeCredential(
            registryId, // Use the ID directly as a string
            { 
              username: registryWithId.username, 
              password: registryWithId.password 
            }
          );
          
          // Also store with server URL as key for backward compatibility
          if (registryId !== registryWithId.server) {
            devLog(`[RegistryService] Also storing credentials with server URL as key: ${registryWithId.server}`);
            storeCredential(
              registryWithId.server,
              { 
                username: registryWithId.username, 
                password: registryWithId.password 
              }
            );
          }
          
          // Immediately verify the credentials were stored properly
          devLog(`[RegistryService] Verifying credentials were stored successfully...`);
          const storedCredentials = getCredentialById(registryId);
          
          if (!storedCredentials) {
            console.error(`[RegistryService] CRITICAL ERROR: Credentials storage verification failed!`);
            console.error(`[RegistryService] Attempted to store credentials for: ${registryId}`);
            
            // Try one more time as a last resort with both ID and server
            devLog(`[RegistryService] Trying again with direct function calls...`);
            storeCredential(registryId, { 
              username: registryWithId.username, 
              password: registryWithId.password 
            });
            
            storeCredential(registryWithId.server, { 
              username: registryWithId.username, 
              password: registryWithId.password 
            });
            
            // Check if it worked
            const retryCheck = getCredentialById(registryId) || getCredentialById(registryWithId.server);
            if (retryCheck) {
              devLog(`[RegistryService] Retry succeeded. Credentials are now stored.`);
            } else {
              console.error(`[RegistryService] Retry failed. Credential storage is not working.`);
            }
          } else {
            devLog(`[RegistryService] SUCCESS: Credentials stored and verified!`);
          }
          
          // Log the state of the credential store after storing
          devLog(`[RegistryService] Credential store state AFTER storing credentials:`);
          debugAllCredentials();
        } catch (error) {
          console.error(`[RegistryService] ERROR storing credentials:`, error);
        }
        
        // Create a version without password for localStorage
        const registryWithoutPassword = removePasswordFromRegistry(registryWithId);
        
        if (existingIndex >= 0) {
          // Update existing registry
          registries[existingIndex] = registryWithoutPassword;
        } else {
          // Add new registry
          registries.push(registryWithoutPassword);
        }
      } else {
        // For anonymous registries, just add/update as normal
        if (existingIndex >= 0) {
          registries[existingIndex] = registryWithId;
        } else {
          registries.push(registryWithId);
        }
      }
      
      this.saveRegistries(registries);
      
      // Set as current registry
      localStorage.setItem(STORAGE_KEYS.CURRENT_REGISTRY_ID, registryId);
      
      // *** CRITICAL FIX: Reset throttling timestamps for this registry ***
      // Reset the API throttle timers to allow immediate loading
      if (typeof window !== 'undefined') {
        // Reset all repositories loading time to allow immediate load
        (window as any).__lastAllRegistriesCallTime = 0;
        
        // Reset registry-specific throttling
        if (!(window as any).__lastRegistryRequestTimes) {
          (window as any).__lastRegistryRequestTimes = {};
        }
        (window as any).__lastRegistryRequestTimes[registryId] = 0;
        
        // Clear throttling records for this registry's endpoints
        const throttleKeys = [`${registryWithId.server}:${registryId || ''}:_catalog`];
        throttleKeys.forEach(key => recentApiCalls.delete(key));
        
        // Clear any pending repository requests for this registry by notifying
        // any components listening via events
        const cacheKey = `catalog-${registryWithId.server}`;
        window.dispatchEvent(new CustomEvent(REGISTRY_EVENTS.REGISTRY_ADDED, {
          detail: { 
            registryId,
            server: registryWithId.server,
            cacheKey,
            type: registryWithId.type
          }
        }));
      }
      
      this.dispatchRegistryChangedEvent();
      
      return registryId;
    } catch (error) {
      logError(new AppError('Failed to add registry', 'REGISTRY_ADD_ERROR', { error }));
      return '';
    }
  }

  // Get current registry ID
  getCurrentRegistryId(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEYS.CURRENT_REGISTRY_ID);
    } catch (error) {
      console.error('Failed to get current registry ID:', error);
      return null;
    }
  }

  // Get current registry object
  getCurrentRegistry(): Registry | null {
    try {
      const currentRegistryId = this.getCurrentRegistryId();
      if (!currentRegistryId) return null;
      
      const registries = this.getAllRegistries();
      return registries.find(registry => registry.id === currentRegistryId) || null;
    } catch (error) {
      console.error('Failed to get current registry:', error);
      return null;
    }
  }

  // Set current registry by ID
  async setCurrentRegistry(registryId: string): Promise<boolean> {
    try {
      // Skip if we're in server-side rendering
      if (typeof window === 'undefined') return false;

      // Skip if registry ID is falsy (null/undefined/empty string)
      if (!registryId) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('Attempted to set current registry with empty ID');
        }
        return false;
      }
      
      // Check if the registry exists
      const registries = this.getAllRegistries();
      const registry = registries.find(r => r.id === registryId);
      
      if (!registry) {
        console.error(`[RegistryService] Registry with ID ${registryId} not found in saved registries`);
        return false;
      }
      
      // Clear session cache for this registry to ensure fresh data
      try {
        if (typeof window !== 'undefined') {
          const cacheKeysToRemove = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.includes(registry.server) && !key.includes('credential')) {
              cacheKeysToRemove.push(key);
            }
          }
          
          cacheKeysToRemove.forEach(key => {
            devLog(`[RegistryService] Clearing cache entry when switching registry: ${key}`);
            sessionStorage.removeItem(key);
          });
          
          // Also clean up throttling for this registry
          const throttleKeys = [`${registry.server}:${registryId}:_catalog`];
          throttleKeys.forEach(key => recentApiCalls.delete(key));
        }
      } catch (e) {
        console.error(`[RegistryService] Error clearing cache during registry switch:`, e);
      }
      
      // For authenticated registries, verify we have valid credentials
      if (registry.type === 'authenticated') {
        // Log credential store state
        devLog(`[RegistryService] Credential store state before setting registry ${registry.server}:`);
        debugAllCredentials();
        
        // Check if we have stored credentials for this registry
        const storedCredentials = getCredentialById(registryId) || getCredentialById(registry.server);
        
        if (!storedCredentials) {
          console.warn(`[RegistryService] No credentials found in store for ${registry.server}, may fail authentication`);
        } else {
          devLog(`[RegistryService] Found credentials for ${registry.server} in credential store`);
          
          // For better test reliability, add credentials to the registry object directly
          (registry as AuthenticatedRegistry).username = storedCredentials.username;
          (registry as AuthenticatedRegistry).password = storedCredentials.password;
        }
      }
      
      // Test connection before setting as current
      devLog(`[RegistryService] Verifying connection to registry ${registry.server} before setting as current`);
      try {
        // For authenticated registries, use direct credentials to force clear testing
        const useDirectCreds = registry.type === 'authenticated' && 
                              (registry as AuthenticatedRegistry).username !== undefined && 
                              (registry as AuthenticatedRegistry).password !== undefined;
        
        const connectionTest = await this.testRegistryConnection(registry, {
          forceDirectCredentials: !!useDirectCreds
        });
        
        if (!connectionTest.success) {
          console.error(`[RegistryService] Cannot set registry ${registry.server} as current: ${connectionTest.error}`);
          
          // If it's an authenticated registry with a 401 error, clear potentially invalid credentials
          if (registry.type === 'authenticated' && 
              typeof connectionTest.error === 'string' && 
              connectionTest.error.includes('Authentication failed')) {
            devLog(`[RegistryService] Authentication failed, clearing potentially invalid credentials for ${registry.server} (ID: ${registryId})`);
            clearCredential({ id: registryId });
            clearCredential({ id: registry.server });
          }
          
          return false;
        }
      } catch (error) {
        console.error(`[RegistryService] Error testing connection to ${registry.server}:`, error);
        return false;
      }
      
      // Connection is valid, proceed to set the registry as current
      devLog(`[RegistryService] Setting current registry to ${registryId} (${registry.server})`);
      localStorage.setItem(STORAGE_KEYS.CURRENT_REGISTRY_ID, registryId);
      
      // Reset throttling timestamps for this registry to ensure immediate data loading
      if (typeof window !== 'undefined') {
        // Reset any throttling
        if (!(window as any).__lastRegistryRequestTimes) {
          (window as any).__lastRegistryRequestTimes = {};
        }
        (window as any).__lastRegistryRequestTimes[registryId] = 0;
        
        // Reset the API throttle timers for this registry
        const throttleKeys = [`${registry.server}:${registryId}:_catalog`];
        throttleKeys.forEach(key => recentApiCalls.delete(key));
      }
      
      return true;
    } catch (error) {
      console.error('Failed to set current registry:', error);
      return false;
    }
  }

  removeRegistry(registryId: string): boolean {
    if (typeof window === 'undefined') return false;
    
    try {
      let registries = this.getAllRegistries();
      const initialLength = registries.length;
      
      // Before removing, check if it's an authenticated registry
      const registry = registries.find(r => r.id === registryId);
      if (registry && isAuthenticatedRegistry(registry)) {
        // Remove credentials from credential store
        try {
          devLog(`[RegistryService] Clearing credentials for registry ID: ${registryId}`);
          clearCredential({ id: registryId });
        } catch (error) {
          console.error(`[RegistryService] Error clearing credentials:`, error);
        }
      }
      
      registries = registries.filter(r => r.id !== registryId);
      
      if (registries.length < initialLength) {
        this.saveRegistries(registries);
        
        // If we removed the current registry, set a new current registry if available
        const currentRegistryId = localStorage.getItem(STORAGE_KEYS.CURRENT_REGISTRY_ID);
        if (currentRegistryId === registryId) {
          if (registries.length > 0) {
            localStorage.setItem(STORAGE_KEYS.CURRENT_REGISTRY_ID, registries[0].id!);
          } else {
            localStorage.removeItem(STORAGE_KEYS.CURRENT_REGISTRY_ID);
            
            // Dispatch event with lastRegistryRemoved flag
            this.dispatchRegistryChangedEvent({ 
              lastRegistryRemoved: true
            });
            return true;
          }
        } else {
          this.dispatchRegistryChangedEvent();
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      logError(new AppError('Failed to remove registry', 'REGISTRY_REMOVE_ERROR', { error }));
      return false;
    }
  }

  /**
   * Removes a registry without reloading the page
   * This is similar to removeRegistry but doesn't reload the page
   * Useful for components that want to handle the UI flow themselves
   */
  removeRegistryNoReload(registryId: string): boolean {
    if (typeof window === 'undefined') return false;
    
    try {
      let registries = this.getAllRegistries();
      const initialLength = registries.length;
      
      // Before removing, check if it's an authenticated registry
      const registry = registries.find(r => r.id === registryId);
      if (registry && isAuthenticatedRegistry(registry)) {
        // Remove credentials from credential store
        try {
          devLog(`[RegistryService] Clearing credentials for registry ID: ${registryId}`);
          clearCredential({ id: registryId });
        } catch (error) {
          console.error(`[RegistryService] Error clearing credentials:`, error);
        }
      }
      
      registries = registries.filter(r => r.id !== registryId);
      
      if (registries.length < initialLength) {
        this.saveRegistries(registries);
        
        // If we removed the current registry, set a new current registry if available
        const currentRegistryId = localStorage.getItem(STORAGE_KEYS.CURRENT_REGISTRY_ID);
        if (currentRegistryId === registryId) {
          if (registries.length > 0) {
            localStorage.setItem(STORAGE_KEYS.CURRENT_REGISTRY_ID, registries[0].id!);
          } else {
            localStorage.removeItem(STORAGE_KEYS.CURRENT_REGISTRY_ID);
            
            // Also dispatch registry changed event
            this.dispatchRegistryChangedEvent({ lastRegistryRemoved: true });
            return true;
          }
        }
        
        // General registry changed event for other cases
        this.dispatchRegistryChangedEvent();
        
        return true;
      }
      
      return false;
    } catch (error) {
      logError(new AppError('Failed to remove registry (no reload)', 'REGISTRY_REMOVE_NO_RELOAD_ERROR', { error }));
      return false;
    }
  }

  clearAllRegistries() {
    try {
      if (typeof window !== 'undefined') {
        // Clear registry items from localStorage
        clearStorageItemsByPrefix('registry-');
        
        // Clear registry data
        removeStorageItem(STORAGE_KEYS.REGISTRIES);
        removeStorageItem(STORAGE_KEYS.CURRENT_REGISTRY_ID);
        
        // Clear all credentials from the credential store
        // Use imported functions directly
        clearAllCredentials();
        
        // Dispatch the registry changed event for components that need to know
        this.dispatchRegistryChangedEvent({ lastRegistryRemoved: true });
      }
    } catch (error) {
      logError(new AppError('Error clearing registries', 'REGISTRY_CLEAR_ERROR', { error }));
    }
  }

  // Helper method to dispatch registry changed event
  private dispatchRegistryChangedEvent(details?: RegistryChangedEventDetail): void {
    if (typeof window !== 'undefined') {
      // Include prevRegistry even with custom event details
      const currentRegistryId = localStorage.getItem(STORAGE_KEYS.CURRENT_REGISTRY_ID);
      const allRegistries = this.getAllRegistries();
      
      // Get more details about the current registry for better debugging
      const currentRegistry = currentRegistryId ? 
        allRegistries.find(r => r.id === currentRegistryId) : null;
      
      const eventDetails = {
        ...(details || {}),
        registry: currentRegistryId,
        registryCount: allRegistries.length,
        currentRegistryServer: currentRegistry?.server || null
      };
      
      if (process.env.NODE_ENV === 'development') {
        devLog(`Dispatching registry-changed event with details:`, eventDetails);
      }
      
      window.dispatchEvent(new CustomEvent(REGISTRY_EVENTS.REGISTRY_CHANGED, { 
        detail: eventDetails 
      }));
    }
  }

  async getRepositories(registry: Registry): Promise<RepositoriesResponse> {
    try {
      // Create a cache key for this request
      const cacheKey = `repositories-${registry.server}`;
      
      // Check if this is an authenticated registry
      if (registry.type === 'authenticated') {
        // For authenticated registries, log detailed debug info to help diagnose auth issues
        devLog(`Getting repositories for authenticated registry: ${registry.server} (ID: ${registry.id || 'unknown'})`);
        
        // Check if credentials exist
        if (registry.id) {
          const credentials = getCredential(registry);
          if (credentials) {
            devLog(`Found credentials for registry ${registry.server} (username: ${credentials.username})`);
          } else {
            console.warn(`No credentials found for authenticated registry ${registry.server} (ID: ${registry.id})`);
          }
        }
      }
      
      // Check if the request is throttled
      if (this.isRequestThrottled(registry, '_catalog')) {
        devLog(`Request throttled for ${registry.server}, checking for cached data`);
        
        // Check if we have cached data
        if (typeof window !== 'undefined') {
          try {
            const cachedData = sessionStorage.getItem(cacheKey);
            if (cachedData) {
              const parsed = JSON.parse(cachedData);
              const cacheExpiration = registry.type === 'anonymous' 
                ? CACHE_EXPIRATION.ANONYMOUS 
                : CACHE_EXPIRATION.AUTHENTICATED;
                
              if (parsed && parsed.timestamp && Date.now() - parsed.timestamp < cacheExpiration) {
                devLog(`Using cached data for throttled request to ${registry.server}`);
                return parsed.data;
              }
            }
          } catch (e) {
            console.error('Error parsing cached data for throttled request:', e);
          }
        }
        
        // If no valid cache exists, return empty result to avoid excessive API calls
        devLog(`No valid cache for throttled request to ${registry.server}, returning empty result`);
        return { repositories: [] };
      }
      
      // Check if we have cached results
      const cacheExpiration = registry.type === 'anonymous' 
        ? CACHE_EXPIRATION.ANONYMOUS 
        : CACHE_EXPIRATION.AUTHENTICATED;
      
      if (typeof window !== 'undefined') {
        const cachedData = sessionStorage.getItem(cacheKey);
        if (cachedData) {
          try {
            const parsed = JSON.parse(cachedData);
            if (parsed.timestamp && Date.now() - parsed.timestamp < cacheExpiration) {
              devLog(`Using cached repositories for ${registry.server}, expires in ${Math.round((cacheExpiration - (Date.now() - parsed.timestamp))/60000)} minutes`);
              return parsed.data;
            } else {
              devLog(`Cache expired for ${registry.server}, fetching fresh data`);
            }
          } catch (e) {
            console.error('Error parsing cached data:', e);
          }
        }
      }
      
      // Fetch the catalog from the registry API
      const url = `https://${registry.server}/v2/_catalog`;
      
      // Use the fetchWithProxy method to go through the server for authentication
      const response = await this.fetchWithProxy(url, registry);
      
      // Transform catalog response to RepositoriesResponse format if needed
      if (response && response.repositories && Array.isArray(response.repositories)) {
        const result = {
          repositories: response.repositories
        };
        
        // Cache the results
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({
            timestamp: Date.now(),
            data: result
          }));
          devLog(`Cached ${result.repositories.length} repositories for ${registry.server}, expires in ${Math.round(cacheExpiration/60000)} minutes`);
        } catch (e) {
          console.error('Error caching repository data:', e);
        }
        
        return result;
      }
      
      // Return empty response if something went wrong
      return { repositories: [] };
    } catch (error) {
      console.error('Error fetching repositories:', error);
      
      // For authentication errors (401), provide a better error message
      if (error instanceof Error && error.message.includes('401')) {
        devLog(`Authentication error fetching repositories for ${registry.server}`);
        
        // If this is an authenticated registry and we got a 401, the credentials might be invalid
        if (registry.type === 'authenticated' && registry.id) {
          console.warn(`Possible invalid credentials for ${registry.server} (ID: ${registry.id})`);
        }
      }
      
      throw error; // Re-throw to allow caller to handle the error
    }
  }

  /**
   * Tests connectivity with a registry before navigating
   * Returns true if registry is reachable, or false with error details if not
   */
  async testRegistryConnection(registry: Registry, options: { forceDirectCredentials?: boolean } = {}): Promise<{success: boolean, error?: string}> {
    try {
      // Create a lightweight request to test connectivity
      const url = `https://${registry.server}/v2/`;
      
      // Special case for authenticated registry with direct credentials
      // We want to ensure we use the credentials provided in the registry object
      if (isAuthenticatedRegistry(registry) && options.forceDirectCredentials) {
        // Ensure we have a working copy of the registry to avoid mutating the original
        const registryCopy = { ...registry };
        
        // Log the direct credential use
        if ((registry as AuthenticatedRegistry).username && (registry as AuthenticatedRegistry).password) {
          devLog(`[RegistryService] testRegistryConnection: Using direct registry credentials for authentication test`);
        } else {
          console.warn(`[RegistryService] testRegistryConnection: forceDirectCredentials option used but no credentials in registry object`);
        }
      }
      
      // Set a shorter timeout for this test request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      try {
        // Use fetchWithProxy with minimal options to test connectivity
        await this.fetchWithProxy(url, registry, 'GET', {}, controller.signal);
        
        // If we get here, the connection was successful
        clearTimeout(timeoutId);
        return { success: true };
      } catch (error) {
        clearTimeout(timeoutId);
        console.error(`Registry connection test failed for ${registry.server}:`, error);
        
        // For authenticated registries that fail with 401, we might have stale credentials
        if (isAuthenticatedRegistry(registry) && error instanceof Error && error.message.includes('401')) {
          // Check if this registry has direct credentials in the object
          if ((registry as AuthenticatedRegistry).username && (registry as AuthenticatedRegistry).password) {
            // If we have direct credentials but still got 401, the credentials are likely invalid
            console.error(`[RegistryService] Authentication failed with provided credentials for ${registry.server}`);
            
            return { 
              success: false, 
              error: `Authentication failed for ${registry.server}. Please check your credentials.` 
            };
          }
          // Otherwise it could be stale credentials in the store
          else if (registry.id) {
            // Try clearing the credentials for this registry
            devLog(`[RegistryService] Clearing potentially stale credentials for ${registry.server} (ID: ${registry.id})`);
            clearCredential({ id: registry.id });
            clearCredential({ id: registry.server });
            
            return { 
              success: false, 
              error: `Authentication failed for ${registry.server}. Previous credentials may be stale. Please re-enter your credentials.` 
            };
          }
        }
        
        if (error instanceof Error) {
          // Provide appropriate error message
          if (error.name === 'AbortError') {
            return { 
              success: false, 
              error: `Connection to ${registry.server} timed out. Please check the registry URL and your network connection.` 
            };
          } else if (error.message.includes('401')) {
            return { 
              success: false, 
              error: `Authentication failed for ${registry.server}. Please check your credentials.` 
            };
          } else {
            return { 
              success: false, 
              error: `Failed to connect to ${registry.server}: ${error.message}` 
            };
          }
        }
        
        return { 
          success: false, 
          error: `Failed to connect to ${registry.server}. Please check the registry URL and your network connection.` 
        };
      }
    } catch (error) {
      console.error('Error in registry connection test:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error testing registry connection' 
      };
    }
  }

  /**
   * Ensures that we have valid credentials stored for this registry
   * This is a critical method to verify credential persistence
   */
  private async validateStoredCredentials(registry: Registry): Promise<boolean> {
    if (!isAuthenticatedRegistry(registry) || !registry.id) {
      return true; // Not an authenticated registry or no ID to check
    }

    try {
      // Check if credentials exist in the store
      const directCredentials = getCredentialById(registry.id);
      
      // If no credentials in store but we have them in the registry object, store them
      if (!directCredentials && 
          (registry as AuthenticatedRegistry).username && 
          (registry as AuthenticatedRegistry).password) {
        
        devLog(`[RegistryService] No credentials in store for ${registry.server}, storing from registry object`);
        
        // Store credentials explicitly
        storeCredential(
          registry.id,
          {
            username: (registry as AuthenticatedRegistry).username!,
            password: (registry as AuthenticatedRegistry).password!
          }
        );
        
        // Also store with server name for redundancy
        if (registry.id !== registry.server) {
          storeCredential(
            registry.server,
            {
              username: (registry as AuthenticatedRegistry).username!,
              password: (registry as AuthenticatedRegistry).password!
            }
          );
        }
        
        // Verify credentials were stored
        const verifyCredentials = getCredentialById(registry.id);
        if (!verifyCredentials) {
          console.error(`[RegistryService] Failed to store credentials for ${registry.server}`);
          return false;
        }
        
        devLog(`[RegistryService] Successfully stored credentials for ${registry.server}`);
        return true;
      }
      
      // If credentials exist, test them with a connection
      if (directCredentials) {
        devLog(`[RegistryService] Found stored credentials for ${registry.server}, testing...`);
        
        // Create a test registry object with the stored credentials
        const testRegistry: Registry = {
          ...registry,
          type: 'authenticated',
          username: directCredentials.username,
          password: directCredentials.password
        };
        
        // Test the connection
        try {
          const connectionTest = await this.testRegistryConnection(testRegistry, { forceDirectCredentials: true });
          
          if (connectionTest.success) {
            devLog(`[RegistryService] Stored credentials for ${registry.server} are valid`);
            return true;
          } else {
            console.error(`[RegistryService] Stored credentials for ${registry.server} are invalid, clearing them`);
            clearCredential({ id: registry.id });
            if (registry.id !== registry.server) {
              clearCredential({ id: registry.server });
            }
            return false;
          }
        } catch (error) {
          console.error(`[RegistryService] Error testing stored credentials:`, error);
          return false;
        }
      }
      
      console.warn(`[RegistryService] No credentials found for ${registry.server} in store or registry object`);
      return false;
    } catch (error) {
      console.error(`[RegistryService] Error validating stored credentials:`, error);
      return false;
    }
  }

  /**
   * Validates registry connection and only adds it if connection is successful
   * This is a safer alternative to addRegistry that prevents adding non-working registries
   */
  async validateAndAddRegistry(registry: Registry): Promise<{success: boolean, registryId?: string, error?: string}> {
    try {
      // Create a temporary registry object for testing
      const tempRegistry = { ...registry };
      
      // Check if this registry already exists (to properly handle credential updates)
      const existingRegistries = this.getAllRegistries();
      const existingRegistry = existingRegistries.find(r => r.server === registry.server);
      
      // Before trying to add an authenticated registry, verify the credentials are valid
      if (isAuthenticatedRegistry(tempRegistry)) {
        // If the registry has credentials, ensure they're valid before proceeding
        if ((tempRegistry as AuthenticatedRegistry).username && (tempRegistry as AuthenticatedRegistry).password) {
          devLog(`[RegistryService] Validating credentials for ${tempRegistry.server} before storing`);
          
          // Clear any existing credentials for this registry
          if (existingRegistry && existingRegistry.id) {
            devLog(`[RegistryService] Clearing existing credentials for ${existingRegistry.server}`);
            try {
              clearCredential({ id: existingRegistry.id });
              clearCredential({ id: existingRegistry.server });
            } catch (error) {
              console.error(`[RegistryService] Error clearing existing credentials:`, error);
            }
          }
          
          // Clear all session storage cache for this registry
          if (typeof window !== 'undefined') {
            const cacheKeysToRemove = [];
            for (let i = 0; i < sessionStorage.length; i++) {
              const key = sessionStorage.key(i);
              if (key && key.includes(registry.server)) {
                cacheKeysToRemove.push(key);
              }
            }
            
            cacheKeysToRemove.forEach(key => {
              devLog(`[RegistryService] Clearing cache entry: ${key}`);
              sessionStorage.removeItem(key);
            });
            
            // Reset API throttling for this registry
            if (existingRegistry && existingRegistry.id) {
              const throttleKeys = [`${registry.server}:${existingRegistry.id || ''}:_catalog`];
              throttleKeys.forEach(key => recentApiCalls.delete(key));
            }
          }
        } else {
          console.error(`[RegistryService] Missing credentials for authenticated registry ${tempRegistry.server}`);
          return {
            success: false,
            error: `Missing credentials for authenticated registry ${tempRegistry.server}`
          };
        }
      }
      
      // Test connection to the registry - use forceDirectCredentials for authenticated registries
      devLog(`[RegistryService] Validating connection to ${registry.server} before adding...`);
      const connectionTest = await this.testRegistryConnection(tempRegistry, { 
        forceDirectCredentials: isAuthenticatedRegistry(tempRegistry)
      });
      
      if (!connectionTest.success) {
        console.error(`[RegistryService] Registry validation failed: ${connectionTest.error}`);
        return { 
          success: false, 
          error: connectionTest.error || `Failed to connect to ${registry.server}. Please check your connection and try again.`
        };
      }
      
      // For anonymous registries, also verify catalog access.
      // Some registries (e.g. docker.io, registry.k8s.io) respond to /v2/ but
      // don't support anonymous _catalog listing, making them unusable.
      if (registry.type === 'anonymous') {
        devLog(`[RegistryService] Testing catalog access for anonymous registry ${registry.server}...`);
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const catalogUrl = `https://${registry.server}/v2/_catalog?n=1`;
          await this.fetchWithProxy(catalogUrl, tempRegistry, 'GET', {}, controller.signal);
          clearTimeout(timeoutId);
        } catch (catalogError) {
          console.error(`[RegistryService] Catalog access failed for ${registry.server}:`, catalogError);
          return {
            success: false,
            error: `Registry ${registry.server} is reachable but does not support anonymous catalog listing. This registry may require authentication.`
          };
        }
      }
      
      // If connection succeeds, add the registry
      devLog(`[RegistryService] Registry validation successful, adding registry...`);
      const registryId = this.addRegistry(registry);
      
      if (!registryId) {
        return { 
          success: false, 
          error: `Failed to add registry ${registry.server} after successful connection test.`
        };
      }
      
      // CRITICAL: For authenticated registries, verify that credentials were actually stored
      if (isAuthenticatedRegistry(registry)) {
        const credentialsStored = await this.validateStoredCredentials(registry);
        if (!credentialsStored) {
          console.error(`[RegistryService] Registry added but credentials were not stored properly`);
          // Try one more time to store credentials directly
          const authRegistry = registry as AuthenticatedRegistry;
          if (authRegistry.username && authRegistry.password) {
            storeCredential(registryId, {
              username: authRegistry.username,
              password: authRegistry.password
            });
            
            if (registryId !== registry.server) {
              storeCredential(registry.server, {
                username: authRegistry.username,
                password: authRegistry.password
              });
            }
            
            // Check if it worked
            debugAllCredentials();
          }
        }
      }
      
      return { 
        success: true, 
        registryId 
      };
    } catch (error) {
      console.error(`[RegistryService] Error in validateAndAddRegistry:`, error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error validating registry'
      };
    }
  }
}

// Export as singleton
const registryService = new RegistryService();
export default registryService; 
