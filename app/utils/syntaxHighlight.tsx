import React from 'react';

/**
 * Highlight search terms in a text string with yellow marks.
 */
export function highlightSearchTerms(text: string, searchQuery: string): React.ReactNode {
  if (!searchQuery.trim()) {
    return <span className="text-gray-800 dark:text-gray-200">{text}</span>;
  }

  const safeSearchQuery = searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${safeSearchQuery})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 text-gray-900 dark:text-gray-100 px-0.5 rounded">{part}</mark>
        ) : (
          <span key={i} className="text-gray-800 dark:text-gray-200">{part}</span>
        )
      )}
    </>
  );
}

/**
 * Syntax-highlight a JSON string with colour-coded keys, strings, numbers, and booleans.
 * Falls back to plain text on parse errors.
 */
export function syntaxHighlightJson(json: string, searchQuery: string): React.ReactNode {
  if (!json) return null;

  if (searchQuery.trim()) {
    return highlightSearchTerms(json, searchQuery);
  }

  try {
    const obj = JSON.parse(json);
    const formattedJson = JSON.stringify(obj, null, 2);

    const coloredJson = formattedJson
      .replace(/"([^"]+)":/g, '<span class="text-purple-600 dark:text-purple-400">"$1"</span>:')
      .replace(/: "([^"]+)"/g, ': <span class="text-green-600 dark:text-green-400">"$1"</span>')
      .replace(/: (\d+)(,?)/g, ': <span class="text-blue-600 dark:text-blue-400">$1</span>$2')
      .replace(/: (true|false|null)(,?)/g, ': <span class="text-red-600 dark:text-red-400">$1</span>$2');

    return <div dangerouslySetInnerHTML={{ __html: coloredJson }} />;
  } catch {
    return <span>{json}</span>;
  }
}

/**
 * Syntax-highlight the CLI-style tree output for referrers.
 */
export function syntaxHighlightTree(treeText: string): React.ReactNode {
  if (!treeText.trim()) return null;

  const lines = treeText.split('\n');

  return (
    <>
      {lines.map((line, index) => {
        if (!line.trim()) return <br key={index} />;

        if (line.includes('└── ') || line.includes('├── ')) {
          if (!line.includes('sha256:')) {
            const [prefix, content] = line.split('── ');
            return (
              <div key={index} className="whitespace-pre">
                <span className="text-gray-600 dark:text-gray-400">{prefix}── </span>
                <span className="text-blue-600 dark:text-blue-400 font-medium">{content}</span>
              </div>
            );
          } else {
            const [prefix, digest] = line.split('── ');
            return (
              <div key={index} className="whitespace-pre">
                <span className="text-gray-600 dark:text-gray-400">{prefix}── </span>
                <span className="text-green-600 dark:text-green-400">{digest}</span>
              </div>
            );
          }
        } else if (line.includes('│   ')) {
          const parts = line.split('│   ');
          if (parts.length === 2 && parts[1].includes('── ')) {
            const [prefix, digest] = parts[1].split('── ');
            return (
              <div key={index} className="whitespace-pre">
                <span className="text-gray-600 dark:text-gray-400">│   {prefix}── </span>
                <span className="text-green-600 dark:text-green-400">{digest}</span>
              </div>
            );
          }
          return <div key={index} className="whitespace-pre text-gray-800 dark:text-gray-300">{line}</div>;
        }

        return <div key={index} className="whitespace-pre text-gray-800 dark:text-gray-300">{line}</div>;
      })}
    </>
  );
}
