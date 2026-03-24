import { createMiddleware } from "hono/factory";

// ---------------------------------------------------------------------------
// Simple in-memory TTL cache (Map-backed, no external deps)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/** Return cached value or undefined if missing / expired. */
export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return undefined;
  }
  return entry.data as T;
}

/** Store a value with a TTL (default 5 minutes). */
export function setCache(key: string, data: unknown, ttlMs = 300_000): void {
  store.set(key, { data, expires: Date.now() + ttlMs });
}

/** Invalidate a single key. */
export function invalidateCache(key: string): void {
  store.delete(key);
}

/** Invalidate all keys matching a prefix. */
export function invalidateCacheByPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP Cache-Control middleware for GET responses
// ---------------------------------------------------------------------------

/**
 * Sets `Cache-Control` header on GET responses.
 *
 * Usage:
 *   app.get("/agents", cacheControl("private, max-age=60"), handler)
 */
export function cacheControl(directive: string) {
  return createMiddleware(async (c, next) => {
    await next();
    // Only apply to successful GET responses
    if (c.req.method === "GET" && c.res.status >= 200 && c.res.status < 300) {
      c.res.headers.set("Cache-Control", directive);
    }
  });
}
