/**
 * A secure credential store for registry authentication.
 * Primary storage is in memory with sessionStorage backup for browser session persistence.
 * Credentials are cleared when the browser is closed but persist during page refreshes.
 */

import { Registry } from '@/app/types/registry';
import { devLog } from './devLog';

// Session storage key (only stores IDs and encrypted credentials, not plaintext)
const SESSION_CREDS_KEY = 'registry_session_credentials';

// CRITICAL: Create a single global credentials instance that persists across all imports
// This is our primary in-memory credential store
const GLOBAL_CREDENTIALS = Object.create(null) as Record<string, any>;

// Track initialization to help with debugging
if (!GLOBAL_CREDENTIALS.__initialized) {
  GLOBAL_CREDENTIALS.__initialized = new Date().toISOString();
  GLOBAL_CREDENTIALS.__credentials = new Map<string, Credential>();
  devLog(`[CredentialStore] INITIALIZED GLOBAL STORE at ${GLOBAL_CREDENTIALS.__initialized}`);
  
  // Load any credentials from sessionStorage on initialization
  if (typeof window !== 'undefined') {
    try {
      restoreCredentialsFromSession();
    } catch (e) {
      console.error(`[CredentialStore] Error restoring credentials from session:`, e);
    }
  }
}

// Use a more specific type that requires id to be string
interface RegistryWithId {
  id: string;
}

interface Credential {
  username: string;
  password: string;
  timestamp?: number; // When the credential was stored
}

// Credential timeout in milliseconds (8 hours)
const CREDENTIAL_TIMEOUT = 8 * 60 * 60 * 1000;

// Get direct reference to the global credentials map
function getCredentialsMap(): Map<string, Credential> {
  return GLOBAL_CREDENTIALS.__credentials;
}

// Simple obfuscation for session storage (not secure encryption, just basic obfuscation)
function obfuscate(text: string): string {
  return btoa(encodeURIComponent(text));
}

// Deobfuscate function
function deobfuscate(obfuscated: string): string {
  return decodeURIComponent(atob(obfuscated));
}

// Save credentials to sessionStorage (they persist until browser close)
function saveCredentialsToSession(): void {
  if (typeof window === 'undefined') return;
  
  try {
    const credentialsMap = getCredentialsMap();
    if (credentialsMap.size === 0) return;
    
    // Create a safe representation of credentials for session storage
    const sessionData: Record<string, { u: string, p: string, t: number }> = {};
    
    credentialsMap.forEach((cred, id) => {
      if (cred.username && cred.password) {
        sessionData[id] = {
          u: obfuscate(cred.username),
          p: obfuscate(cred.password),
          t: cred.timestamp || Date.now()
        };
      }
    });
    
    // Store in sessionStorage (cleared when browser closes)
    sessionStorage.setItem(SESSION_CREDS_KEY, JSON.stringify(sessionData));
    devLog(`[CredentialStore] Saved ${Object.keys(sessionData).length} credentials to session storage`);
    
    // Debug saved credentials 
    devLog(`[CredentialStore] Saved credentials for IDs: ${Object.keys(sessionData).join(', ')}`);
  } catch (e) {
    console.error(`[CredentialStore] Error saving credentials to session:`, e);
  }
}

// Restore credentials from sessionStorage
function restoreCredentialsFromSession(): void {
  if (typeof window === 'undefined') return;
  
  try {
    const sessionData = sessionStorage.getItem(SESSION_CREDS_KEY);
    if (!sessionData) {
      devLog(`[CredentialStore] No credential data found in session storage`);
      return;
    }
    
    const credentials = JSON.parse(sessionData) as Record<string, { u: string, p: string, t: number }>;
    const credentialsMap = getCredentialsMap();
    let restoredCount = 0;
    
    // Restore each credential
    Object.entries(credentials).forEach(([id, cred]) => {
      try {
        const username = deobfuscate(cred.u);
        const password = deobfuscate(cred.p);
        
        if (username && password) {
          credentialsMap.set(id, {
            username,
            password,
            timestamp: cred.t
          });
          restoredCount++;
          devLog(`[CredentialStore] Restored credential for: ${id}`);
        }
      } catch (e) {
        console.error(`[CredentialStore] Error restoring credential for ${id}:`, e);
      }
    });
    
    devLog(`[CredentialStore] Restored ${restoredCount} credentials from session storage`);
    devLog(`[CredentialStore] Credential IDs after restore: ${Array.from(credentialsMap.keys()).join(', ')}`);
  } catch (e) {
    console.error(`[CredentialStore] Error restoring credentials from session:`, e);
  }
}

/**
 * Store credentials for a registry in the global store
 * @param registry The registry (or any object with an id property)
 * @param credential The credentials to store
 */
export function storeCredential(registry: RegistryWithId | string, credential: Credential): void {
  // Handle both object and string registry ID formats
  const registryId = typeof registry === 'string' ? registry : registry.id;
  
  devLog(`[CredentialStore] STORING CREDENTIALS for registry ID: ${registryId}`);
  
  // Validate input parameters
  if (!registryId) {
    console.error(`[CredentialStore] Cannot store credential: Missing registry ID`);
    return;
  }
  
  if (!credential || !credential.username || !credential.password) {
    console.error(`[CredentialStore] Cannot store credential: Missing username or password for registry ${registryId}`);
    return;
  }
  
  // Add timestamp to track when the credential was stored
  const timestampedCredential: Credential = {
    ...credential,
    timestamp: Date.now()
  };
  
  // Get the global credentials map
  const credentialsMap = getCredentialsMap();
  
  // Store in the global map
  credentialsMap.set(registryId, timestampedCredential);
  
  // Also save to session storage for persistence across page refreshes
  saveCredentialsToSession();
  
  devLog(`[CredentialStore] ✅ STORED credentials for ${registryId}. Total stored: ${credentialsMap.size}`);
  devLog(`[CredentialStore] Registry IDs with credentials: ${Array.from(credentialsMap.keys()).join(', ')}`);
}

/**
 * Get credentials by registry ID
 * Checks for time expiration and removes expired credentials
 * @param registryId The ID of the registry
 * @returns The credentials, or null if not found or expired
 */
export function getCredentialById(registryId: string): Credential | null {
  if (!registryId) {
    console.warn(`[CredentialStore] Invalid registry ID provided`);
    return null;
  }

  // Get direct reference to the global credentials map
  const credentialsMap = getCredentialsMap();
  
  devLog(`[CredentialStore] LOOKING UP credentials for registry ID: ${registryId}`);
  devLog(`[CredentialStore] Store has ${credentialsMap.size} credentials. Keys: ${Array.from(credentialsMap.keys()).join(', ')}`);

  // Check if we have credentials for this ID
  if (!credentialsMap.has(registryId)) {
    devLog(`[CredentialStore] ⚠️ No credentials found for registry ID: ${registryId}`);
    return null;
  }

  const credential = credentialsMap.get(registryId)!;
  
  // Check if credential is expired (if it has a timestamp)
  if (credential.timestamp) {
    const now = Date.now();
    if (now - credential.timestamp > CREDENTIAL_TIMEOUT) {
      devLog(`[CredentialStore] Credentials for ${registryId} have expired, removing`);
      credentialsMap.delete(registryId);
      saveCredentialsToSession();
      return null;
    }
  }
  
  devLog(`[CredentialStore] ✅ FOUND credentials for ${registryId}. Username: ${credential.username}`);
  return credential;
}

/**
 * Get credentials for a registry object
 * @param registry The registry object or a string (registry ID or server)
 * @returns The credentials, or null if not found
 */
export function getCredential(registry: Registry | RegistryWithId | string): Credential | null {
  // If registry is a string, assume it's a registry ID
  if (typeof registry === 'string') {
    return getCredentialById(registry);
  }
  
  // Otherwise, it's a registry object
  if (!registry || !registry.id) {
    // If it has a server property but no id, try using server as the ID
    if ('server' in registry && registry.server) {
      return getCredentialById(registry.server);
    }
    return null;
  }
  
  // Try using the registry ID first
  let credentials = getCredentialById(registry.id);
  
  // If not found and it has a server property that's different from the ID,
  // try using the server as a fallback ID
  if (!credentials && 'server' in registry && registry.server && registry.server !== registry.id) {
    credentials = getCredentialById(registry.server);
  }
  
  return credentials;
}

/**
 * Clear credentials for a registry
 * @param registry The registry to clear credentials for
 */
export function clearCredential(registry: RegistryWithId | string): void {
  const registryId = typeof registry === 'string' ? registry : registry.id;
  
  if (!registryId) {
    return;
  }
  
  // Get direct reference to the global credentials map
  const credentialsMap = getCredentialsMap();
  
  if (credentialsMap.has(registryId)) {
    credentialsMap.delete(registryId);
    // Update session storage after deletion
    saveCredentialsToSession();
  }
}

/**
 * Check if credentials exist for a registry
 * @param registry The registry to check
 * @returns True if valid credentials exist, false otherwise
 */
export function hasCredential(registry: Registry | RegistryWithId): boolean {
  if (!registry || !registry.id) return false;
  
  // Get direct reference to the global credentials map
  const credentialsMap = getCredentialsMap();
  
  // Check if credential exists and is not expired
  const credential = credentialsMap.get(registry.id);
  if (!credential) return false;
  
  // Check if it's expired
  if (credential.timestamp && (Date.now() - credential.timestamp > CREDENTIAL_TIMEOUT)) {
    credentialsMap.delete(registry.id);
    saveCredentialsToSession(); // Update session storage after deletion
    return false;
  }
  
  return true;
}

/**
 * Clear all credentials from the store
 */
export function clearAllCredentials(): void {
  // Get direct reference to the global credentials map
  const credentialsMap = getCredentialsMap();
  credentialsMap.clear();
  
  // Clear session storage
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem(SESSION_CREDS_KEY);
    } catch (e) {
      console.error(`[CredentialStore] Error clearing session storage:`, e);
    }
  }
}

/**
 * Debug function to log the state of the credential store
 * Only used for debugging purposes
 */
export function debugAllCredentials(): void {
  // Get direct reference to the global credentials map
  const credentialsMap = getCredentialsMap();
  
  devLog(`[CredentialStore] Global store initialized at: ${GLOBAL_CREDENTIALS.__initialized}`);
  devLog(`[CredentialStore] Total credentials stored: ${credentialsMap.size}`);
  
  if (credentialsMap.size > 0) {
    devLog(`[CredentialStore] Registry IDs with stored credentials: ${Array.from(credentialsMap.keys()).join(', ')}`);
    
    // Log detailed credential info (masking passwords)
    credentialsMap.forEach((cred, id) => {
      devLog(`[CredentialStore] - ID: ${id}, Username: ${cred.username}, Password: (exists)`);
    });
  } else {
    devLog(`[CredentialStore] No credentials stored in global credential store`);
  }
}

/**
 * Alias for debugAllCredentials to maintain compatibility with existing code
 */
export function debugCredentialStore(): void {
  debugAllCredentials();
}

// Set up a timer to clean up expired credentials (only once)
if (!GLOBAL_CREDENTIALS.__cleanupTimer) {
  GLOBAL_CREDENTIALS.__cleanupTimer = setInterval(() => {
    const credentialsMap = getCredentialsMap();
    const now = Date.now();
    let changed = false;
    
    credentialsMap.forEach((credential: Credential, id: string) => {
      if (credential.timestamp && (now - credential.timestamp > CREDENTIAL_TIMEOUT)) {
        credentialsMap.delete(id);
        changed = true;
      }
    });
    
    // Update session storage if we deleted any credentials
    if (changed) {
      saveCredentialsToSession();
    }
  }, 60 * 1000);
}

// Export the interfaces for use in other modules
export type { Credential, RegistryWithId };

// Update the global type definition to avoid any type
interface GlobalWithCredentialStore {
  __GLOBAL_REGISTRY_CREDENTIAL_STORE_SINGLETON__?: Map<string, {
    username: string;
    password: string;
    timestamp: number;
  }>;
} 
