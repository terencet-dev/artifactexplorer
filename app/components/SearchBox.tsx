'use client';

import { useState, useCallback, useEffect, memo, useRef } from 'react';

interface SearchBoxProps {
  placeholder: string;
  onSearch: (query: string) => void;
  initialQuery?: string;
}

const DEBOUNCE_DELAY = 300; // Reduced delay for more responsive feel

const SearchBox = memo(function SearchBox({ 
  placeholder, 
  onSearch, 
  initialQuery = '' 
}: SearchBoxProps) {
  const [query, setQuery] = useState(initialQuery);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onSearchRef = useRef(onSearch); // Store onSearch in a ref to avoid dependencies issues
  
  // Keep onSearchRef updated when onSearch changes
  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  // Update query when initialQuery prop changes, but only if not focused
  useEffect(() => {
    // Only update if initialQuery has changed from previous prop value
    // and the input is not currently focused
    if (initialQuery !== query && document.activeElement !== inputRef.current) {
      setQuery(initialQuery);
    }
  }, [initialQuery, query]);

  // Debounce search input to avoid excessive search calls
  const debouncedSearch = useCallback((searchQuery: string) => {
    // Clear any existing timeout
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    // Set a new timeout
    debounceTimerRef.current = setTimeout(() => {
      onSearchRef.current(searchQuery);
      debounceTimerRef.current = null;
    }, DEBOUNCE_DELAY);
  }, []); // No dependencies needed since we use ref

  // Handle input change
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setQuery(newValue);
    debouncedSearch(newValue);
  }, [debouncedSearch]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Immediate search on submit
  const handleSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    // Call search immediately
    onSearchRef.current(query);
  }, [query]);

  // Clear search
  const handleClear = useCallback(() => {
    setQuery('');
    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    // Search with empty string immediately
    onSearchRef.current('');
    // Focus the input after clearing
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          placeholder={placeholder}
          className="w-full px-4 py-2 pl-10 pr-10 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-secondaryBlue dark:focus:ring-blue-500 text-gray-900 dark:text-white bg-white dark:bg-slate-800 placeholder-gray-400 dark:placeholder-gray-500"
          aria-label="Search input"
        />
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <svg
            className="h-5 w-5 text-gray-400 dark:text-gray-500"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute inset-y-0 right-0 pr-3 flex items-center"
            aria-label="Clear search"
          >
            <svg
              className="h-5 w-5 text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
});

export default SearchBox; 