'use client';

import React from 'react';

export default function SkeletonTagDetail() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 dark:bg-slate-700 rounded w-1/3"></div>
        <div className="space-y-3">
          <div className="flex items-center">
            <div className="w-32 h-5 bg-gray-200 dark:bg-slate-700 rounded"></div>
            <div className="ml-2 h-5 bg-gray-200 dark:bg-slate-700 rounded w-3/5"></div>
          </div>
          <div className="flex items-center">
            <div className="w-32 h-5 bg-gray-200 dark:bg-slate-700 rounded"></div>
            <div className="flex gap-2">
              <div className="h-5 w-20 bg-gray-200 dark:bg-slate-700 rounded"></div>
              <div className="h-5 w-16 bg-gray-200 dark:bg-slate-700 rounded"></div>
            </div>
          </div>
          <div className="flex items-center">
            <div className="w-32 h-5 bg-gray-200 dark:bg-slate-700 rounded"></div>
            <div className="ml-2 h-5 bg-gray-200 dark:bg-slate-700 rounded w-20"></div>
          </div>
          <div className="flex items-center">
            <div className="w-32 h-5 bg-gray-200 dark:bg-slate-700 rounded"></div>
            <div className="ml-2 h-5 bg-gray-200 dark:bg-slate-700 rounded w-1/2"></div>
          </div>
        </div>
      </div>
      
      {/* Tabs skeleton */}
      <div className="space-y-4">
        <div className="flex space-x-2">
          <div className="h-10 w-24 bg-gray-200 dark:bg-slate-700 rounded"></div>
          <div className="h-10 w-40 bg-gray-200 dark:bg-slate-700 rounded"></div>
        </div>
        
        {/* Search input skeleton */}
        <div className="h-10 w-full bg-gray-200 dark:bg-slate-700 rounded"></div>
        
        {/* Content skeleton */}
        <div className="space-y-2">
          <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-full"></div>
          <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-11/12"></div>
          <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-full"></div>
          <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-3/4"></div>
          <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-full"></div>
          <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-5/6"></div>
          <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-full"></div>
          <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-4/5"></div>
        </div>
      </div>
    </div>
  );
} 