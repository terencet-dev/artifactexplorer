// Define a simple credential entry type
interface CredentialEntry {
  username: string;
  password: string;
  timestamp: number;
}

// Extend global interfaces
declare global {
  // Extend the global object
  let __GLOBAL_REGISTRY_CREDENTIAL_STORE_SINGLETON__: Map<string, CredentialEntry> | undefined;
  
  // Extend window interface
  interface Window {
    __GLOBAL_REGISTRY_CREDENTIAL_STORE_SINGLETON__: Map<string, CredentialEntry> | undefined;
  }
  
  // Extend NodeJS namespace
  namespace NodeJS {
    interface Global {
      __GLOBAL_REGISTRY_CREDENTIAL_STORE_SINGLETON__: Map<string, CredentialEntry> | undefined;
    }
  }
} 