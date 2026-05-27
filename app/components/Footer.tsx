'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import ChangelogModal from './ChangelogModal';
import { APP_VERSION } from '@/app/utils/constants';

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const [mounted, setMounted] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [changelog, setChangelog] = useState('');

  useEffect(() => {
    setMounted(true);

    fetch(`/api/changelog?t=${Date.now()}`)
      .then((response) => response.text())
      .then((data) => {
        setChangelog(data);
      })
      .catch((error) => {
        console.error('Error loading changelog:', error);
        setChangelog('# Changelog\n\nUnable to load changelog data.');
      });
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <>
      <footer className="w-full py-4 border-t border-gray-200 bg-white dark:bg-slate-800 dark:border-slate-700 flex-shrink-0 mt-auto">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              <div className="select-none">
                &copy; {currentYear} Artifact Explorer. All rights reserved.
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                <button
                  onClick={() => setShowChangelog(true)}
                  className="hover:text-primaryBlue dark:hover:text-blue-400 focus:outline-none transition-colors"
                  aria-label="View changelog"
                >
                  {APP_VERSION}
                </button>
              </div>
            </div>
            <div className="flex space-x-6 mt-4 md:mt-0">
              <Link
                href="/terms"
                className="text-sm text-gray-500 hover:text-primaryBlue dark:text-gray-400 dark:hover:text-blue-400"
              >
                Terms of Use
              </Link>
              <Link
                href="/privacy"
                className="text-sm text-gray-500 hover:text-primaryBlue dark:text-gray-400 dark:hover:text-blue-400"
              >
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>
      </footer>

      <ChangelogModal
        isOpen={showChangelog}
        onClose={() => setShowChangelog(false)}
        version={APP_VERSION}
        changelog={changelog}
      />
    </>
  );
}
