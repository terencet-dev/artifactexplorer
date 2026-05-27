'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Referrer, Registry } from '@/app/types/registry';
import registryService from '@/app/services/registryService';
import { highlightSearchTerms, syntaxHighlightJson } from '@/app/utils/syntaxHighlight';
import CopyButton from '@/app/components/CopyButton';
import SbomViewerTab from '@/app/components/SbomViewerTab';
import { isSbomArtifact } from '@/app/utils/constants';

interface ArtifactManifestPanelProps {
  isOpen: boolean;
  onClose: () => void;
  referrer: Referrer | null;
  artifactTypeLabel: string;
  activeRegistry: Registry | null;
  repositoryName: string;
}

export default function ArtifactManifestPanel({
  isOpen,
  onClose,
  referrer,
  artifactTypeLabel,
  activeRegistry,
  repositoryName,
}: ArtifactManifestPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const [manifestText, setManifestText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const isSbom = isSbomArtifact(referrer?.artifactType);

  // Reset state when a new referrer is selected
  useEffect(() => {
    if (!referrer) return;
    setManifestText(null);
    setError(null);
    setSearchQuery('');
  }, [referrer]);

  // Fetch the artifact manifest when the panel opens
  useEffect(() => {
    if (!isOpen || !referrer || !activeRegistry) return;
    if (manifestText !== null) return; // already loaded

    const fetchManifest = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await registryService.getManifest(
          activeRegistry,
          repositoryName,
          referrer.digest
        );
        setManifestText(JSON.stringify(data, null, 2));
      } catch (err) {
        console.error('Error fetching artifact manifest:', err);
        setError(err instanceof Error ? err.message : 'Failed to load manifest');
      } finally {
        setLoading(false);
      }
    };

    fetchManifest();
  }, [isOpen, referrer, activeRegistry, repositoryName, manifestText]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [isOpen]);

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  const retry = useCallback(() => {
    setManifestText(null);
    setError(null);
  }, []);

  if (!isOpen || !referrer) return null;

  // Manifest content renderer — returns a fragment so children become
  // direct flex children of whatever container they're placed in.
  const renderManifestContent = () => (
    <>
      {/* Search */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <Input
          type="text"
          placeholder="Search in manifest..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full placeholder:text-gray-500 dark:placeholder:text-gray-400 text-gray-900 dark:text-gray-100"
          aria-label="Search in artifact manifest"
        />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-3/4" />
            <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-full" />
            <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-5/6" />
            <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-2/3" />
            <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-full" />
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-md">
            <p className="mb-3">Error: {error}</p>
            <button
              onClick={retry}
              className="px-4 py-2 text-sm font-medium rounded-md bg-red-100 hover:bg-red-200 text-red-800 dark:bg-red-800/30 dark:hover:bg-red-700/40 dark:text-red-200 transition-colors"
            >
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2v6h-6" />
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M3 12a9 9 0 0 0 6.7 15L13 21" />
                  <path d="M13 21h6v-6" />
                </svg>
                Retry
              </div>
            </button>
          </div>
        )}

        {manifestText && !loading && !error && (
          <div className="relative">
            <CopyButton
              text={manifestText}
              label="Copy manifest to clipboard"
              size={20}
              className="absolute top-2 right-2 p-2 text-gray-600 dark:text-gray-400 z-10"
            />
            <pre className="bg-white dark:bg-slate-800 p-4 rounded-md overflow-x-auto text-sm font-mono border border-gray-200 dark:border-gray-700">
              <code>
                {searchQuery.trim()
                  ? highlightSearchTerms(manifestText, searchQuery)
                  : syntaxHighlightJson(manifestText, searchQuery)}
              </code>
            </pre>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50 dark:bg-black/70"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={`Manifest for ${artifactTypeLabel} artifact`}
    >
      {/* Panel */}
      <div
        ref={panelRef}
        className={`relative w-full h-full bg-white dark:bg-slate-900 shadow-2xl flex flex-col
                   animate-in slide-in-from-right duration-200 transition-all
                   ${isExpanded ? 'max-w-[90vw]' : 'max-w-4xl'}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 mb-1">
              {artifactTypeLabel}
            </span>
            <div className="flex items-center gap-1">
              <p className="font-mono text-sm text-gray-700 dark:text-gray-300 break-all" title={referrer.digest}>
                {referrer.digest}
              </p>
              <CopyButton
                text={referrer.digest}
                label="Copy digest to clipboard"
                size={16}
                className="text-gray-500 dark:text-gray-400 flex-shrink-0"
              />
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Expand / Collapse toggle */}
            <button
              onClick={() => setIsExpanded((v) => !v)}
              className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              aria-label={isExpanded ? 'Collapse panel' : 'Expand panel'}
              title={isExpanded ? 'Collapse panel' : 'Expand panel'}
            >
              {isExpanded ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
            {/* Close button */}
            <button
              onClick={onClose}
              className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              aria-label="Close panel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content: tabbed for SBOM, single-view for others */}
        {isSbom && activeRegistry ? (
          <Tabs defaultValue="sbom" className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
              <TabsList className="bg-gray-100 dark:bg-slate-800">
                <TabsTrigger value="sbom">SBOM</TabsTrigger>
                <TabsTrigger value="manifest">Manifest</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="sbom" forceMount className="flex-1 min-h-0 flex flex-col m-0 data-[state=inactive]:hidden">
              <SbomViewerTab
                referrer={referrer}
                activeRegistry={activeRegistry}
                repositoryName={repositoryName}
              />
            </TabsContent>
            <TabsContent value="manifest" forceMount className="flex-1 min-h-0 flex flex-col m-0 data-[state=inactive]:hidden">
              {renderManifestContent()}
            </TabsContent>
          </Tabs>
        ) : (
          renderManifestContent()
        )}
      </div>
    </div>
  );
}
