'use client';

import { useEffect, useRef, memo } from 'react';

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
  version: string;
  changelog: string;
}

const ChangelogModal = memo(function ChangelogModal({
  isOpen,
  onClose,
  version,
  changelog
}: ChangelogModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  
  // Handle clicking outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Prevent scrolling of the background
      document.body.style.overflow = 'hidden';
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'auto';
    };
  }, [isOpen, onClose]);
  
  // Handle escape key to close
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
    }
    
    return () => {
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);
  
  if (!isOpen) return null;

  // Parse inline markdown (bold, code, links) into React elements
  const parseInline = (text: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    // Match **bold**, `code`, and [text](url)
    const regex = /(\*\*(.+?)\*\*)|(`([^`]+?)`)|(\[([^\]]+?)\]\(([^)]+?)\))/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = regex.exec(text)) !== null) {
      // Text before this match
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      if (match[1]) {
        // **bold**
        parts.push(<strong key={key++} className="font-semibold text-gray-900 dark:text-white">{match[2]}</strong>);
      } else if (match[3]) {
        // `code`
        parts.push(<code key={key++} className="text-xs bg-gray-100 dark:bg-slate-700 px-1 py-0.5 rounded font-mono">{match[4]}</code>);
      } else if (match[5]) {
        // [text](url)
        parts.push(
          <a key={key++} href={match[7]} target="_blank" rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline">
            {match[6]}
          </a>
        );
      }

      lastIndex = match.index + match[0].length;
    }

    // Remaining text after last match
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : [text];
  };

  // Parse changelog content to create elements
  const renderChangelog = () => {
    return changelog.split('\n').map((line, index) => {
      if (line.startsWith('# ')) {
        // Main title
        return (
          <h3 key={index} className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
            {line.replace('# ', '')}
          </h3>
        );
      } else if (line.startsWith('## ')) {
        // Version headers
        return (
          <h4 key={index} className="text-lg font-semibold mt-6 mb-2 text-gray-900 dark:text-white border-t dark:border-gray-700 pt-4">
            {line.replace('## ', '')}
          </h4>
        );
      } else if (line.startsWith('### ')) {
        // Section headers (Added, Fixed, etc)
        return (
          <h5 key={index} className="font-medium text-base mt-4 mb-2 text-gray-800 dark:text-gray-200">
            {line.replace('### ', '')}
          </h5>
        );
      } else if (line.startsWith('- ')) {
        // List items — parse inline markdown
        return (
          <li key={index} className="ml-5 text-gray-600 dark:text-gray-300 mb-1 list-disc">
            {parseInline(line.replace('- ', ''))}
          </li>
        );
      } else if (line.startsWith('> ')) {
        // Blockquotes
        return (
          <blockquote key={index} className="border-l-4 border-blue-300 dark:border-blue-600 pl-3 py-1 text-sm text-gray-600 dark:text-gray-300 italic mb-1">
            {parseInline(line.replace('> ', ''))}
          </blockquote>
        );
      } else if (line.trim() === '') {
        // Empty lines
        return <div key={index} className="h-2"></div>;
      } else {
        // Normal text — parse inline markdown
        return (
          <p key={index} className="text-gray-600 dark:text-gray-300 mb-1">
            {parseInline(line)}
          </p>
        );
      }
    });
  };
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 dark:bg-black dark:bg-opacity-70">
      <div 
        ref={modalRef}
        className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 overflow-hidden"
      >
        <div className="p-5 border-b dark:border-slate-700 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Version History
          </h3>
          <div className="text-sm bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded-md">
            Current: {version}
          </div>
        </div>
        
        <div className="p-5 max-h-[65vh] overflow-y-auto">
          {renderChangelog()}
        </div>
        
        <div className="p-4 bg-gray-50 dark:bg-slate-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white rounded-md bg-gray-100 dark:bg-slate-600 hover:bg-gray-200 dark:hover:bg-slate-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
});

export default ChangelogModal; 