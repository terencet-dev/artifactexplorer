import React from 'react';

const DigestSearchSkeleton: React.FC = () => {
  return (
    <div className="mb-6 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-slate-800 shadow">
      <div className="p-4 animate-pulse">
        <div className="flex flex-col space-y-4">
          {/* Banner skeleton */}
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
          
          {/* Progress bar skeleton */}
          <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
          
          {/* Text skeleton */}
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
        </div>
      </div>
      
      {/* Tag results skeleton */}
      <div className="border-t border-gray-200 dark:border-gray-700">
        <div className="p-4 animate-pulse">
          <div className="flex items-center justify-between py-3">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          </div>
          
          <div className="flex items-center justify-between py-3">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/5"></div>
          </div>
          
          <div className="flex items-center justify-between py-3">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          </div>
        </div>
      </div>
      
      {/* Search message skeleton */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-4">
        <div className="animate-pulse flex justify-center">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
        </div>
      </div>
    </div>
  );
};

export default DigestSearchSkeleton; 