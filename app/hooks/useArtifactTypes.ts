import { useState, useEffect, useRef } from 'react';
import * as yaml from 'js-yaml';

type ArtifactTypeMap = Record<string, string>;

// Default mappings as a fallback
const DEFAULT_ARTIFACT_TYPES: ArtifactTypeMap = {
  'application/vnd.oci.image.manifest.v1+json': 'Container Image',
  'application/vnd.oci.empty.v1+json': 'OCI Artifact',
  'application/vnd.docker.container.image.v1+json': 'Container Image',
  'application/vnd.cncf.helm.config.v1+json': 'Helm Chart',
  'application/vnd.dev.cosign.simplesigning.v1+json': 'Cosign Signature',
  'application/vnd.cncf.notary.v2.signature': 'Notary v2 Signature',
  'application/vnd.cncf.notary.signature': 'Notary Signature',
  'application/vnd.sylabs.sif.config.v1+json': 'SIF Container',
  'application/vnd.wasm.config.v1+json': 'WebAssembly Module',
  'application/vnd.cncf.openpolicyagent.config.v1': 'Open Policy Agent Policy',
  'application/vnd.docker.distribution.manifest.v1+json': 'Docker Manifest v1',
  'application/vnd.docker.distribution.manifest.v2+json': 'Docker Manifest v2',
  'application/vnd.docker.distribution.manifest.list.v2+json': 'Docker Manifest List',
  'application/vnd.oci.image.index.v1+json': 'OCI Image Index',
  'application/vnd.oci.artifact.manifest.v1+json': 'OCI Artifact',
  'application/vnd.ms.bicep.module.config.v1+json': 'Bicep Module',
  'application/vnd.ms.bicep.module.artifact': 'Bicep Module',
  'application/vnd.in-toto+json': 'In-Toto Attestation',
  'application/spdx+json': 'SPDX SBOM',
  'application/vnd.cyclonedx+json': 'CycloneDX SBOM',
  'application/sarif+json': 'SARIF Report',
  'application/vnd.aquasecurity.trivy.report.sarif.v1': 'Trivy SARIF Report',
  'application/vnd.aquasecurity.trivy.report.cyclonedx.v1': 'Trivy CycloneDX Report',
  'application/vnd.aquasecurity.trivy.report.spdx.v1': 'Trivy SPDX Report',
  'application/vnd.dev.cosign.artifact.sig.v1+json': 'Cosign Artifact Signature',
  'application/vnd.dev.cosign.artifact.sbom.v1+json': 'Cosign SBOM',
  'application/vnd.dsse.envelope.v1+json': 'DSSE Envelope',
  'application/vnd.oci.image.config.v1+json': 'OCI Image Config',
  'application/vnd.microsoft.artifact.lifecycle': 'Artifact Lifecycle',
};

// Module-level cache so the YAML is fetched once across all component instances
let cachedArtifactTypes: ArtifactTypeMap | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour — this is a static file that only changes between deployments

export default function useArtifactTypes() {
  const [artifactTypes, setArtifactTypes] = useState<ArtifactTypeMap>(cachedArtifactTypes || DEFAULT_ARTIFACT_TYPES);
  const [loading, setLoading] = useState<boolean>(!cachedArtifactTypes);
  const [error, setError] = useState<Error | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    // Skip if already fetched in this component instance or if cache is valid
    if (fetchedRef.current) return;
    if (cachedArtifactTypes && (Date.now() - cacheTimestamp) < CACHE_TTL) {
      setArtifactTypes(cachedArtifactTypes);
      setLoading(false);
      fetchedRef.current = true;
      return;
    }

    const fetchArtifactTypes = async () => {
      try {
        setLoading(true);
        
        const response = await fetch('/artifact-types.yaml');
        
        if (!response.ok) {
          console.error(`Failed to fetch artifact types: ${response.status} ${response.statusText}`);
          return; // Use the default mappings
        }
        
        const yamlText = await response.text();
        
        // Ensure we're not getting an empty object
        if (!yamlText || yamlText.trim() === '') {
          console.error('Empty YAML file received, using default mappings');
          return;
        }
        
        try {
          const parsedYaml = yaml.load(yamlText) as ArtifactTypeMap;
          
          if (!parsedYaml || typeof parsedYaml !== 'object' || Object.keys(parsedYaml).length === 0) {
            console.error('YAML parsed to empty object, using default mappings');
            return;
          }
          
          // Merge with default types to ensure we have all basic mappings
          const mergedTypes = { ...DEFAULT_ARTIFACT_TYPES, ...parsedYaml };
          
          // Update module-level cache
          cachedArtifactTypes = mergedTypes;
          cacheTimestamp = Date.now();
          
          setArtifactTypes(mergedTypes);
        } catch (parseError) {
          console.error('Error parsing YAML:', parseError);
        }
      } catch (err) {
        console.error('Error loading artifact types:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
        fetchedRef.current = true;
      }
    };

    fetchArtifactTypes();
  }, []);

  const getArtifactType = (mediaType: string | undefined): string => {
    if (!mediaType) return 'Unknown';
    return artifactTypes[mediaType] || 'Unknown';
  };

  return {
    artifactTypes,
    loading,
    error,
    getArtifactType
  };
} 