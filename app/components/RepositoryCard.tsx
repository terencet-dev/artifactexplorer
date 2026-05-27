'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Repository } from '@/app/types/registry';

interface RepositoryCardProps {
  repository: Repository;
  showRegistry?: boolean;
  registryName?: string;
  highlightTerm?: string;
  highlightRepoTerm?: string;
}

// Helper function to highlight a term within text
const HighlightedText = ({ text, highlight }: { text: string | Repository | any; highlight?: string }) => {
  // Handle case where text might be a Repository object
  const textValue = typeof text === 'object' && text !== null && 'name' in text 
    ? text.name 
    : (typeof text === 'string' ? text : String(text || ''));
  
  if (!highlight || !textValue) return <>{textValue}</>;
  
  const parts = textValue.split(new RegExp(`(${highlight})`, 'gi'));
  
  return (
    <>
      {parts.map((part: string, i: number) => 
        part.toLowerCase() === highlight.toLowerCase() ? 
          <span key={i} className="bg-amber-100 dark:bg-amber-600/40 text-amber-900 dark:text-amber-50 px-0.5 rounded">{part}</span> : part
      )}
    </>
  );
};

export default function RepositoryCard({ 
  repository, 
  showRegistry = false, 
  registryName, 
  highlightTerm,
  highlightRepoTerm
}: RepositoryCardProps) {
  const [isVisible, setIsVisible] = useState(false);
  
  // Add a fade-in effect
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 50);
    
    return () => clearTimeout(timer);
  }, []);
  
  // Build the URL with registry ID as query parameter if available
  const repoUrl = repository.registryId
    ? `/registry/${encodeURIComponent(repository.name)}?registry=${repository.registryId}`
    : `/registry/${encodeURIComponent(repository.name)}`;

  return (
    <Link 
      href={repoUrl}
      className={`block p-5 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all hover:border-blue-200 dark:hover:border-blue-700 h-full cursor-pointer ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      style={{ transition: 'opacity 150ms ease-in-out, border-color 150ms ease-in-out, box-shadow 150ms ease-in-out' }}
      prefetch={true}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-800 dark:text-gray-200 text-lg mb-1 truncate" title={repository.name}>
            <HighlightedText 
              text={repository.name} 
              highlight={highlightRepoTerm}
            />
          </h3>
          {showRegistry && (
            <div className="text-sm text-gray-600 dark:text-gray-400 mt-2 flex items-center">
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                className="h-4 w-4 mr-1.5 text-gray-500 dark:text-gray-400 flex-shrink-0" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" 
                />
              </svg>
              <span className="truncate" title={registryName || repository.registry}>
                <HighlightedText 
                  text={registryName || repository.registry} 
                  highlight={highlightTerm}
                />
              </span>
            </div>
          )}
        </div>
        <div className="text-blue-500 dark:text-blue-400 mt-1 ml-2 flex-shrink-0">
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            className="h-5 w-5" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M9 5l7 7-7 7" 
            />
          </svg>
        </div>
      </div>
    </Link>
  );
} 