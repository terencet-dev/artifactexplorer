'use client';

import { useState, useEffect } from 'react';

interface RegistryConnectionErrorProps {
  isOpen: boolean;
  message: string;
  onClose: () => void;
}

export default function RegistryConnectionError({ 
  isOpen, 
  message, 
  onClose 
}: RegistryConnectionErrorProps) {
  const [isVisible, setIsVisible] = useState(false);
  
  // Control animation states
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else {
      // Delay hiding to allow animation to complete
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);
  
  if (!isOpen && !isVisible) return null;
  
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${isOpen ? 'bg-black bg-opacity-50' : ''}`} style={{ transition: 'background-color 200ms ease-in-out' }}>
      <div 
        className={`bg-white dark:bg-slate-800 rounded-lg shadow-xl p-6 max-w-md w-full border border-gray-200 dark:border-gray-700 transform ${isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        style={{ transition: 'transform 200ms ease-in-out, opacity 200ms ease-in-out' }}
      >
        <div className="flex items-start mb-4">
          <div className="flex-shrink-0 mr-3">
            <svg className="h-6 w-6 text-red-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Registry Connection Error</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{message}</p>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
} 