/**
 * SBOM parsers for SPDX 2.3, SPDX 3.0, and CycloneDX JSON formats.
 *
 * Each `extract*` function converts a single raw package/component object
 * into the normalised `SbomPackage` shape used by the UI table.
 *
 * `detectSbomFormat` peeks at a parsed JSON root to decide which parser to
 * use and which JSON array path contains the packages.
 */

import type { SbomPackage, SbomMetadata } from '@/app/types/registry';

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

export interface SbomFormatInfo {
  format: SbomMetadata['format'];
  /** The top-level JSON key that holds the iterable array. */
  arrayKey: string;
  documentName: string;
}

/**
 * Inspect the top-level keys of a parsed SBOM JSON to determine the format.
 * Works on a partially-parsed object (e.g. the first chunk from stream-json).
 */
export function detectSbomFormat(obj: Record<string, unknown>): SbomFormatInfo {
  // Extract a readable name — for SPDX use the document name, for CycloneDX
  // use the root component name. Avoid raw documentNamespace URIs.
  function spdxDocName(): string {
    if (typeof obj.name === 'string' && obj.name) return obj.name;
    // Try extracting the last path segment from documentNamespace
    const ns = obj.documentNamespace as string;
    if (ns) {
      try { return new URL(ns).pathname.split('/').pop() || ''; } catch { /* ignore */ }
    }
    return '';
  }

  // SPDX 2.x — match any spdxVersion string
  if (typeof obj.spdxVersion === 'string') {
    return { format: 'spdx-2.3', arrayKey: 'packages', documentName: spdxDocName() };
  }

  // SPDX 3.0 — uses "@context" with spdx.org
  if (
    obj['@context'] &&
    (typeof obj['@context'] === 'string'
      ? (obj['@context'] as string).includes('spdx.org')
      : Array.isArray(obj['@context']) && JSON.stringify(obj['@context']).includes('spdx.org'))
  ) {
    return { format: 'spdx-3.0', arrayKey: '@graph', documentName: spdxDocName() };
  }

  // CycloneDX
  if (
    obj.bomFormat === 'CycloneDX' ||
    (typeof obj.specVersion === 'string' && obj.components)
  ) {
    return {
      format: 'cyclonedx',
      arrayKey: 'components',
      documentName: (obj.metadata as any)?.component?.name ?? (obj.serialNumber as string) ?? '',
    };
  }

  // Fallback — try SPDX 2.3 if a `packages` array exists
  if (Array.isArray(obj.packages)) {
    return { format: 'spdx-2.3', arrayKey: 'packages', documentName: spdxDocName() };
  }

  // Last resort — try CycloneDX if `components` array exists
  if (Array.isArray(obj.components)) {
    return { format: 'cyclonedx', arrayKey: 'components', documentName: '' };
  }

  return { format: 'spdx-2.3', arrayKey: 'packages', documentName: '' };
}

// ---------------------------------------------------------------------------
// SPDX 2.3 (also handles 2.2)
// ---------------------------------------------------------------------------

/**
 * Extract a normalised `SbomPackage` from an SPDX 2.x `packages[]` element.
 */
export function extractSpdx23Package(raw: Record<string, any>): SbomPackage {
  let type = '';
  let namespace = '';
  let purlStr = '';

  // Try to extract type & namespace from purl in externalRefs
  const purl = extractPurl(raw.externalRefs);
  if (purl) {
    purlStr = purl;
    const parsed = parsePurl(purl);
    type = parsed.type;
    namespace = parsed.namespace;
  }

  // Publisher from supplier / originator (clean up "Organization: …" prefix)
  let publisher = raw.supplier ?? raw.originator ?? '';
  if (typeof publisher === 'string' && publisher.startsWith('Organization:')) {
    publisher = publisher.replace(/^Organization:\s*/, '');
  }

  // Fallback namespace from publisher
  if (!namespace && publisher) {
    namespace = publisher;
  }

  return {
    type: type || inferTypeFromName(raw.name),
    namespace,
    name: raw.name ?? raw.SPDXID ?? '',
    version: raw.versionInfo ?? '',
    license: raw.licenseConcluded ?? raw.licenseDeclared ?? '',
    publisher,
    purl: purlStr,
  };
}

// ---------------------------------------------------------------------------
// SPDX 3.0
// ---------------------------------------------------------------------------

/**
 * Extract from an SPDX 3.0 `@graph` element with type `software_Package`.
 * Returns `null` if the element is not a package.
 */
export function extractSpdx30Package(raw: Record<string, any>): SbomPackage | null {
  // SPDX 3.0 elements have a "type" field; only extract packages
  const elementType = raw.type ?? raw['@type'] ?? '';
  if (
    elementType !== 'software_Package' &&
    elementType !== 'Software.Package' &&
    elementType !== 'Package' &&
    !elementType.toLowerCase().includes('package')
  ) {
    return null;
  }

  let type = '';
  let namespace = '';
  let purlStr = '';

  // purl in externalIdentifiers
  const identifiers = raw.externalIdentifier ?? raw.externalIdentifiers ?? [];
  for (const id of Array.isArray(identifiers) ? identifiers : []) {
    if (
      id.externalIdentifierType === 'packageUrl' ||
      id.externalIdentifierType === 'purl' ||
      (typeof id.identifier === 'string' && id.identifier.startsWith('pkg:'))
    ) {
      purlStr = id.identifier;
      const parsed = parsePurl(id.identifier);
      type = parsed.type;
      namespace = parsed.namespace;
      break;
    }
  }

  const supplied = raw.software_suppliedBy ?? raw.suppliedBy ?? '';
  const publisher = typeof supplied === 'string' ? supplied : supplied?.name ?? '';
  if (!namespace) namespace = publisher;

  return {
    type: type || inferTypeFromName(raw.name),
    namespace,
    name: raw.name ?? raw.software_packageName ?? raw['@id'] ?? '',
    version: raw.software_packageVersion ?? raw.packageVersion ?? '',
    license:
      raw.simplelicensing_declaredLicense ??
      raw.declaredLicense ??
      raw.concludedLicense ??
      '',
    publisher,
    purl: purlStr,
  };
}

// ---------------------------------------------------------------------------
// CycloneDX
// ---------------------------------------------------------------------------

/**
 * Extract from a CycloneDX `components[]` element.
 */
export function extractCycloneDxComponent(raw: Record<string, any>): SbomPackage {
  let type = raw.type ?? '';
  let namespace = raw.group ?? '';

  // Try purl
  if (raw.purl) {
    const parsed = parsePurl(raw.purl);
    if (parsed.type) type = parsed.type;
    if (parsed.namespace && !namespace) namespace = parsed.namespace;
  }

  // License extraction — CycloneDX has a `licenses` array
  let license = '';
  if (Array.isArray(raw.licenses) && raw.licenses.length > 0) {
    const first = raw.licenses[0];
    license =
      first.license?.id ??
      first.license?.name ??
      first.expression ??
      '';
  }

  return {
    type,
    namespace,
    name: raw.name ?? '',
    version: raw.version ?? '',
    license,
    publisher: raw.publisher ?? raw.author ?? '',
    purl: raw.purl ?? '',
  };
}

// ---------------------------------------------------------------------------
// Purl helpers
// ---------------------------------------------------------------------------

function extractPurl(externalRefs: any[] | undefined): string | undefined {
  if (!Array.isArray(externalRefs)) return undefined;
  for (const ref of externalRefs) {
    if (
      ref.referenceType === 'purl' ||
      ref.referenceCategory === 'PACKAGE-MANAGER' ||
      ref.referenceCategory === 'PACKAGE_MANAGER' ||
      (typeof ref.referenceLocator === 'string' &&
        ref.referenceLocator.startsWith('pkg:'))
    ) {
      return ref.referenceLocator;
    }
  }
  return undefined;
}

/**
 * Minimal purl parser: `pkg:type/namespace/name@version`
 * We only need type and namespace here.
 */
function parsePurl(purl: string): { type: string; namespace: string } {
  try {
    // Remove "pkg:" prefix
    const body = purl.replace(/^pkg:/, '');
    const slashIdx = body.indexOf('/');
    if (slashIdx === -1) return { type: body, namespace: '' };

    const type = body.slice(0, slashIdx);
    const rest = body.slice(slashIdx + 1);

    // rest = namespace/name@version?qualifiers#subpath  OR  name@version
    const atIdx = rest.indexOf('@');
    const pathPart = atIdx === -1 ? rest : rest.slice(0, atIdx);
    const qIdx = pathPart.indexOf('?');
    const cleanPath = qIdx === -1 ? pathPart : pathPart.slice(0, qIdx);

    const segments = cleanPath.split('/');
    if (segments.length > 1) {
      // Everything except the last segment is namespace
      const namespace = decodeURIComponent(segments.slice(0, -1).join('/'));
      return { type, namespace };
    }

    return { type, namespace: '' };
  } catch {
    return { type: '', namespace: '' };
  }
}

/** Best-effort type inference when no purl is available. */
function inferTypeFromName(name?: string): string {
  if (!name) return '';
  if (name.startsWith('@') || name.includes('/')) return 'npm';
  if (name.includes('.') && !name.includes(' ')) return 'maven';
  return '';
}
