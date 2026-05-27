'use server';

import { cookies } from 'next/headers';
import type { SbomLayerInfo } from '@/app/types/registry';

type ReferrersResult = 
  | { success: true; treeOutput: string; raw: any[]; noReferrers?: boolean }
  | { success: false; error: string; details: string };

/**
 * Server action to execute ORAS discover command
 * This runs on the server instead of calling the API endpoint from the client
 */
export async function discoverReferrers(
  registry: string,
  repository: string,
  tag: string,
  registryId: string,
  credentials?: { username?: string; password?: string }
): Promise<ReferrersResult> {
  try {
    console.log(`[Server Action] Discovering referrers for ${registry}/${repository}:${tag}`);
    
    // Skip the operation if we don't have essential data
    if (!registry || !repository || !tag) {
      return {
        success: false,
        error: 'Missing required parameters',
        details: 'Registry, repository, and tag are all required'
      };
    }
    
    // Preserve exact tag name (case sensitive)
    const exactTagName = tag;
    
    // Always use REST API regardless of environment
    return await discoverReferrersWithRestAPI(registry, repository, exactTagName, registryId, credentials);
  } catch (error) {
    console.error('[Server Action] General error:', error);
    
    return {
      success: false,
      error: 'Failed to process referrers request',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Server action to fetch the SBOM layer info from an artifact manifest.
 *
 * Given an artifact digest, fetches its manifest and returns the first layer's
 * digest, mediaType, and size. This is lightweight metadata (<1 KB) used by
 * the client to then call the streaming blob parse or download routes.
 */
export async function fetchSbomLayerInfo(
  registry: string,
  repository: string,
  artifactDigest: string,
  registryId: string,
  credentials?: { username?: string; password?: string }
): Promise<{ success: true; layerInfo: SbomLayerInfo } | { success: false; error: string }> {
  try {
    console.log(`[Server Action] Fetching SBOM layer info for ${registry}/${repository}@${artifactDigest}`);

    // Handle Docker Hub's special domain structure
    let apiRegistry = registry;
    let apiRepo = repository;
    if (registry === 'docker.io' || registry === 'registry.hub.docker.com') {
      apiRegistry = 'registry-1.docker.io';
      if (!repository.includes('/')) {
        apiRepo = `library/${repository}`;
      }
    }

    // Get auth headers
    const authHeaders = await getAuthHeaders(apiRegistry, apiRepo, registryId, credentials);

    // Fetch the artifact manifest
    const manifestUrl = `https://${apiRegistry}/v2/${apiRepo}/manifests/${artifactDigest}`;
    const manifestResponse = await makeAuthenticatedFetch(
      manifestUrl,
      {
        headers: {
          ...authHeaders,
          'Accept': 'application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json,application/json',
        },
      },
      apiRegistry,
      registryId,
      apiRepo,
      credentials
    );

    if (!manifestResponse.ok) {
      return {
        success: false,
        error: `Failed to fetch artifact manifest: ${manifestResponse.status} ${manifestResponse.statusText}`,
      };
    }

    const manifest = await manifestResponse.json();

    if (!manifest.layers || manifest.layers.length === 0) {
      return {
        success: false,
        error: 'Artifact manifest has no layers',
      };
    }

    const layer = manifest.layers[0];
    return {
      success: true,
      layerInfo: {
        layerDigest: layer.digest,
        mediaType: layer.mediaType || '',
        size: layer.size || 0,
      },
    };
  } catch (error) {
    console.error('[Server Action] Error fetching SBOM layer info:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Use the REST API to discover referrers (for production)
 */
async function discoverReferrersWithRestAPI(
  registry: string,
  repository: string,
  tag: string,
  registryId: string,
  credentials?: { username?: string; password?: string }
): Promise<ReferrersResult> {
  try {
    console.log(`[Server Action] Using REST API to discover referrers for ${registry}/${repository}:${tag}`);
    
    // Handle Docker Hub's special domain structure
    let apiRegistry = registry;
    if (registry === 'docker.io' || registry === 'registry.hub.docker.com') {
      apiRegistry = 'registry-1.docker.io';
      
      // For Docker Hub, if the repository doesn't have a slash, it's in the library namespace
      if (!repository.includes('/')) {
        repository = `library/${repository}`;
      }
      
      console.log(`[Server Action] Using Docker Hub API with registry ${apiRegistry} and repository ${repository}`);
    }
    
    // Get authentication headers, passing the credentials from the client if provided
    let authHeaders = await getAuthHeaders(apiRegistry, repository, registryId, credentials);
    
    // First, we need to get the digest for the tag
    const digestUrl = `https://${apiRegistry}/v2/${repository}/manifests/${tag}`;
    
    console.log(`[Server Action] Getting digest from: ${digestUrl}`);
    
    // Fetch the digest using makeAuthenticatedFetch for consistent auth handling
    const digestResponse = await makeAuthenticatedFetch(
      digestUrl,
      {
        method: 'HEAD',
        headers: {
          ...authHeaders,
          'Accept': 'application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json,application/vnd.docker.distribution.manifest.list.v2+json'
        }
      },
      apiRegistry,
      registryId,
      repository,
      credentials
    );
    
    // Handle various response cases
    if (!digestResponse.ok) {
      if (digestResponse.status === 401) {
        // Still unauthorized after auth attempt
        console.error('[Server Action] Authentication failed for registry');
        return {
          success: false,
          error: 'Authentication failed',
          details: `The registry requires authentication. Please check your credentials. Status: ${digestResponse.status}`
        };
      }
      
      if (digestResponse.status === 404) {
        console.log(`[Server Action] Tag not found: ${tag}`);
        return { 
          success: false,
          error: 'Tag not found',
          details: `The tag '${tag}' was not found in the repository. Please verify the tag exists.`
        };
      }
      
      // For any other error
      return {
        success: false,
        error: 'Failed to get digest for tag',
        details: `Status: ${digestResponse.status} - ${digestResponse.statusText}`
      };
    }
    
    // Get the digest from the Docker-Content-Digest header
    const digest = digestResponse.headers.get('Docker-Content-Digest');
    
    if (!digest) {
      console.log('[Server Action] No digest header in response, fetching manifest to compute digest');
      
      // Try to get the digest from the manifest itself
      try {
        // Fetch the manifest content
        const manifestResponse = await makeAuthenticatedFetch(
          digestUrl, 
          {
            headers: {
              'Accept': 'application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json'
            }
          },
          registry,
          registryId,
          repository,
          credentials
        );
        
        if (!manifestResponse.ok) {
          // Handle authentication failures specifically
          if (manifestResponse.status === 401) {
            console.error('[Server Action] Authentication failed for manifest fetch');
            return {
              success: false,
              error: 'Authentication failed',
              details: 'Unable to authenticate with the registry when fetching manifest. Please check your credentials.'
            };
          }
          
          return {
            success: false,
            error: 'Could not retrieve manifest for tag',
            details: `Status: ${manifestResponse.status} - ${manifestResponse.statusText}`
          };
        }
        
        // Check if the digest is in the response headers
        const digestFromHeaders = manifestResponse.headers.get('Docker-Content-Digest');
        if (digestFromHeaders) {
          console.log(`[Server Action] Found digest in response headers: ${digestFromHeaders}`);
          return await fetchReferrers(apiRegistry, repository, tag, digestFromHeaders, authHeaders, registryId, credentials);
        }
        
        // If not in headers, try to compute it from the response body
        const manifestData = await manifestResponse.text();
        
        // If we have a manifest, try to extract the digest from it if it's json
        try {
          const manifestJson = JSON.parse(manifestData);
          if (manifestJson.config && manifestJson.config.digest) {
            console.log(`[Server Action] Using config digest from manifest: ${manifestJson.config.digest}`);
            return await fetchReferrers(apiRegistry, repository, tag, manifestJson.config.digest, authHeaders, registryId, credentials);
          }
        } catch (e) {
          // Not JSON or doesn't have config.digest, continue with fallback
        }
        
        // Compute a fake SHA256 digest as a fallback
        const computedDigest = `sha256:${manifestData.length.toString(16).padStart(64, '0')}`;
        console.log(`[Server Action] Computed fallback digest: ${computedDigest}`);
        
        return await fetchReferrers(apiRegistry, repository, tag, computedDigest, authHeaders, registryId, credentials);
      } catch (e) {
        console.error('[Server Action] Error getting manifest data:', e);
        return {
          success: false,
          error: 'Could not retrieve digest for tag',
          details: 'Failed to get digest from manifest response'
        };
      }
    }
    
    console.log(`[Server Action] Got digest: ${digest}`);
    
    // Now query for referrers with the digest we found
    return await fetchReferrers(apiRegistry, repository, tag, digest, authHeaders, registryId, credentials);
  } catch (error) {
    console.error('[Server Action] REST API error:', error);
    
    return {
      success: false,
      error: 'Failed to get referrers from REST API',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fetch referrers using the digest
 */
async function fetchReferrers(
  registry: string,
  repository: string,
  tag: string,
  digest: string,
  authHeaders: Record<string, string>,
  registryId: string,
  credentials?: { username?: string; password?: string }
): Promise<ReferrersResult> {
  // Construct the referrers URL
  const referrersUrl = `https://${registry}/v2/${repository}/referrers/${digest}`;
  
  console.log(`[Server Action] Getting referrers from: ${referrersUrl}`);
  
  try {
    // Use makeAuthenticatedFetch to better handle auth challenges
    const referrersResponse = await makeAuthenticatedFetch(
      referrersUrl,
      {
        headers: {
          'Accept': 'application/vnd.oci.image.index.v1+json',
          ...authHeaders
        }
      },
      registry,
      registryId,
      repository,
      credentials
    );
    
    // Handle various response status codes
    if (!referrersResponse.ok) {
      // Still unauthorized after auth attempt
      if (referrersResponse.status === 401) {
        console.error('[Server Action] Authentication failed for referrers API');
        return {
          success: false,
          error: 'Authentication failed',
          details: `Unable to authenticate with the registry for referrers API. Please check your credentials.`
        };
      }
      
      // If we get 404, it means no referrers found (this is an expected case)
      if (referrersResponse.status === 404) {
        console.log('[Server Action] No referrers found (404 response)');
        return { 
          success: true,
          treeOutput: `${registry}/${repository}:${tag}\n`, 
          raw: [],
          noReferrers: true
        };
      }
      
      // If the status is 501 Not Implemented, the registry doesn't support the referrers API
      if (referrersResponse.status === 501 || referrersResponse.status === 405) {
        console.log('[Server Action] Registry does not support referrers API (status:', referrersResponse.status, ')');
        return { 
          success: true,
          treeOutput: `${registry}/${repository}:${tag}\n`, 
          raw: [],
          noReferrers: true
        };
      }
      
      // Try to read the response body for a more detailed error message
      let errorDetails = `Status: ${referrersResponse.status} - ${referrersResponse.statusText}`;
      try {
        const errorBody = await referrersResponse.text();
        if (errorBody) {
          errorDetails += `\nResponse: ${errorBody}`;
        }
      } catch (e) {
        console.error('[Server Action] Error reading error response:', e);
      }
      
      return {
        success: false,
        error: 'Failed to get referrers',
        details: errorDetails
      };
    }
    
    // Process the successful response
    return await processReferrersResponse(referrersResponse, registry, repository, tag);
  } catch (error) {
    console.error('[Server Action] Error fetching referrers:', error);
    return {
      success: false,
      error: 'Failed to fetch referrers',
      details: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Process the referrers API response and format the tree output
 */
async function processReferrersResponse(
  response: Response,
  registry: string,
  repository: string,
  tag: string
): Promise<ReferrersResult> {
  // Parse the referrers response
  const referrersData = await response.json();
  
  console.log(`[Server Action] Referrers response:`, 
    referrersData.manifests ? `Found ${referrersData.manifests.length} referrers` : 'No manifests found');
  
  // If we have no manifests, return no referrers
  if (!referrersData.manifests || referrersData.manifests.length === 0) {
    return { 
      success: true,
      treeOutput: `${registry}/${repository}:${tag}\n`, 
      raw: [],
      noReferrers: true
    };
  }
  
  // Format the referrers as a tree output
  let treeOutput = `${registry}/${repository}:${tag}\n`;
  
  // Group referrers by artifact type for better visualization
  const referrersByType: Record<string, any[]> = {};
  
  referrersData.manifests.forEach((manifest: any) => {
    const artifactType = manifest.artifactType || manifest.mediaType || 'unknown';
    if (!referrersByType[artifactType]) {
      referrersByType[artifactType] = [];
    }
    referrersByType[artifactType].push(manifest);
  });
  
  // Build tree output similar to ORAS CLI
  const typeEntries = Object.entries(referrersByType);
  
  typeEntries.forEach(([artifactType, manifests], typeIndex) => {
    const isLastType = typeIndex === typeEntries.length - 1;
    treeOutput += `${isLastType ? '└── ' : '├── '}${artifactType}\n`;
    
    manifests.forEach((manifest, manifestIndex) => {
      const isLastManifest = manifestIndex === manifests.length - 1;
      treeOutput += `${isLastType ? '    ' : '│   '}${isLastManifest ? '└── ' : '├── '}${manifest.digest}\n`;
    });
  });
  
  return { 
    success: true,
    treeOutput, 
    raw: referrersData.manifests
  };
}

/**
 * Get authentication headers for registry API calls
 */
async function getAuthHeaders(
  registry: string,
  repository: string,
  registryId: string,
  credentials?: { username?: string; password?: string }
): Promise<Record<string, string>> {
  // First check if credentials were provided directly
  if (credentials?.username && credentials?.password) {
    console.log(`[Server Action] Using provided credentials for registry ${registry}`);
    const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
    return {
      'Authorization': `Basic ${auth}`
    };
  }
  
  // Next check if we have credentials in cookies
  try {
    const cookieStore = await cookies();
    const credentialsCookie = cookieStore.get(`registry-creds-${registryId}`);
    
    if (credentialsCookie?.value) {
      try {
        const parsedCreds = JSON.parse(decodeURIComponent(credentialsCookie.value));
        if (parsedCreds.username && parsedCreds.password) {
          console.log(`[Server Action] Using credentials from cookies for registry ${registry}`);
          const auth = Buffer.from(`${parsedCreds.username}:${parsedCreds.password}`).toString('base64');
          return {
            'Authorization': `Basic ${auth}`
          };
        }
      } catch (e) {
        console.error('[Server Action] Error parsing credential cookie:', e);
      }
    }
  } catch (e) {
    console.error('[Server Action] Error accessing cookie store:', e);
  }
  
  // Check for credentials from Next.js serverless function environment variables
  // This is useful for server deployments with predefined environment variables
  try {
    // Format the keys with sanitized registryId to avoid issues
    const sanitizedRegistryId = registryId.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
    
    // First check for environment variables for this specific registry
    const envUsername = process.env[`REGISTRY_${sanitizedRegistryId}_USERNAME`] || 
                      process.env[`REGISTRY_USERNAME`];
    const envPassword = process.env[`REGISTRY_${sanitizedRegistryId}_PASSWORD`] || 
                      process.env[`REGISTRY_PASSWORD`];
    
    if (envUsername && envPassword) {
      console.log(`[Server Action] Using environment credentials for registry ${registry}`);
      // Use basic auth for initial request
      const auth = Buffer.from(`${envUsername}:${envPassword}`).toString('base64');
      return {
        'Authorization': `Basic ${auth}`
      };
    }
  } catch (e) {
    console.error('[Server Action] Error accessing environment variables:', e);
  }
  
  // If we don't have credentials from environment variables, try a token server if available
  // This would be a secure way to get credentials in production
  const tokenEndpoint = process.env.REGISTRY_TOKEN_ENDPOINT;
  if (tokenEndpoint) {
    try {
      console.log(`[Server Action] Requesting credentials from token endpoint for ${registry}`);
      const response = await fetch(`${tokenEndpoint}?registry=${encodeURIComponent(registry)}&id=${registryId}`, {
        method: 'GET',
        headers: {
          'X-Registry-Id': registryId,
          'X-Registry-Server': registry
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.token) {
          return {
            'Authorization': `Bearer ${data.token}`
          };
        } else if (data.username && data.password) {
          const auth = Buffer.from(`${data.username}:${data.password}`).toString('base64');
          return {
            'Authorization': `Basic ${auth}`
          };
        }
      }
    } catch (e) {
      console.error('[Server Action] Error getting credentials from token endpoint:', e);
    }
  }
  
  // For Azure Container Registry, try to get a direct token
  if (registry.includes('.azurecr.io')) {
    try {
      // When dealing with ACR, try to authenticate directly using a managed identity
      // This is particularly useful in Azure-hosted environments
      console.log('[Server Action] Trying to get ACR token for registry:', registry);
      
      // First, check if we have Azure identity credentials available
      const azureTokenEndpoint = process.env.AZURE_TOKEN_ENDPOINT || 
                               'https://management.azure.com';
      const azureClientId = process.env.AZURE_CLIENT_ID;
      const azureClientSecret = process.env.AZURE_CLIENT_SECRET;
      const azureTenantId = process.env.AZURE_TENANT_ID;
      
      if (azureClientId && azureClientSecret && azureTenantId) {
        console.log('[Server Action] Using Azure AD credentials for ACR authentication');
        
        // Get an Azure AD token
        const tokenUrl = `https://login.microsoftonline.com/${azureTenantId}/oauth2/token`;
        const tokenResponse = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: azureClientId,
            client_secret: azureClientSecret,
            resource: azureTokenEndpoint
          }).toString()
        });
        
        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json();
          if (tokenData.access_token) {
            // For ACR, we can use this token to get a registry token
            const registryName = registry.split('.')[0]; // Extract registry name from domain
            const acrRefreshUrl = `https://${registry}/oauth2/token`;
            const acrTokenResponse = await fetch(acrRefreshUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: new URLSearchParams({
                grant_type: 'access_token',
                service: registry,
                tenant: azureTenantId,
                access_token: tokenData.access_token
              }).toString()
            });
            
            if (acrTokenResponse.ok) {
              const acrTokenData = await acrTokenResponse.json();
              if (acrTokenData.access_token || acrTokenData.refresh_token) {
                return {
                  'Authorization': `Bearer ${acrTokenData.access_token || acrTokenData.refresh_token}`
                };
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('[Server Action] Error getting ACR token:', e);
    }
  }
  
  // For Docker Hub, try to get a token directly
  if (registry === 'registry.hub.docker.com' || registry === 'docker.io' || registry.endsWith('.docker.io')) {
    try {
      console.log('[Server Action] Trying to get Docker Hub token for anonymous access');
      const tokenUrl = 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/hello-world:pull';
      const tokenResponse = await fetch(tokenUrl);
      
      if (tokenResponse.ok) {
        const data = await tokenResponse.json();
        if (data.token) {
          return {
            'Authorization': `Bearer ${data.token}`
          };
        }
      }
    } catch (e) {
      console.error('[Server Action] Error getting Docker Hub token:', e);
    }
  }
  
  // For public registries, we don't need authentication headers for the initial request
  // The registry will respond with a challenge if authentication is needed
  console.log(`[Server Action] No credentials found for registry ${registry}, trying anonymous access`);
  return {};
}

/**
 * Handle authentication challenge from registry
 */
async function handleAuthChallenge(
  challengeHeader: string,
  registry: string,
  registryId: string,
  repository: string,
  credentials?: { username?: string; password?: string }
): Promise<Record<string, string> | null> {
  console.log(`[Server Action] Handling auth challenge for ${registry}`);
  
  try {
    // Extract the authentication parameters from the WWW-Authenticate header
    // Example: Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/ubuntu:pull"
    const matches = challengeHeader.match(/Bearer realm="([^"]+)",service="([^"]+)"(?:,scope="([^"]+)")?/);
    
    if (!matches) {
      console.error('[Server Action] Failed to parse WWW-Authenticate header:', challengeHeader);
      
      // Try to handle Basic auth challenge
      if (challengeHeader.startsWith('Basic ')) {
        // Check if we have credentials
        if (credentials?.username && credentials?.password) {
          console.log('[Server Action] Using provided credentials for Basic auth');
          const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
          return {
            'Authorization': `Basic ${auth}`
          };
        }
        
        try {
          const cookieStore = await cookies();
          const credentialsCookie = cookieStore.get(`registry-creds-${registryId}`);
          
          if (credentialsCookie?.value) {
            try {
              const parsedCreds = JSON.parse(decodeURIComponent(credentialsCookie.value));
              if (parsedCreds.username && parsedCreds.password) {
                console.log('[Server Action] Using cookie credentials for Basic auth');
                const auth = Buffer.from(`${parsedCreds.username}:${parsedCreds.password}`).toString('base64');
                return {
                  'Authorization': `Basic ${auth}`
                };
              }
            } catch (e) {
              console.error('[Server Action] Error parsing credential cookie for Basic auth:', e);
            }
          }
        } catch (e) {
          console.error('[Server Action] Error accessing cookie store for Basic auth:', e);
        }
        
        // Try environment variables
        const sanitizedRegistryId = registryId.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
        const envUsername = process.env[`REGISTRY_${sanitizedRegistryId}_USERNAME`] || 
                          process.env[`REGISTRY_USERNAME`];
        const envPassword = process.env[`REGISTRY_${sanitizedRegistryId}_PASSWORD`] || 
                          process.env[`REGISTRY_PASSWORD`];
        
        if (envUsername && envPassword) {
          console.log('[Server Action] Using environment credentials for Basic auth');
          const auth = Buffer.from(`${envUsername}:${envPassword}`).toString('base64');
          return {
            'Authorization': `Basic ${auth}`
          };
        }
      }
      
      return null;
    }
    
    const realm = matches[1];
    const service = matches[2];
    let scope = matches[3];
    
    // If scope wasn't provided, default to repository:${repository}:pull
    if (!scope) {
      scope = `repository:${repository}:pull`;
    }
    
    // Build the token URL
    const tokenUrl = `${realm}?service=${encodeURIComponent(service)}&scope=${encodeURIComponent(scope)}`;
    
    // Get a token from the URL
    return await getTokenFromUrl(tokenUrl, registry, registryId, repository, credentials);
  } catch (error) {
    console.error('[Server Action] Error handling auth challenge:', error);
    return null;
  }
}

/**
 * Get a token from a token URL with proper authentication
 */
async function getTokenFromUrl(
  tokenUrl: string,
  registry: string,
  registryId: string,
  repository: string,
  credentials?: { username?: string; password?: string }
): Promise<Record<string, string> | null> {
  // First try to use provided credentials if available
  if (credentials?.username && credentials?.password) {
    console.log('[Server Action] Using provided credentials for token request');
    const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
    const headers = {
      'Authorization': `Basic ${auth}`
    };
    
    try {
      const tokenResponse = await fetch(tokenUrl, {
        headers
      });
      
      if (tokenResponse.ok) {
        const tokenData = await tokenResponse.json();
        if (tokenData.token || tokenData.access_token) {
          const token = tokenData.token || tokenData.access_token;
          console.log('[Server Action] Successfully obtained auth token using provided credentials');
          return {
            'Authorization': `Bearer ${token}`
          };
        }
      }
    } catch (e) {
      console.error('[Server Action] Error getting token with provided credentials:', e);
    }
  }
  
  // Next check if we have credentials in cookies
  try {
    const cookieStore = await cookies();
    const credentialsCookie = cookieStore.get(`registry-creds-${registryId}`);
    
    if (credentialsCookie?.value) {
      try {
        const parsedCreds = JSON.parse(decodeURIComponent(credentialsCookie.value));
        if (parsedCreds.username && parsedCreds.password) {
          console.log('[Server Action] Using cookie credentials for token request');
          const auth = Buffer.from(`${parsedCreds.username}:${parsedCreds.password}`).toString('base64');
          const headers = {
            'Authorization': `Basic ${auth}`
          };
          
          const tokenResponse = await fetch(tokenUrl, {
            headers
          });
          
          if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            if (tokenData.token || tokenData.access_token) {
              const token = tokenData.token || tokenData.access_token;
              console.log('[Server Action] Successfully obtained auth token using cookie credentials');
              return {
                'Authorization': `Bearer ${token}`
              };
            }
          }
        }
      } catch (e) {
        console.error('[Server Action] Error using cookie credentials for token request:', e);
      }
    }
  } catch (e) {
    console.error('[Server Action] Error accessing cookie store for token request:', e);
  }
  
  const sanitizedRegistryId = registryId.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
  
  // Check for registry credentials in environment variables
  const envUsername = process.env[`REGISTRY_${sanitizedRegistryId}_USERNAME`] || 
                     process.env[`REGISTRY_USERNAME`];
  const envPassword = process.env[`REGISTRY_${sanitizedRegistryId}_PASSWORD`] || 
                     process.env[`REGISTRY_PASSWORD`];
  
  let headers: Record<string, string> = {};
  let tokenRequestOptions: RequestInit = { headers };
  
  // Add basic auth if we have credentials from environment variables
  if (envUsername && envPassword) {
    console.log('[Server Action] Adding basic auth to token request from environment variables');
    const auth = Buffer.from(`${envUsername}:${envPassword}`).toString('base64');
    headers['Authorization'] = `Basic ${auth}`;
    tokenRequestOptions.headers = headers;
  }
  
  // For Azure Container Registry, try to use managed identity if available
  if (registry.includes('.azurecr.io') && !envUsername) {
    // Try to get Azure AD token for ACR
    try {
      const azureClientId = process.env.AZURE_CLIENT_ID;
      const azureClientSecret = process.env.AZURE_CLIENT_SECRET;
      const azureTenantId = process.env.AZURE_TENANT_ID;
      
      if (azureClientId && azureClientSecret && azureTenantId) {
        console.log('[Server Action] Using Azure AD auth for token request');
        // Get an AAD token
        const aadTokenUrl = `https://login.microsoftonline.com/${azureTenantId}/oauth2/token`;
        const aadResponse = await fetch(aadTokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: azureClientId,
            client_secret: azureClientSecret,
            resource: 'https://management.azure.com'
          }).toString()
        });
        
        if (aadResponse.ok) {
          const aadData = await aadResponse.json();
          if (aadData.access_token) {
            // Use the AAD token as the bearer token for the ACR token request
            headers['Authorization'] = `Bearer ${aadData.access_token}`;
            tokenRequestOptions.headers = headers;
          }
        }
      }
    } catch (e) {
      console.error('[Server Action] Error getting Azure AD token for token request:', e);
    }
  }
  
  console.log(`[Server Action] Requesting token from: ${tokenUrl}`);
  
  try {
    const tokenResponse = await fetch(tokenUrl, tokenRequestOptions);
    
    if (!tokenResponse.ok) {
      console.error(`[Server Action] Failed to get token: ${tokenResponse.status} - ${tokenResponse.statusText}`);
      
      // Try to read the response body for more details
      try {
        const responseText = await tokenResponse.text();
        console.error('[Server Action] Token response error details:', responseText);
      } catch (e) {
        // Ignore error reading response
      }
      
      return null;
    }
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenData.token && !tokenData.access_token) {
      console.error('[Server Action] No token in response:', tokenData);
      return null;
    }
    
    const token = tokenData.token || tokenData.access_token;
    
    console.log('[Server Action] Successfully obtained auth token');
    
    // Return the authorization header with the token
    return {
      'Authorization': `Bearer ${token}`
    };
  } catch (error) {
    console.error('[Server Action] Error fetching token:', error);
    return null;
  }
}

/**
 * Makes an authenticated fetch request to a registry endpoint
 */
async function makeAuthenticatedFetch(
  url: string,
  options: RequestInit = {},
  registry: string,
  registryId: string,
  repository: string,
  credentials?: { username?: string; password?: string }
): Promise<Response> {
  console.log(`[Server Action] Making authenticated fetch to ${url}`);
  
  // Log whether credentials were provided
  if (credentials?.username && credentials?.password) {
    console.log(`[Server Action] Credentials were provided for ${registry}`);
  } else {
    console.log(`[Server Action] No explicit credentials provided for ${registry}, will try to use environment or stored credentials`);
  }
  
  // First try with auth headers if we have them
  const initialHeaders = await getAuthHeaders(registry, repository, registryId, credentials);
  if (initialHeaders) {
    console.log(`[Server Action] Initial auth headers obtained for ${registry}`);
    options.headers = {
      ...options.headers,
      ...initialHeaders
    };
  } else {
    console.log(`[Server Action] No initial auth headers obtained for ${registry}`);
  }

  console.log(`[Server Action] Sending initial request to ${url}`);
  const response = await fetch(url, options);
  
  // If we get a 401, we need to handle the auth challenge
  if (response.status === 401) {
    console.log(`[Server Action] Got 401 from ${url}, handling auth challenge`);
    const authHeader = response.headers.get('www-authenticate');
    
    if (!authHeader) {
      console.error('[Server Action] No WWW-Authenticate header in 401 response');
      return response;
    }
    
    console.log(`[Server Action] Calling handleAuthChallenge with WWW-Authenticate header: ${authHeader.substring(0, 50)}...`);
    // Explicitly pass the credentials to handleAuthChallenge
    const authHeaders = await handleAuthChallenge(authHeader, registry, registryId, repository, credentials);
    
    if (!authHeaders) {
      console.error('[Server Action] Failed to handle auth challenge, no auth headers returned');
      return response;
    }
    
    // Retry the request with the auth headers
    console.log('[Server Action] Retrying request with obtained auth headers');
    options.headers = {
      ...options.headers,
      ...authHeaders
    };
    
    return fetch(url, options);
  }
  
  console.log(`[Server Action] Got response with status ${response.status} from ${url}`);
  return response;
}