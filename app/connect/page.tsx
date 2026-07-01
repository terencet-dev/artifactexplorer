'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ConnectPage() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  const handleAuthChoice = (authChoice: boolean) => {
    setIsAuthenticated(authChoice);
    router.push(authChoice ? '/connect/auth' : '/connect/noauth');
  };

  return (
    <div className="flex flex-col items-center justify-center flex-grow w-full p-6">
      <div className="w-full max-w-lg p-8 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700">
        <h2 className="text-2xl font-semibold mb-6 text-center text-primaryBlue dark:text-blue-400">Registry Authentication</h2>
        <p className="mb-8 text-gray-600 dark:text-gray-300 text-center">
          Is your registry authenticated or anonymous?
        </p>
        
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
          <button
            onClick={() => handleAuthChoice(true)}
            className="px-6 py-3 rounded-md bg-primaryBlue dark:bg-blue-600 text-white font-medium hover:bg-opacity-90 transition-colors flex-1"
          >
            Authenticated
          </button>
          <button
            onClick={() => handleAuthChoice(false)}
            className="px-6 py-3 rounded-md bg-primaryBlue dark:bg-blue-600 text-white font-medium hover:bg-opacity-90 transition-colors flex-1"
          >
            Anonymous
          </button>
        </div>
      </div>
    </div>
  );
} 