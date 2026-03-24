import { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import * as jose from "jose";
import { eq, apiKeys, type Database } from "@gnana/db";
import { createHash } from "node:crypto";
import * as Sentry from "@sentry/node";
import { authLog } from "../logger.js";
import { errorResponse } from "../utils/errors.js";

// Extend Hono context with auth info
declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userEmail: string;
  }
}

export function authMiddleware(db: Database) {
  return createMiddleware(async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      authLog.warn({ path: c.req.path }, "Missing authorization header");
      return errorResponse(c, 401, "UNAUTHORIZED", "Missing authorization header");
    }

    const token = authHeader.slice(7);

    // Check if it's an API key (prefixed with gnk_)
    if (token.startsWith("gnk_")) {
      return handleApiKey(c, next, db, token);
    }

    // Otherwise treat as JWT
    return handleJwt(c, next, token);
  });
}

async function handleJwt(c: Context, next: Next, token: string) {
  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);

    if (!payload.sub) {
      authLog.warn({ path: c.req.path }, "JWT missing subject claim");
      return errorResponse(c, 401, "UNAUTHORIZED", "Invalid token: missing subject");
    }

    c.set("userId", payload.sub);
    c.set("userEmail", (payload.email as string) ?? "");
    Sentry.setUser({ id: payload.sub, email: (payload.email as string) ?? undefined });
    await next();
  } catch (err) {
    authLog.warn({ err, path: c.req.path }, "JWT verification failed");
    return errorResponse(c, 401, "UNAUTHORIZED", "Invalid or expired token");
  }
}

async function handleApiKey(c: Context, next: Next, db: Database, key: string) {
  try {
    const keyHash = createHash("sha256").update(key).digest("hex");

    const result = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);

    const apiKey = result[0];
    if (!apiKey) {
      authLog.warn({ path: c.req.path }, "Invalid API key");
      return errorResponse(c, 401, "UNAUTHORIZED", "Invalid API key");
    }

    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      authLog.warn({ path: c.req.path, keyId: apiKey.id }, "Expired API key used");
      return errorResponse(c, 401, "UNAUTHORIZED", "API key expired");
    }

    // Update last used timestamp (fire-and-forget)
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, apiKey.id))
      .then(() => {});

    // For API key auth, use the key creator as the authenticated user
    c.set("userId", apiKey.createdBy ?? "system");
    c.set("userEmail", "");
    Sentry.setUser({ id: apiKey.createdBy ?? "system" });
    Sentry.setTag("auth.method", "api_key");
    await next();
  } catch (err) {
    authLog.error({ err, path: c.req.path }, "API key validation failed");
    return errorResponse(c, 401, "UNAUTHORIZED", "API key validation failed");
  }
}
