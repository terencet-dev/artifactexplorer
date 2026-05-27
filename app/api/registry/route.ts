import { NextRequest, NextResponse } from 'next/server';
import { Registry } from '@/app/types/registry';
import { getCredentialById, debugCredentialStore, debugAllCredentials, clearCredential, clearAllCredentials } from '@/app/utils/credentialStore';

export async function POST(request: NextRequest) {
  try {
    const { url, headers: customHeaders, method = 'GET', auth } = await request.json();
    
    if (!url) {
      return NextResponse.json(
        { error: 'Missing URL parameter' },
        { status: 400 }
      );
    }

    console.log(`Registry API: Making ${method} request to ${url}`);
    
    // Prepare headers
    const headers = new Headers();
    if (customHeaders) {
      Object.entries(customHeaders).forEach(([key, value]) => {
        headers.append(key, value as string);
      });
    }
    
    // Authentication handling
    if (auth) {
      let authAdded = false;
      
      // Debug all credentials before attempting to authenticate
      console.log(`Registry API: Debug credential store before authentication:`);
      debugCredentialStore();
      
      // Log authentication context for debugging
      console.log(`Registry API: Authentication context for request to ${url.split('?')[0]}`);
      console.log(`Registry API: Registry type: ${auth.registryType || 'unknown'}`);
      console.log(`Registry API: Registry ID available: ${!!auth.registryId}`);
      if (auth.registryId) {
        console.log(`Registry API: Registry ID: ${auth.registryId}`);
      }
      console.log(`Registry API: Direct credentials available: ${!!(auth.credentials?.username && auth.credentials?.password)}`);
      
      // Prioritize direct credentials when available - most reliable approach
      if (auth.credentials && auth.credentials.username && auth.credentials.password) {
        console.log(`Registry API: Using direct credentials from request for initial authentication`);
        
        // For token-based registries, we don't add auth header to initial request
        if (auth.needsTokenAuth) {
          console.log(`Registry API: Token-based registry detected, will use credentials for token request when needed`);
        } else {
          const authStr = Buffer.from(`${auth.credentials.username}:${auth.credentials.password}`).toString('base64');
          headers.set('Authorization', `Basic ${authStr}`);
          console.log(`Registry API: Using direct credentials for Basic auth in initial request`);
        }
        authAdded = true;
      }
      // Fall back to credential store only if direct credentials aren't available 
      else if (auth.registryId) {
        console.log(`[RegistryAPI] Looking up credentials for registry ID: ${auth.registryId}`);
        
        try {
          // Use imported functions directly
          console.log('[RegistryAPI] Current credential store state:');
          debugAllCredentials();
          
          // Use direct ID lookup - this is CRITICAL for authentication
          const credentials = getCredentialById(auth.registryId);
          
          if (credentials && credentials.username && credentials.password) {
            console.log(`[RegistryAPI] Found valid credentials for registry ID: ${auth.registryId}`);
            
            // For token-based registries like ACR, we don't add the Authorization header
            // directly to the initial request, as we'll get a 401 and need to exchange
            // credentials for a token. The credentials will be used for the token request.
            if (auth.needsTokenAuth) {
              console.log(`[RegistryAPI] Token-based registry detected, will use credentials for token request when needed`);
            } else {
              // For Basic auth registries, add Authorization header right away
              const authStr = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
              headers.set('Authorization', `Basic ${authStr}`);
              console.log(`[RegistryAPI] Using credential store authentication for initial request (registry ID: ${auth.registryId})`);
            }
            authAdded = true;
          } else {
            console.warn(`[RegistryAPI] No credentials found for registry ${auth.registryId}`);
          }
        } catch (error: any) {
          console.error(`[RegistryAPI] Error retrieving credentials:`, error?.message || error);
        }
      }
      
      // Log authentication status
      if (!authAdded && auth.registryType === 'authenticated') {
        console.warn(`Registry API: No authentication credentials available for authenticated registry request`);
      }
    }

    // Add default headers if not set
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }

    // Log request details for debugging
    console.log(`Registry API: Headers - ${Array.from(headers.keys()).join(', ')}`);
    
    // Check if this is a manifest request, which might need special handling for some registries
    const isManifestRequest = url.includes('/manifests/');
    
    // Make the request to the registry
    let response = await fetch(url, {
      method,
      headers,
    });

    // Handle 401 Unauthorized - attempt to get a token if this is an authenticated request
    if (response.status === 401 && auth) {
      console.log('Registry API: Received 401, attempting to get auth token');
      
      // Extract WWW-Authenticate header
      const authHeader = response.headers.get('WWW-Authenticate');
      if (authHeader) {
        try {
          console.log(`Registry API: Auth header received: ${authHeader}`);
          
          // Support both Bearer and Basic auth challenges
          let realm, service, scope;
          
          if (authHeader.startsWith('Bearer')) {
            // Parse WWW-Authenticate header for Bearer auth
            realm = authHeader.match(/realm="([^"]+)"/)?.[1];
            service = authHeader.match(/service="([^"]+)"/)?.[1];
            scope = authHeader.match(/scope="([^"]+)"/)?.[1];
            console.log(`Registry API: Bearer auth challenge detected with realm: ${realm}, service: ${service}, scope: ${scope}`);
          } else if (authHeader.includes('Basic')) {
            // For Basic auth challenges, we should already have sent credentials
            // This typically means our credentials are wrong
            console.error('Registry API: Basic auth challenge detected. Credentials may be incorrect.');
            return NextResponse.json(
              { 
                error: 'Authentication failed - invalid credentials',
                status: 401,
                statusText: 'Unauthorized',
                details: 'The provided credentials were rejected by the registry'
              },
              { status: 401 }
            );
          }
          
          if (realm) {
            // Build token URL
            const tokenUrl = new URL(realm);
            if (service) tokenUrl.searchParams.append('service', service);
            if (scope) tokenUrl.searchParams.append('scope', scope);
            
            // Handle specific repository tag-related scope requirements 
            // This addresses cases where the scope might need adjustment
            if (!scope && url.includes('/_catalog')) {
              // Default to catalog scope for catalog requests (repository listing)
              tokenUrl.searchParams.append('scope', 'registry:catalog:*');
              console.log('Registry API: Added default catalog scope to token request');
            } else if (scope && scope.includes('repository:') && url.includes('/tags/list')) {
              // Ensure tag requests have both pull and metadata_read permissions
              // This is critical for repositories with strict access controls
              console.log(`Registry API: Tag request detected with scope: ${scope}`);
              
              // If scope doesn't already specify the right permissions, append them
              if (!scope.includes('pull') && !scope.includes('metadata_read')) {
                // Extract repository name
                const repoMatch = scope.match(/repository:([^:]+):/);
                if (repoMatch && repoMatch[1]) {
                  const repo = repoMatch[1];
                  // Use enhanced scope with both permissions
                  const enhancedScope = `repository:${repo}:pull,metadata_read`;
                  // Replace the scope parameter
                  tokenUrl.searchParams.delete('scope');
                  tokenUrl.searchParams.append('scope', enhancedScope);
                  console.log(`Registry API: Enhanced scope for tag access: ${enhancedScope}`);
                }
              }
            }
            
            // Get token
            console.log(`Registry API: Requesting token from ${tokenUrl.toString()}`);
            
            // Create auth headers for token request
            const tokenHeaders = new Headers();
            let tokenAuthAdded = false;
            
            // For ACR and other registries requiring auth for token endpoint
            // Check if direct credentials are available and try those first (most reliable)
            if (auth.credentials && auth.credentials.username && auth.credentials.password) {
              console.log(`[RegistryAPI] Using direct credentials from request for token endpoint`);
              const authStr = Buffer.from(`${auth.credentials.username}:${auth.credentials.password}`).toString('base64');
              tokenHeaders.set('Authorization', `Basic ${authStr}`);
              tokenAuthAdded = true;
            } 
            // Fall back to credential store only if direct credentials aren't available
            else if (auth.registryId) {
              try {
                // Use imported functions directly
                console.log(`[RegistryAPI] Looking up credentials for registry ID: ${auth.registryId}`);
                
                // Debug the credential store state
                debugAllCredentials();
                
                // Try to get credentials with the provided registry ID
                let credentials = getCredentialById(auth.registryId);
                
                // If no credentials found and registry server URL was provided, try that as fallback ID
                if (!credentials && auth.registry) {
                  console.log(`[RegistryAPI] No credentials found with ID ${auth.registryId}, trying server URL ${auth.registry}`);
                  credentials = getCredentialById(auth.registry);
                  
                  if (credentials) {
                    console.log(`[RegistryAPI] Found credentials using server URL instead of registry ID`);
                  }
                }
                
                if (credentials && credentials.username && credentials.password) {
                  console.log(`[RegistryAPI] Found valid credentials, adding auth header for token request`);
                  
                  // Add Basic Auth header for token request
                  const authStr = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
                  tokenHeaders.set('Authorization', `Basic ${authStr}`);
                  tokenAuthAdded = true;
                } else {
                  console.error(`[RegistryAPI] No credentials found for registry ID: ${auth.registryId}`);
                  
                  // CRITICAL: If this is a tag request with no credentials, send a 401 immediately
                  // This prevents unnecessary token requests that will fail anyway
                  if (url.includes('/tags/list')) {
                    console.error(`[RegistryAPI] Tags request with no credentials, returning 401`);
                    return NextResponse.json(
                      { 
                        error: 'Authentication required for tag access',
                        status: 401,
                        statusText: 'Unauthorized',
                        details: 'No credentials available for authenticated registry'
                      },
                      { status: 401 }
                    );
                  }
                }
              } catch (error) {
                console.error(`[RegistryAPI] Error retrieving credentials:`, error);
              }
            }
            
            // Log if we're attempting a token request without auth
            if (!tokenAuthAdded) {
              console.warn('Registry API: No authentication added for token request, may fail for authenticated registries');
            }
            
            // Make token request
            console.log(`Registry API: Token request headers: ${Array.from(tokenHeaders.keys()).join(', ')}`);
            const tokenResponse = await fetch(tokenUrl.toString(), {
              headers: tokenHeaders
            });
            
            if (tokenResponse.ok) {
              const tokenData = await tokenResponse.json();
              if (tokenData.token || tokenData.access_token) {
                const token = tokenData.token || tokenData.access_token;
                
                // Retry original request with token
                headers.set('Authorization', `Bearer ${token}`);
                console.log('Registry API: Retrying request with bearer token');
                
                response = await fetch(url, {
                  method,
                  headers,
                });
                
                console.log(`Registry API: Retried request with token, status: ${response.status}`);
              } else {
                console.error('Registry API: Token response missing token field', tokenData);
              }
            } else {
              // Log more details about the token request failure
              console.error(`Registry API: Failed to get auth token, status: ${tokenResponse.status}`);
              try {
                const errorText = await tokenResponse.text();
                console.error(`Registry API: Token endpoint error: ${errorText}`);
              } catch (e) {
                console.error('Registry API: Could not read token error response');
              }
            }
          } else {
            console.warn('Registry API: WWW-Authenticate header missing realm parameter:', authHeader);
          }
        } catch (tokenError) {
          console.error('Registry API: Error getting token:', tokenError);
        }
      } else {
        console.warn('Registry API: 401 response missing WWW-Authenticate header');
      }
    }

    // Check if the response was successful
    if (!response.ok) {
      const statusCode = response.status;
      const statusText = response.statusText;
      
      console.error(`Registry API: Request failed with status ${statusCode} (${statusText})`);
      
      // Try to get more information about the error
      let errorBody = '';
      try {
        errorBody = await response.text();
        console.error(`Registry API: Error response body: ${errorBody}`);
      } catch (e) {
        console.error(`Registry API: Could not read error response body`);
      }
      
      return NextResponse.json(
        { 
          error: `Registry request failed with status ${statusCode}`,
          status: statusCode,
          statusText: statusText,
          details: errorBody
        },
        { status: statusCode }
      );
    }

    // Get the response data
    let data;
    const contentType = response.headers.get('content-type');
    console.log(`Registry API: Response content-type: ${contentType}`);
    
    // Extract important headers, particularly Docker-Content-Digest for manifest requests
    const responseHeaders: Record<string, string> = {};
    const headersToKeep = ['docker-content-digest', 'content-type', 'content-length', 'etag'];
    
    headersToKeep.forEach(headerName => {
      const headerValue = response.headers.get(headerName);
      if (headerValue) {
        responseHeaders[headerName] = headerValue;
        console.log(`Registry API: Found ${headerName} header: ${headerValue}`);
      }
    });
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      // Try parsing as JSON first, even if not specified in content-type
      try {
        const text = await response.text();
        data = JSON.parse(text);
      } catch (e) {
        // If parsing fails, get the raw text
        const text = await response.text();
        data = text;
      }
    }
    
    // For manifest requests, always check for and include the Docker-Content-Digest header
    if (url.includes('/manifests/') && responseHeaders['docker-content-digest']) {
      console.log(`Registry API: Including Docker-Content-Digest header in response`);
      // Create a wrapped response with both data and headers
      return NextResponse.json({
        data,
        headers: responseHeaders
      });
    }

    // Return the data directly for non-manifest requests
    return NextResponse.json(data);
  } catch (error) {
    console.error('Registry proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to connect to registry', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 