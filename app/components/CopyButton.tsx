'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';

interface CopyButtonProps {
  /** The text to copy to clipboard */
  text: string;
  /** Optional label for the button title/aria-label (default: "Copy to clipboard") */
  label?: string;
  /** Icon size in pixels (default: 16) */
  size?: number;
  /** Extra CSS classes for the button */
  className?: string;
  /** Optional callback after copying */
  onCopy?: () => void;
  /** Duration to show the checkmark in ms (default: 2000) */
  feedbackDuration?: number;
  /** External control: if true, show the copied checkmark */
  isCopied?: boolean;
}

/**
 * A reusable copy-to-clipboard button with clipboard/checkmark icon toggle.
 */
export default function CopyButton({
  text,
  label = 'Copy to clipboard',
  size = 16,
  className = '',
  onCopy,
  feedbackDuration = 2000,
  isCopied: externalCopied,
}: CopyButtonProps) {
  const [internalCopied, setInternalCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copied = externalCopied ?? internalCopied;

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        setInternalCopied(true);
        onCopy?.();

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setInternalCopied(false), feedbackDuration);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    },
    [text, onCopy, feedbackDuration],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <button
      onClick={handleCopy}
      className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${className}`}
      title={copied ? 'Copied!' : label}
      aria-label={copied ? 'Copied!' : label}
    >
      {copied ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-green-500"
          aria-hidden="true"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-gray-400 dark:text-gray-500"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
    </button>
  );
}
