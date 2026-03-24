import { createMiddleware } from "hono/factory";
import { errorResponse } from "../utils/errors.js";

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 60_000);

export function rateLimit(config: RateLimitConfig = { windowMs: 60_000, maxRequests: 100 }) {
  return createMiddleware(async (c, next) => {
    // Use userId if authenticated, otherwise IP
    const userId = c.get("userId") as string | undefined;
    const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
    const key = userId ?? ip;

    const now = Date.now();
    let entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + config.windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    const remaining = Math.max(0, config.maxRequests - entry.count);
    c.header("X-RateLimit-Limit", String(config.maxRequests));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > config.maxRequests) {
      return errorResponse(c, 429, "RATE_LIMITED", "Too many requests. Please try again later.");
    }

    await next();
  });
}
