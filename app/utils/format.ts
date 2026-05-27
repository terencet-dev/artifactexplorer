/**
 * Shared formatting utilities
 */

/**
 * Format a byte count into a human-readable size string.
 *
 * @param bytes - The number of bytes (or undefined)
 * @param opts.zeroLabel - What to return for 0 or undefined values (default: 'Unknown')
 * @returns A formatted string like "1.46 KB" or "3.2 GB"
 */
export function formatSize(
  bytes?: number,
  opts?: { zeroLabel?: string }
): string {
  const zeroLabel = opts?.zeroLabel ?? 'Unknown';

  if (bytes === undefined || bytes === 0) return zeroLabel;

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const decimals = size < 10 ? 2 : 1;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}
