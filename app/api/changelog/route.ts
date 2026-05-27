import { NextResponse } from 'next/server';
import { getChangelog } from '@/app/lib/changelog';

/**
 * API endpoint to serve the changelog content from CHANGELOG.md
 */
export async function GET() {
  try {
    // Get changelog content using the utility function
    const content = await getChangelog();
    
    // Return the content without caching to ensure fresh content on every request
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        // Remove the Cache-Control header to prevent caching
        // Add CORS headers for API route
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET'
      }
    });
  } catch (error) {
    console.error('Error reading changelog:', error);
    return new NextResponse('# Changelog\n\nUnable to load changelog data.', {
      status: 500,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

/**
 * Handle OPTIONS requests for CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204, // No content
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400' // 24 hours
    }
  });
} 