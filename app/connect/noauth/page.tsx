'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import registryService from '@/app/services/registryService';
import { REGISTRY_EVENTS } from '@/app/utils/constants';
import RegistryConnectionError from '@/app/components/RegistryConnectionError';

export default function NoAuthConnectPage() {
  const router = useRouter();
  const [registryLoginServer, setRegistryLoginServer] = useState('mcr.microsoft.com');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showConnectionError, setShowConnectionError] = useState(false);
  const [connectionErrorMessage, setConnectionErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!registryLoginServer.trim()) {
      setError('Registry login server cannot be empty');
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      // Ensure the URL format is correct
      let serverUrl = registryLoginServer.trim();
      serverUrl = serverUrl.replace(/^https?:\/\//, '');
      
      // Validate and add the registry in one step
      console.log(`[Connect NoAuth] Validating and adding registry: ${serverUrl}`);
      
      const validationResult = await registryService.validateAndAddRegistry({
        type: 'anonymous',
        server: serverUrl,
      });
      
      if (!validationResult.success) {
        console.error(`[Connect NoAuth] Registry validation failed: ${validationResult.error}`);
        setConnectionErrorMessage(validationResult.error || `Failed to connect to ${serverUrl}. Please check your connection and try again.`);
        setShowConnectionError(true);
        return;
      }
      
      const registryId = validationResult.registryId;
      if (!registryId) {
        console.error('[Connect NoAuth] No registry ID returned after validation');
        setError('Failed to add registry. Please try again.');
        return;
      }
      
      console.log(`[Connect NoAuth] Registry validated and added with ID: ${registryId}`);
      
      // Dispatch event to notify other components about the registry change
      const event = new CustomEvent(REGISTRY_EVENTS.REGISTRY_CHANGED, {
        detail: { registry: registryId, registryAdded: true }
      });
      window.dispatchEvent(event);
      
      // Navigate to repository catalog
      router.push('/registry');
    } catch (err) {
      console.error('Failed to connect to registry:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect to registry');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center flex-grow w-full p-6">
      <div className="w-full max-w-lg p-8 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700">
        <h2 className="text-2xl font-semibold mb-6 text-center text-primaryBlue dark:text-blue-400">Connect to Anonymous Registry</h2>
        
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
              placeholder="mcr.microsoft.com"
              value={registryLoginServer}
              onChange={(e) => setRegistryLoginServer(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-secondaryBlue dark:focus:ring-blue-500 text-gray-900 dark:text-white dark:bg-slate-700 dark:placeholder-gray-400"
              required
            />
          </div>
          
          <div className="pt-4">
            <button
              type="submit"
              disabled={isLoading}
              className={`w-full px-6 py-3 rounded-md bg-primaryBlue dark:bg-blue-600 text-white font-medium hover:bg-opacity-90 transition-colors ${
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