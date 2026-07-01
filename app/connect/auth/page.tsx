'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import registryService from '@/app/services/registryService';
import { storeCredential, getCredentialById, debugCredentialStore, clearCredential } from '@/app/utils/credentialStore';
import RegistryConnectionError from '@/app/components/RegistryConnectionError';

export default function AuthConnectPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    registryLoginServer: '',
    username: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showConnectionError, setShowConnectionError] = useState(false);
  const [connectionErrorMessage, setConnectionErrorMessage] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value,
    });
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError('');
    
    try {
      // First validate inputs
      if (!formData.registryLoginServer.trim()) {
        setError('Registry server URL is required');
        setIsLoading(false);
        return;
      }
      
      if (!formData.username.trim() || !formData.password.trim()) {
        setError('Username and password are required');
        setIsLoading(false);
        return;
      }
      
      // Ensure registry URL is properly formatted (make sure it has http/https stripped)
      let serverUrl = formData.registryLoginServer.trim();
      serverUrl = serverUrl.replace(/^https?:\/\//, '');
      
      // Replace the URL in the form data
      // eslint-disable-next-line react-hooks/immutability -- mutating a prop is pre-existing; out of scope for OSS release
      formData.registryLoginServer = serverUrl;
      
      console.log(`[Connect Auth] Connecting to registry: ${serverUrl}`);
      
      // Try to store credentials directly first, using the server URL as the ID
      // This stores credentials before registry is even added
      try {
        console.log(`[Connect Auth] Storing credentials to credential store...`);
        debugCredentialStore();
        
        // First, try to clear any existing credentials to avoid conflicts
        try {
          clearCredential(serverUrl);
        } catch (clearError) {
          console.error(`[Connect Auth] Error clearing existing credentials:`, clearError);
        }
        
        // Store credentials in credential store with server URL as key
        storeCredential(serverUrl, {
          username: formData.username,
          password: formData.password
        });
        
        const storedCreds = getCredentialById(serverUrl);
        if (!storedCreds) {
          console.error(`[Connect Auth] CRITICAL: Failed to store credentials for ${serverUrl}`);
        } else {
          console.log(`[Connect Auth] Successfully stored credentials for ${serverUrl}`);
        }
      } catch (credentialError) {
        console.error(`[Connect Auth] Error storing credentials directly:`, credentialError);
      }
      
      // Try to validate and add the registry
      console.log(`[Connect Auth] Validating and adding registry...`);
      const validationResult = await registryService.validateAndAddRegistry({
        type: 'authenticated' as const,
        server: serverUrl,
        username: formData.username,
        password: formData.password,
      });
      
      if (!validationResult.success) {
        console.error(`[Connect Auth] Registry validation failed: ${validationResult.error}`);
        setConnectionErrorMessage(validationResult.error || `Failed to connect to ${serverUrl}. Please check your credentials and try again.`);
        setShowConnectionError(true);
        return;
      }
      
      const registryId = validationResult.registryId;
      if (!registryId) {
        console.error('[Connect Auth] No registry ID returned after validation');
        setError('Failed to add registry. Please try again.');
        return;
      }
      
      console.log(`[Connect Auth] Registry validated and added with ID: ${registryId}`);
      
      // If the registry ID is different from server URL, store credentials with registry ID too
      if (registryId !== serverUrl) {
        console.log(`[Connect Auth] Registry ID (${registryId}) differs from server URL (${serverUrl})`);
        console.log(`[Connect Auth] Also storing credentials with registry ID as key`);
        
        try {
          storeCredential(registryId, {
            username: formData.username,
            password: formData.password
          });
        } catch (e) {
          console.error(`[Connect Auth] Error storing credentials with registry ID:`, e);
        }
      }
      
      // One final verification
      try {
        console.log(`[Connect Auth] Final verification of credential storage:`);
        debugCredentialStore();
        
        // Check with both server URL and registry ID
        const finalCheck = getCredentialById(registryId) || getCredentialById(serverUrl);
        if (!finalCheck) {
          console.error(`[Connect Auth] WARNING: Still no credentials found after adding registry`);
          
          // One last direct store attempt as fallback - try both keys
          console.log(`[Connect Auth] Last attempt to store credentials for both keys`);
          storeCredential(registryId, {
            username: formData.username,
            password: formData.password
          });
          
          storeCredential(serverUrl, {
            username: formData.username,
            password: formData.password
          });
        } else {
          console.log(`[Connect Auth] Verification successful - credentials found`);
        }
      } catch (e) {
        console.error(`[Connect Auth] Error during final verification:`, e);
      }
      
      // Add a short delay before navigating to ensure all registry events are processed
      setTimeout(() => {
        router.push('/registry');
      }, 250);
    } catch (err) {
      console.error('[Connect Auth] Error connecting to registry:', err);
      setError(`Error connecting to registry: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center flex-grow w-full p-6">
      <div className="w-full max-w-lg p-8 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700">
        <h2 className="text-2xl font-semibold mb-6 text-center text-primaryBlue dark:text-blue-400">Connect to Registry</h2>
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-md">
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="registryLoginServer" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Registry Login Server URL
            </label>
            <input
              type="text"
              id="registryLoginServer"
              name="registryLoginServer"
              placeholder="myregistry.azurecr.io"
              value={formData.registryLoginServer}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-secondaryBlue dark:focus:ring-blue-500 text-gray-900 dark:text-white dark:bg-slate-700 dark:placeholder-gray-400"
              required
            />
          </div>
          
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Username
            </label>
            <input
              type="text"
              id="username"
              name="username"
              value={formData.username}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-secondaryBlue dark:focus:ring-blue-500 text-gray-900 dark:text-white dark:bg-slate-700 dark:placeholder-gray-400"
              required
            />
          </div>
          
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password
            </label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-secondaryBlue dark:focus:ring-blue-500 text-gray-900 dark:text-white dark:bg-slate-700 dark:placeholder-gray-400"
              required
            />
          </div>
          
          <div className="pt-4">
            <button
              type="submit"
              disabled={isLoading}
              className={`w-full px-6 py-3 rounded-md bg-primaryBlue text-white font-medium hover:bg-opacity-90 transition-colors ${
                isLoading ? 'opacity-70 cursor-not-allowed' : ''
              }`}
            >
              {isLoading ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
      
      {/* Registry connection error dialog */}
      <RegistryConnectionError 
        isOpen={showConnectionError}
        message={connectionErrorMessage}
        onClose={() => setShowConnectionError(false)}
      />
    </div>
  );
} 