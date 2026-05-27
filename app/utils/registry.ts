'use client';

import { Registry, AuthenticatedRegistry } from '@/app/types/registry';
import { isAuthenticatedRegistry } from './registryUtils';

/**
 * Generates authentication headers for a registry.
 * 
 * @param registry The registry to generate auth headers for
 * @returns An object containing authorization headers if the registry requires authentication
 */
export function getAuthHeaders(registry: Registry): Record<string, string> {
  if (isAuthenticatedRegistry(registry)) {
    const auth = btoa(`${registry.username}:${registry.password}`);
    return {
      'Authorization': `Basic ${auth}`
    };
  }
  return {};
} 