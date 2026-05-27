'use client';

import { useEffect } from 'react';

/**
 * Optional Microsoft Clarity analytics loader.
 *
 * Loads Clarity only in production AND only when `NEXT_PUBLIC_CLARITY_PROJECT_ID`
 * is set in the environment. If the env var is missing the component renders
 * nothing and no analytics code is loaded — keeping the OSS default privacy-friendly.
 */
export default function ClarityAnalytics() {
  useEffect(() => {
    const projectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;
    if (
      typeof window !== 'undefined' &&
      process.env.NODE_ENV === 'production' &&
      projectId
    ) {
      try {
        import('@microsoft/clarity')
          .then((Clarity) => {
            Clarity.default.init(projectId);
          })
          .catch((error) => {
            console.warn('Clarity analytics failed to load:', error);
          });
      } catch (error) {
        console.warn('Error initializing analytics:', error);
      }
    }
  }, []);

  return null;
} 