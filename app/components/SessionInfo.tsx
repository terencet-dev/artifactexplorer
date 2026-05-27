'use client';

import { useState, useEffect } from 'react';
import registryService from '@/app/services/registryService';
import { SESSION_DURATION_MS, STORAGE_KEYS } from '@/app/utils/constants';
import { removeStorageItem } from '@/app/utils/storage';
import ConfirmationModal from './ConfirmationModal';

export default function SessionInfo() {
  const [sessionExpiry, setSessionExpiry] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  
  useEffect(() => {
    const updateSessionTime = () => {
      // Use getStorageItem which properly handles parsing
      const lastActive = localStorage.getItem(STORAGE_KEYS.SESSION_LAST_ACTIVE);
      
      if (lastActive) {
        // Ensure we have a valid number before parsing
        const lastActiveTime = parseInt(lastActive);
        
        if (!isNaN(lastActiveTime)) {
          const expiryTime = lastActiveTime + SESSION_DURATION_MS;
          const expiryDate = new Date(expiryTime);
          
          // Format the expiry time
          const options: Intl.DateTimeFormatOptions = {
            weekday: 'short',
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          };
          
          // Ensure date is valid before formatting
          if (!isNaN(expiryDate.getTime())) {
            const formattedExpiry = expiryDate.toLocaleDateString(undefined, options);
            
            // Only show if session actually exists
            if (registryService.getAllRegistries().length > 0) {
              setSessionExpiry(formattedExpiry);
              setShowInfo(true);
              return;
            }
          }
        }
      }
      
      // Fall through to here means no valid session
      setShowInfo(false);
    };
    
    updateSessionTime();
    
    const interval = setInterval(updateSessionTime, 60000); // Update every minute
    
    // Update when registry changes
    const handleRegistryChanged = () => {
      updateSessionTime();
    };
    
    window.addEventListener('registry-changed', handleRegistryChanged);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('registry-changed', handleRegistryChanged);
    };
  }, []);
  
  if (!showInfo) return null;
  
  const handleClearSessionClick = () => {
    setShowConfirmModal(true);
  };
  
  const handleConfirmClearSession = () => {
    // Clear all registries
    registryService.clearAllRegistries();
    
    setShowInfo(false);
    setShowConfirmModal(false);
  };
  
  const handleCancelClearSession = () => {
    setShowConfirmModal(false);
  };
  
  return (
    <>
      <div className="text-xs text-gray-400 dark:text-gray-500 mt-4 cursor-help" title="Your registry connections will expire after 24 hours of inactivity">
        <span>Session expires: {sessionExpiry}</span>
        <button 
          onClick={handleClearSessionClick}
          className="ml-2 text-blue-400 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
        >
          Clear Now
        </button>
      </div>
      
      <ConfirmationModal
        isOpen={showConfirmModal}
        onClose={handleCancelClearSession}
        onConfirm={handleConfirmClearSession}
        title="Clear Session"
        message="Are you sure you want to clear all registry data and end your session? This will remove all your registry connections."
        confirmText="Yes, Clear Session"
        cancelText="Cancel"
      />
    </>
  );
} 