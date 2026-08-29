// Per-client rate limiting for the public HTTP surface.
//
// The catalog's writes are key-gated, but three unauthenticated paths
// still append to the events table or burn CPU: discover (runs the
// embedder AND records the query), feedback, and plain reads that log
// resolve events. Without a brake, one script can bloat the event log,
// stuff the public demand report, or keep the single vCPU busy.
//
// Fixed-window counters per client IP, three buckets. Deliberately
// in-memory: state resets on restart, which is fine — this is a brake,
// not an accounting system.

export interface RateLimits {
  windowMs: number;
  /** Any read/route not covered below. */
  general: number;
  /** Discover calls — the expensive path, and the demand-report input. */
  discover: number;
  /** Feedback submissions. */
  feedback: number;
}

export const DEFAULT_LIMITS: RateLimits = {
  windowMs: 60_000,
  general: 300,
  discover: 60,
  feedback: 10,
};

export type Bucket = keyof Omit<RateLimits, "windowMs">;

interface Window {
  resetAt: number;
  counts: Record<Bucket, number>;
}

export class RateLimiter {
  private windows = new Map<string, Window>();

  constructor(private limits: RateLimits = DEFAULT_LIMITS) {}

  /**
   * Count one request. Returns null when allowed, or seconds-until-reset
   * when the client is over the bucket's limit.
   */
  hit(clientKey: string, bucket: Bucket): number | null {
    const now = Date.now();
    let w = this.windows.get(clientKey);
    if (!w || w.resetAt <= now) {
      w = { resetAt: now + this.limits.windowMs, counts: { general: 0, discover: 0, feedback: 0 } };
      this.windows.set(clientKey, w);
    }
    w.counts[bucket]++;
    if (w.counts[bucket] > this.limits[bucket]) {
      return Math.max(1, Math.ceil((w.resetAt - now) / 1000));
    }
    // Bound the map so an address-rotating scanner can't grow it forever.
    if (this.windows.size > 10_000) {
      for (const [k, v] of this.windows) {
        if (v.resetAt <= now) this.windows.delete(k);
      }
      // Still huge after sweeping? Drop oldest entries wholesale.
      if (this.windows.size > 10_000) {
        const excess = this.windows.size - 10_000;
        let i = 0;
        for (const k of this.windows.keys()) {
          if (i++ >= excess) break;
          this.windows.delete(k);
        }
      }
    }
    return null;
  }
}

/**
 * The client's address for limiting purposes. Behind the local Caddy
 * proxy the socket is loopback and X-Forwarded-For carries the real
 * client; a direct connection is its own evidence. Only trust the
 * forwarded header when the socket itself is the local proxy.
 */
export function clientKey(remoteAddress: string | undefined, xff: string | undefined): string {
  const sock = remoteAddress ?? "unknown";
  const isLocalProxy = sock === "127.0.0.1" || sock === "::1" || sock === "::ffff:127.0.0.1";
  if (isLocalProxy && xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return sock;
}
