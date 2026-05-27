'use client';

import React from 'react';

export default function SkeletonTagGrid() {
  // Create an array of skeletons
  const skeletons = Array(8).fill(0);
  
  return (
    <div className="animate-pulse">
      {/* Skeleton for the table */}
      <div className="w-full overflow-x-auto">
        <div className="w-full border-collapse">
          {/* Skeleton header */}
          <div className="flex items-center h-12 bg-gray-100 dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700">
            <div className="px-4 w-1/4 h-4 bg-gray-300 dark:bg-slate-700 rounded"></div>
            <div className="px-4 w-1/4 h-4 bg-gray-300 dark:bg-slate-700 rounded"></div>
            <div className="px-4 w-1/4 h-4 bg-gray-300 dark:bg-slate-700 rounded"></div>
            <div className="px-4 w-1/4 h-4 bg-gray-300 dark:bg-slate-700 rounded"></div>
          </div>
          
          {/* Skeleton rows */}
          {skeletons.map((_, index) => (
            <div 
              key={index} 
              className="flex items-center h-14 border-b border-gray-200 dark:border-gray-700"
            >
              <div className="px-4 w-1/4">
                <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-3/4"></div>
              </div>
              <div className="px-4 w-1/4">
                <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-full"></div>
              </div>
              <div className="px-4 w-1/4">
                <div className="flex gap-2">
                  <div className="h-5 bg-gray-200 dark:bg-slate-700 rounded-full w-16"></div>
                  <div className="h-5 bg-gray-200 dark:bg-slate-700 rounded-full w-16"></div>
                </div>
              </div>
              <div className="px-4 w-1/4">
                <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
} 