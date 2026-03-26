import type { Context } from "hono";
import { auditLogs, type Database } from "@gnana/db";

const SENSITIVE_KEYS = new Set([
  "apiKey",
  "password",
  "secret",
  "token",
  "credentials",
  "passwordHash",
]);

/**
 * Redact sensitive fields in a changes object.
 * Shallow redaction — only checks top-level keys.
 */
function redactSensitive(changes: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    redacted[key] = SENSITIVE_KEYS.has(key) ? "[REDACTED]" : value;
  }
  return redacted;
}

/**
 * Extract the client IP address from a Hono context.
 * Checks common proxy headers first, falls back to connection info.
 */
export function getClientIp(c: Context): string | undefined {
  // X-Forwarded-For may contain multiple IPs; take the first (client)
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim();
  }
  return c.req.header("x-real-ip") ?? undefined;
}

export interface AuditLogParams {
  workspaceId: string;
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Fire-and-forget insert into the audit_logs table.
 *
 * Usage:
 *   logAudit(db, { workspaceId, userId, action: "agent.created", ... }).catch(() => {});
 */
export async function logAudit(db: Database, params: AuditLogParams): Promise<void> {
  await db.insert(auditLogs).values({
    workspaceId: params.workspaceId,
    userId: params.userId,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    changes: params.changes ? redactSensitive(params.changes) : undefined,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

/**
 * Helper to build common audit params from a Hono context.
 */
export function auditContext(
  c: Context,
): Pick<AuditLogParams, "workspaceId" | "userId" | "ipAddress" | "userAgent"> {
  return {
    workspaceId: c.get("workspaceId") as string,
    userId: c.get("userId") as string,
    ipAddress: getClientIp(c),
    userAgent: c.req.header("user-agent"),
  };
}
