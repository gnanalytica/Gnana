/**
 * Simple in-memory rate limiter using a Map with automatic cleanup.
 *
 * Usage:
 *   const limiter = createRateLimiter({ maxAttempts: 5, windowMs: 15 * 60 * 1000 });
 *   const { allowed, remaining, retryAfterMs } = limiter.check(key);
 */

interface RateLimitEntry {
  count: number;
  expiresAt: number;
}

interface RateLimiterOptions {
  /** Maximum number of attempts allowed within the window. */
  maxAttempts: number;
  /** Time window in milliseconds. */
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const { maxAttempts, windowMs } = options;
  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup every 60 seconds to prevent memory leaks
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  }, 60_000);

  // Allow the timer to be garbage-collected when the process shuts down
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  function check(key: string): RateLimitResult {
    const now = Date.now();
    const entry = store.get(key);

    // If no entry or expired, start a fresh window
    if (!entry || entry.expiresAt <= now) {
      store.set(key, { count: 1, expiresAt: now + windowMs });
      return { allowed: true, remaining: maxAttempts - 1, retryAfterMs: 0 };
    }

    // Within the window — increment and check
    entry.count += 1;

    if (entry.count > maxAttempts) {
      const retryAfterMs = entry.expiresAt - now;
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    return { allowed: true, remaining: maxAttempts - entry.count, retryAfterMs: 0 };
  }

  return { check };
}

/**
 * Extract client IP from the request for rate limiting.
 * Checks x-forwarded-for first (reverse proxy), then x-real-ip.
 * Falls back to "unknown" if neither header is present.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list; take the first (client) IP
    return forwarded.split(",")[0]!.trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}
