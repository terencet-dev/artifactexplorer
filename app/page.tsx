'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from "next/image";
import registryService from '@/app/services/registryService';
import SessionInfo from '@/app/components/SessionInfo';

export default function Home() {
  const [hasRegistries, setHasRegistries] = useState(false);
  const [registriesCount, setRegistriesCount] = useState(0);
  
  useEffect(() => {
    // Check if any registries are available
    const registries = registryService.getAllRegistries();
    setHasRegistries(registries.length > 0);
    setRegistriesCount(registries.length);
    
    // Listen for registry changes
    const handleRegistryChanged = () => {
      const updatedRegistries = registryService.getAllRegistries();
      setHasRegistries(updatedRegistries.length > 0);
      setRegistriesCount(updatedRegistries.length);
    };
    
    window.addEventListener('registry-changed', handleRegistryChanged);
    
    return () => {
      window.removeEventListener('registry-changed', handleRegistryChanged);
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-6 px-4 flex-grow">
      <div className="w-full max-w-lg p-6 bg-white dark:bg-slate-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 text-center">
        <h2 className="text-2xl font-semibold mb-4 text-primaryBlue dark:text-blue-400">Welcome to Artifact Explorer</h2>
        <p className="mb-4 text-gray-600 dark:text-gray-300">
          Connect to any OCI-compatible registry such as Azure Container Registry and  
          Microsoft Artifact Registry
        </p>
        
        {hasRegistries ? (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-md text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <p>You have {registriesCount} {registriesCount === 1 ? 'registry' : 'registries'} already connected.</p>
            <div className="mt-2 flex gap-4 justify-center">
              <Link 
                href="/registry" 
                className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
              >
                View Repositories
              </Link>
              <Link 
                href="/connect" 
                className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
              >
                Add Another Registry
              </Link>
            </div>
          </div>
        ) : (
          <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-md text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
            <p>Sessions expire after 24 hours of inactivity or when you close your browser for an extended period.</p>
          </div>
        )}
        
        <Link 
          href={hasRegistries ? "/registry" : "/connect"}
          className="inline-block px-5 py-2 rounded-md bg-primaryBlue dark:bg-blue-600 text-white font-medium hover:bg-opacity-90 transition-colors"
        >
          {hasRegistries ? 'View Repository Catalog' : 'Get Started'}
        </Link>
        
        <SessionInfo />
      </div>
    </div>
  );
}
