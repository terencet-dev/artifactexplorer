/**
 * Rate-limit tracker for OCI registry API calls.
 *
 * Shared by the server-side cron crawler and the client-side on-demand crawl.
 * Tracks 429 responses per registry and applies exponential back-off so the
 * crawl slows gracefully instead of hammering a throttled endpoint.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  /** How many consecutive 429s we have seen for this registry. */
  consecutive429s: number;
  /** Timestamp (ms) when the current back-off period ends. */
  backoffUntil: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_BACKOFF_MS = 10_000;   // 10 seconds
const MAX_BACKOFF_MS     = 120_000;  // 2 minutes
const MAX_CONSECUTIVE    = 5;        // surface warning after this many

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class RateLimitTracker {
  private entries = new Map<string, RateLimitEntry>();

  /** Record a successful request — resets the back-off counter. */
  recordSuccess(registryId: string): void {
    this.entries.delete(registryId);
  }

  /**
   * Record a 429 response.
   *
   * @param registryId  Registry identifier.
   * @param retryAfter  Optional `Retry-After` header value (seconds).
   */
  record429(registryId: string, retryAfter?: number): void {
    const entry = this.entries.get(registryId) ?? {
      consecutive429s: 0,
      backoffUntil: 0,
    };

    entry.consecutive429s += 1;

    // Prefer the server-provided Retry-After; otherwise exponential back-off
    const delay = retryAfter
      ? retryAfter * 1000
      : Math.min(
          INITIAL_BACKOFF_MS * Math.pow(2, entry.consecutive429s - 1),
          MAX_BACKOFF_MS,
        );

    entry.backoffUntil = Date.now() + delay;
    this.entries.set(registryId, entry);
  }

  /**
   * Check whether we should wait before making the next request.
   *
   * @returns `{ wait: false }` if OK to proceed, or
   *          `{ wait: true, delayMs, hitMax }` if the caller should pause.
   */
  shouldWait(registryId: string): {
    wait: boolean;
    delayMs: number;
    /** `true` when consecutive 429s have exceeded MAX_CONSECUTIVE. */
    hitMax: boolean;
  } {
    const entry = this.entries.get(registryId);
    if (!entry) return { wait: false, delayMs: 0, hitMax: false };

    const remaining = entry.backoffUntil - Date.now();
    if (remaining <= 0) {
      return { wait: false, delayMs: 0, hitMax: entry.consecutive429s >= MAX_CONSECUTIVE };
    }

    return {
      wait: true,
      delayMs: remaining,
      hitMax: entry.consecutive429s >= MAX_CONSECUTIVE,
    };
  }

  /** Number of consecutive 429s for a given registry. */
  getConsecutive429s(registryId: string): number {
    return this.entries.get(registryId)?.consecutive429s ?? 0;
  }

  /** Reset all state. */
  clear(): void {
    this.entries.clear();
  }
}

/** Singleton — shared within a single server function / client session. */
export const rateLimiter = new RateLimitTracker();
