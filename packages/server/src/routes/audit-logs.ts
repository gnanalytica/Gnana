import { Hono } from "hono";
import { eq, and, desc, sql, gte, lte, auditLogs, type Database } from "@gnana/db";
import { requireRole } from "../middleware/rbac.js";

export function auditLogRoutes(db: Database) {
  const app = new Hono();

  // List audit logs — admin+ only, paginated with filters
  app.get("/", requireRole("admin"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
    const offset = Number(c.req.query("offset")) || 0;

    // Optional filters
    const actionFilter = c.req.query("action");
    const userIdFilter = c.req.query("userId");
    const from = c.req.query("from");
    const to = c.req.query("to");

    // Build conditions array
    const conditions = [eq(auditLogs.workspaceId, workspaceId)];

    if (actionFilter) {
      conditions.push(eq(auditLogs.action, actionFilter));
    }
    if (userIdFilter) {
      conditions.push(eq(auditLogs.userId, userIdFilter));
    }
    if (from) {
      conditions.push(gte(auditLogs.createdAt, new Date(from)));
    }
    if (to) {
      conditions.push(lte(auditLogs.createdAt, new Date(to)));
    }

    const whereClause = and(...conditions);

    const [result, countResult] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;

    return c.json({ data: result, total, limit, offset });
  });

  return app;
}
