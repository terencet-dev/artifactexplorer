import React from 'react';

interface DigestSearchBannerProps {
  isSearching: boolean;
  foundCount: number;
  searchedCount: number;
  totalToSearch: number;
  progress: number;
  searchQuery: string;
}

const DigestSearchBanner: React.FC<DigestSearchBannerProps> = ({
  isSearching,
  foundCount,
  searchedCount,
  totalToSearch,
  progress,
  searchQuery,
}) => {
  // Don't show anything if we're not searching
  if (!isSearching) {
    return null;
  }

  // Extract just the digest part for display (remove "sha256:" prefix if present)
  const displayDigest = searchQuery.includes(':') 
    ? searchQuery 
    : searchQuery.length > 12 
      ? `${searchQuery.substring(0, 12)}...` 
      : searchQuery;

  return (
    <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <div className="text-blue-700 dark:text-blue-300 font-medium">
            Found <span className="font-bold">{foundCount}</span> artifacts with matching digest{" "}
            <span className="font-mono bg-blue-100 dark:bg-blue-800/50 px-1.5 py-0.5 rounded text-sm">
              {displayDigest}
            </span>
          </div>
          
          <div className="text-sm text-blue-600 dark:text-blue-400">
            {searchedCount < totalToSearch ? (
              <span>
                Searched {searchedCount}/{totalToSearch} tags...
              </span>
            ) : (
              <span>Search complete</span>
            )}
          </div>
        </div>
        
        {searchedCount < totalToSearch && (
          <>
            <div className="h-1.5 w-full bg-blue-100 dark:bg-blue-800/30 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              Please wait while we look for more matches
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default DigestSearchBanner; 