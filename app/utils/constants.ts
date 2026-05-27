// Constants for time calculations
export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DEBOUNCE_DELAY = 300; // 300ms for search debouncing

// LocalStorage keys
export const STORAGE_KEYS = {
  SESSION_LAST_ACTIVE: 'session-last-active',
  CURRENT_REGISTRY_ID: 'current-registry-id',
  REGISTRIES: 'registries',
  REGISTRY: 'registry',
  TAGS_VIEW_MODE: 'tags-view-mode'
};

// Pagination constants
export const DEFAULT_PAGE_SIZE = 20;

// Known public registries
export const KNOWN_PUBLIC_REGISTRIES = [
  'mcr.microsoft.com',
  'registry.k8s.io', 
  'ghcr.io',
  'docker.io',
  'registry.hub.docker.com'
];

// API Constants
export const REGISTRY_API_ENDPOINT = '/api/registry';
export const REGISTRY_API_VERSION = 'v2';

// Registry events
export const REGISTRY_EVENTS = {
  REGISTRY_CHANGED: 'registry-changed',
  REGISTRY_ADDED: 'registry-added'
};

// Application version (single source of truth: package.json)
import pkg from '@/package.json';
export const APP_VERSION = `v${pkg.version}`;

// Known SBOM artifact media types
export const SBOM_ARTIFACT_TYPES = [
  'application/spdx+json',
  'application/vnd.cyclonedx+json',
  'application/vnd.aquasecurity.trivy.report.spdx.v1',
  'application/vnd.aquasecurity.trivy.report.cyclonedx.v1',
  'application/vnd.dev.cosign.artifact.sbom.v1+json',
];

/**
 * Check if an artifact type is a known SBOM format.
 */
export function isSbomArtifact(artifactType?: string): boolean {
  if (!artifactType) return false;
  return SBOM_ARTIFACT_TYPES.some(
    (t) => artifactType.toLowerCase() === t.toLowerCase()
  );
}

// Lifecycle artifact type (EOL annotations)
export const LIFECYCLE_ARTIFACT_TYPE = 'application/vnd.microsoft.artifact.lifecycle';
export const LIFECYCLE_EOL_ANNOTATION_KEY = 'vnd.microsoft.artifact.lifecycle.end-of-life.date';

/**
 * Check if an artifact type is a lifecycle annotation (EOL).
 */
export function isLifecycleArtifact(artifactType?: string): boolean {
  if (!artifactType) return false;
  return artifactType.toLowerCase() === LIFECYCLE_ARTIFACT_TYPE;
}