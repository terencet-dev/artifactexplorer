// Registry types
export interface AuthenticatedRegistry {
  type: 'authenticated';
  server: string;
  username: string;
  password: string;
  id?: string; // Unique identifier for each registry
}

export interface AnonymousRegistry {
  type: 'anonymous';
  server: string;
  id?: string; // Unique identifier for each registry
}

export type Registry = AuthenticatedRegistry | AnonymousRegistry;

// Repository and tag types
export interface Repository {
  name: string;
  registry: string;
  registryId?: string; // Reference to the registry ID
}

export interface Tag {
  name: string;
  size?: number;
  digest?: string;
  architecture?: string;
  os?: string;
  variants?: string[];
  features?: string[];
  platforms?: string[] | Array<{
    os: string;
    architecture: string;
    'os.version'?: string;
    variant?: string;
    features?: string[];
  }>;
  detailed?: boolean;
  loadingDigest?: boolean;
  digestError?: boolean;
  digestErrorMessage?: string;
  // Manifest metadata (populated by getTagPlatformDetails)
  mediaType?: string;
  configMediaType?: string;
  // UI state properties
  platformsLoading?: boolean;
  showPlatforms?: boolean;
  platformError?: boolean;
  platformErrorMessage?: string;
}

// API response types
export interface CatalogResponse {
  repositories: string[];
  // Optional pagination fields that might be returned by some registries
  next?: string;
  previous?: string;
}

export interface TagsResponse {
  name: string;
  tags: string[];
}

export interface ManifestResponse {
  // Common fields
  schemaVersion: number;
  mediaType?: string;
  
  // v2 Schema 2 / OCI format fields
  config?: {
    mediaType: string;
    size: number;
    digest: string;
  };
  layers?: {
    mediaType: string;
    size: number;
    digest: string;
  }[];
  
  // v1 Schema fields
  name?: string;
  tag?: string;
  architecture?: string;
  fsLayers?: {
    blobSum: string;
  }[];
  history?: {
    v1Compatibility: string;
  }[];
  
  // Manifest list/index fields
  manifests?: {
    mediaType: string;
    size: number;
    digest: string;
    platform?: {
      architecture: string;
      os: string;
      'os.version'?: string;
      variant?: string;
      features?: string[];
    };
  }[];
  
  // Generic fields that might be present
  digest?: string;
  size?: number;
  
  // Annotation fields
  annotations?: Record<string, string>;
  
  // Platform info sometimes included directly
  platform?: {
    architecture: string;
    os: string;
    'os.version'?: string;
    'os.features'?: string[];
    variant?: string;
    features?: string[];
  };
}

export interface RepositoriesResponse {
  repositories: Repository[];
}

// OCI Referrer descriptor returned from the Referrers API
export interface Referrer {
  digest: string;
  artifactType?: string;
  mediaType: string;
  size: number;
  annotations?: Record<string, string>;
  reference?: string;
}

// SBOM types
export interface SbomPackage {
  type: string;
  namespace: string;
  name: string;
  version: string;
  license: string;
  publisher: string;
  purl: string;
}

export interface SbomMetadata {
  format: 'spdx-2.3' | 'spdx-3.0' | 'cyclonedx';
  documentName: string;
}

export interface SbomLayerInfo {
  layerDigest: string;
  mediaType: string;
  size: number;
}

// Discriminated union for NDJSON stream lines from the SBOM parse route
export type SbomStreamLine =
  | { meta: true; format: SbomMetadata['format']; documentName: string }
  | { meta?: undefined; partial?: undefined; error?: undefined } & SbomPackage
  | { partial: true; reason: string; packagesStreamed: number }
  | { error: true; reason: string };