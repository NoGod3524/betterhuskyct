/**
 * A small fixed-window rate limiter.
 *
 * Deliberately in-memory and per-instance: this is a best-effort guard for a
 * tool with one expensive endpoint, not a distributed quota. Serverless
 * instances do not share memory, so a determined caller can spread requests
 * across them. It still stops the realistic case — one script hammering one warm
 * instance — and it keeps the app honest about what it does and does not claim.
 */
export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function createRateLimiter({
  windowMs,
  max,
  maxKeys = 1_000,
}: {
  windowMs: number;
  max: number;
  maxKeys?: number;
}): (key: string, now?: number) => RateLimitResult {
  const hits = new Map<string, number[]>();

  /** Keeps a flood of distinct keys from growing the map without bound. */
  function pruneOldest(now: number) {
    for (const [key, times] of hits) {
      if (times.length === 0 || now - times[times.length - 1] >= windowMs) {
        hits.delete(key);
      }
    }
    // Still too many live keys: drop the oldest ones outright.
    if (hits.size > maxKeys) {
      const excess = hits.size - maxKeys;
      let dropped = 0;
      for (const key of hits.keys()) {
        hits.delete(key);
        if (++dropped >= excess) break;
      }
    }
  }

  return function check(key: string, now: number = Date.now()): RateLimitResult {
    const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);

    if (recent.length >= max) {
      hits.set(key, recent);
      const oldest = recent[0];
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      };
    }

    recent.push(now);
    hits.set(key, recent);
    if (hits.size > maxKeys) pruneOldest(now);

    return { allowed: true, remaining: max - recent.length, retryAfterSeconds: 0 };
  };
}

/**
 * The caller's address as seen through Vercel's proxy, or a shared bucket.
 *
 * Headers the platform writes come first. `x-forwarded-for` is a list any
 * client can start, so behind a proxy that appends rather than replaces it, its
 * first entry is whatever the caller chose — and a fresh made-up address per
 * request was a fresh bucket per request. It is kept last, for hosts that set
 * nothing else.
 */
export function clientKey(request: Request): string {
  const header = (name: string) =>
    request.headers.get(name)?.split(",")[0]?.trim() || null;

  return (
    header("x-vercel-forwarded-for") ??
    header("x-real-ip") ??
    header("x-forwarded-for") ??
    "unknown"
  );
}
