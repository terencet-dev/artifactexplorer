'use client';

import { Registry, AuthenticatedRegistry } from '@/app/types/registry';

/**
 * Type guard to check if a registry is authenticated.
 * This function checks if the registry object is of type AuthenticatedRegistry.
 * 
 * @param registry The registry to check
 * @returns true if the registry is authenticated, false otherwise
 */
export function isAuthenticatedRegistry(registry: Registry): registry is AuthenticatedRegistry {
  return registry.type === 'authenticated';
} 