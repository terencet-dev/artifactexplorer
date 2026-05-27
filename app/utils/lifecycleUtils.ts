import registryService from '@/app/services/registryService';
import { Registry } from '@/app/types/registry';
import { discoverReferrers } from '@/app/registry/[repository]/tags/[tag]/actions';

export type EolStatus = 'expired' | 'warning' | 'upcoming';

export interface LifecycleInfo {
  eolDate: string | null;
  formattedEolDate: string | null;
  /** Status: 'expired' (past EOL), 'warning' (within 30 days), 'upcoming' (more than 30 days) */
  eolStatus: EolStatus | null;
  /** Days until EOL (negative if past, positive if future) */
  daysUntilEol: number | null;
}

/**
 * Fetch and extract the End-of-Life date from a tag's lifecycle artifact
 * Reuses the existing referrers API logic from the Supply Chain tab
 */
export async function getLifecycleInfo(
  registry: Registry,
  repository: string,
  tag: string,
  digest?: string
): Promise<LifecycleInfo | null> {
  try {
    if (!registry?.id) {
      console.error('Registry ID is required to fetch lifecycle info');
      return null;
    }
    
    console.log(`[lifecycleUtils] Getting lifecycle info for ${repository}:${tag}`);
    
    // Step 1: Use the referrers API to get the lifecycle artifact
    const referrersResult = await discoverReferrers(
      registry.server,
      repository,
      tag, 
      registry.id
    );
    
    if (!referrersResult.success || referrersResult.noReferrers) {
      console.log(`[lifecycleUtils] No referrers found for ${repository}:${tag}`);
      return null;
    }
    
    // Step 2: Find the lifecycle artifact referrer
    const lifecycleReferrer = referrersResult.raw.find(
      (referrer) => referrer.artifactType === 'application/vnd.microsoft.artifact.lifecycle'
    );
    
    if (!lifecycleReferrer) {
      console.log(`[lifecycleUtils] No lifecycle artifact found for ${repository}:${tag}`);
      return null;
    }
    
    // Step 3: Get the digest of the lifecycle artifact
    const lifecycleDigest = lifecycleReferrer.digest;
    if (!lifecycleDigest) {
      console.warn(`[lifecycleUtils] Lifecycle artifact does not have a digest`);
      return null;
    }
    
    console.log(`[lifecycleUtils] Found lifecycle artifact with digest: ${lifecycleDigest}`);
    
    // Step 4: Fetch the manifest of the lifecycle artifact
    // This is a workaround since we're using a digest as the tag
    const lifecycleManifest = await registryService.getManifest(
      registry,
      repository,
      lifecycleDigest
    );
    
    if (!lifecycleManifest || !lifecycleManifest.annotations) {
      console.warn(`[lifecycleUtils] Failed to retrieve lifecycle manifest or it has no annotations`);
      return null;
    }
    
    // Step 5: Extract EOL date from the annotations
    const eolDate = lifecycleManifest.annotations['vnd.microsoft.artifact.lifecycle.end-of-life.date'];
    
    if (!eolDate) {
      console.warn(`[lifecycleUtils] Lifecycle manifest does not contain EOL date`);
      return null;
    }
    
    // Step 6: Format the date for display and calculate status
    const formattedEolDate = formatEolDate(eolDate);
    const { status, daysUntil } = calculateEolStatus(eolDate);
    
    return {
      eolDate,
      formattedEolDate,
      eolStatus: status,
      daysUntilEol: daysUntil
    };
  } catch (error) {
    console.error('[lifecycleUtils] Error fetching lifecycle info:', error);
    return null;
  }
}

/**
 * Format the EOL date in a human-readable format
 */
function formatEolDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (error) {
    console.error('Failed to format EOL date:', error);
    return dateString; // Return original string if parsing fails
  }
}

/**
 * Calculate the EOL status and days until EOL
 * @returns status: 'expired' | 'warning' | 'upcoming', daysUntil: number
 */
function calculateEolStatus(dateString: string): { status: EolStatus; daysUntil: number } {
  try {
    const eolDate = new Date(dateString);
    const today = new Date();
    
    // Reset time portion for accurate day calculation
    eolDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    
    // Calculate difference in days
    const diffTime = eolDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    let status: EolStatus;
    if (diffDays < 0) {
      // EOL date has passed
      status = 'expired';
    } else if (diffDays <= 30) {
      // Within 30 days of EOL
      status = 'warning';
    } else {
      // More than 30 days until EOL
      status = 'upcoming';
    }
    
    return { status, daysUntil: diffDays };
  } catch (error) {
    console.error('Failed to calculate EOL status:', error);
    // Default to expired if we can't parse the date
    return { status: 'expired', daysUntil: 0 };
  }
}

/**
 * Get a human-readable message for the EOL status
 */
export function getEolMessage(lifecycleInfo: LifecycleInfo): string {
  if (!lifecycleInfo.eolDate || lifecycleInfo.eolStatus === null || lifecycleInfo.daysUntilEol === null) {
    return '';
  }
  
  const days = Math.abs(lifecycleInfo.daysUntilEol);
  const formattedDate = lifecycleInfo.formattedEolDate || lifecycleInfo.eolDate;
  
  switch (lifecycleInfo.eolStatus) {
    case 'expired':
      return `This tag has reached end of life ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`} on ${formattedDate}.`;
    case 'warning':
      return `This tag will reach end of life in ${days} day${days === 1 ? '' : 's'} on ${formattedDate}.`;
    case 'upcoming':
      return `This tag end of life in ${days} day${days === 1 ? '' : 's'} on ${formattedDate}.`;
    default:
      return '';
  }
} 