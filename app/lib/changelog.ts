import { readFile } from 'fs/promises';
import path from 'path';

/**
 * Reads the CHANGELOG.md file from the project root
 * This is a server-only function and will always read the most current version of the file
 * regardless of when the app was built
 */
export async function getChangelog(): Promise<string> {
  try {
    // Use process.cwd() to get the current working directory at runtime
    // This ensures we read the actual file from disk even after the app is built
    const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
    console.log(`Reading changelog from: ${changelogPath}`);
    
    // Read the file with no caching
    const content = await readFile(changelogPath, 'utf-8');
    return content;
  } catch (error) {
    console.error('Error reading changelog:', error);
    return '# Changelog\n\nUnable to load changelog data.';
  }
} 