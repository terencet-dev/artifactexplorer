/**
 * Shared CSV utilities for SBOM and EOL export.
 */

/** Always-quote CSV escape — wraps every value in double quotes for consistency and safety. */
export function csvEscape(val: string): string {
  if (!val) return '""';
  return `"${val.replace(/"/g, '""')}"`;
}

/** Build a CSV string from headers and rows, using always-quote escaping. */
export function buildCsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(csvEscape).join(',');
  const dataLines = rows.map(row => row.map(csvEscape).join(',')).join('\n');
  return headerLine + '\n' + dataLines;
}

/** Trigger a browser download of a CSV string with the given filename. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
