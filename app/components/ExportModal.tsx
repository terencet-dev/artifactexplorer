'use client';

import { useEffect, useRef, useState, useCallback, memo } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportField {
  key: string;
  label: string;
}

export interface ExportOptions {
  scope: 'current' | 'range' | 'all';
  rangeStart?: number;
  rangeEnd?: number;
  selectedFields: string[];
}

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'sbom' | 'eol';
  currentPage: number;
  totalPages: number;
  pageSize: number;
  fields: ExportField[];
  /** Called when the user clicks Export. Should resolve when export is complete.
   *  `onProgress` should be called with a value 0–100 as pages are fetched. */
  onExport: (options: ExportOptions, onProgress: (pct: number) => void) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ExportModal = memo(function ExportModal({
  isOpen,
  onClose,
  mode,
  currentPage,
  totalPages,
  pageSize,
  fields,
  onExport,
}: ExportModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // --- state ---
  const [scope, setScope] = useState<'current' | 'range' | 'all'>('current');
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(1);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set(fields.map(f => f.key)));
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setScope('current');
      setRangeStart(currentPage);
      setRangeEnd(Math.min(currentPage + 2, totalPages));
      setSelectedFields(new Set(fields.map(f => f.key)));
      setExporting(false);
      setProgress(0);
    }
  }, [isOpen, currentPage, totalPages, fields]);

  // Click outside to close (only when not exporting)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!exporting && modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'auto';
    };
  }, [isOpen, onClose, exporting]);

  // Escape key
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose, exporting]);

  // --- field selection helpers ---
  const toggleField = (key: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const allSelected = selectedFields.size === fields.length;

  const toggleAll = () => {
    if (allSelected) setSelectedFields(new Set());
    else setSelectedFields(new Set(fields.map(f => f.key)));
  };

  // --- export handler ---
  const handleExport = useCallback(async () => {
    if (selectedFields.size === 0) return;
    setExporting(true);
    setProgress(0);
    try {
      await onExport(
        {
          scope,
          rangeStart: scope === 'range' ? rangeStart : undefined,
          rangeEnd: scope === 'range' ? rangeEnd : undefined,
          selectedFields: Array.from(selectedFields),
        },
        (pct: number) => setProgress(pct),
      );
      onClose();
    } catch (err) {
      console.error('Export failed:', err);
      setExporting(false);
      setProgress(0);
    }
  }, [scope, rangeStart, rangeEnd, selectedFields, onExport, onClose]);

  if (!isOpen) return null;

  const title = mode === 'sbom' ? 'Export SBOM Results' : 'Export EOL Results';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 dark:bg-black dark:bg-opacity-70">
      <div
        ref={modalRef}
        className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-lg w-full mx-4 overflow-hidden"
      >
        {/* Header */}
        <div className="p-5 border-b dark:border-slate-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Section 1: Export Scope */}
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Export scope</p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio" name="scope" value="current" checked={scope === 'current'}
                  onChange={() => setScope('current')} disabled={exporting}
                  className="accent-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Current page ({currentPage} of {totalPages})
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio" name="scope" value="range" checked={scope === 'range'}
                  onChange={() => setScope('range')} disabled={exporting || totalPages <= 1}
                  className="accent-blue-600"
                />
                <span className={`text-sm ${totalPages <= 1 ? 'text-gray-400 dark:text-gray-600' : 'text-gray-700 dark:text-gray-300'}`}>
                  Select pages
                </span>
              </label>

              {scope === 'range' && (
                <div className="ml-6 flex items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">From</span>
                  <input
                    type="number" min={1} max={totalPages}
                    value={rangeStart}
                    onChange={(e) => setRangeStart(Math.max(1, Math.min(totalPages, parseInt(e.target.value) || 1)))}
                    disabled={exporting}
                    className="w-16 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">to</span>
                  <input
                    type="number" min={1} max={totalPages}
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(Math.max(1, Math.min(totalPages, parseInt(e.target.value) || 1)))}
                    disabled={exporting}
                    className="w-16 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                  />
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    (~{(Math.max(0, rangeEnd - rangeStart + 1)) * pageSize} rows)
                  </span>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio" name="scope" value="all" checked={scope === 'all'}
                  onChange={() => setScope('all')} disabled={exporting}
                  className="accent-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  All pages ({totalPages} {totalPages === 1 ? 'page' : 'pages'})
                </span>
              </label>
            </div>
          </div>

          {/* Section 2: Field Selection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Fields to include</p>
              <button
                onClick={toggleAll}
                disabled={exporting}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {fields.map((f) => (
                <label key={f.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedFields.has(f.key)}
                    onChange={() => toggleField(f.key)}
                    disabled={exporting}
                    className="accent-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{f.label}</span>
                </label>
              ))}
            </div>
            {selectedFields.size === 0 && (
              <p className="text-xs text-red-500 mt-1">Select at least one field.</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 dark:bg-slate-700 space-y-3">
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={exporting}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white rounded-md bg-gray-100 dark:bg-slate-600 hover:bg-gray-200 dark:hover:bg-slate-500 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || selectedFields.size === 0}
              className="px-4 py-2 text-sm font-medium text-white rounded-md bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed min-w-[100px]"
            >
              {exporting ? 'Exporting...' : 'Export'}
            </button>
          </div>

          {/* Progress bar */}
          {exporting && (
            <div className="w-full bg-gray-200 dark:bg-slate-600 rounded-full h-2 overflow-hidden">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${Math.max(2, progress)}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default ExportModal;
