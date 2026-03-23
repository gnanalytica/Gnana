import { createMiddleware } from "hono/factory";
import { eq, sql, workspaces, plans, usageRecords, type Database } from "@gnana/db";

/**
 * Middleware factory that checks workspace plan limits before resource creation.
 */
export function planLimit(
  db: Database,
  limitField: "maxAgents" | "maxConnectors" | "maxMembers",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
) {
  return createMiddleware(async (c, next) => {
    const workspaceId = c.get("workspaceId") as string;

    // Get workspace's plan
    const ws = await db
      .select({ planId: workspaces.planId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (!ws[0]?.planId) {
      // No plan assigned — no limits enforced
      await next();
      return;
    }

    const plan = await db.select().from(plans).where(eq(plans.id, ws[0].planId)).limit(1);

    if (!plan[0]) {
      await next();
      return;
    }

    const limit = plan[0][limitField];
    if (limit === -1) {
      // -1 means unlimited
      await next();
      return;
    }

    // Count current resources belonging to this workspace
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(sql`workspace_id = ${workspaceId}`);

    const current = countResult[0]?.count ?? 0;

    if (current >= limit) {
      return c.json(
        {
          error: `Plan limit reached for ${limitField}. Upgrade your plan to create more.`,
          limit,
          current,
        },
        403,
      );
    }

    await next();
  });
}

/**
 * Middleware that checks monthly run limits before allowing a new run.
 *
 * Reads the workspace's plan `maxRunsMonth` and compares against the current
 * month's usage record.  A limit of -1 means unlimited.
 *
 * Usage:
 *   app.post("/runs", planRunLimit(db), handler)
 */
export function planRunLimit(db: Database) {
  return createMiddleware(async (c, next) => {
    const workspaceId = c.get("workspaceId") as string;

    // Get workspace's plan
    const ws = await db
      .select({ planId: workspaces.planId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (!ws[0]?.planId) {
      await next();
      return;
    }

    const plan = await db.select().from(plans).where(eq(plans.id, ws[0].planId)).limit(1);

    if (!plan[0]) {
      await next();
      return;
    }

    const limit = plan[0].maxRunsMonth;
    if (limit === -1) {
      await next();
      return;
    }

    // Check current month's usage
    const period = new Date().toISOString().slice(0, 7); // "2026-03"
    const usage = await db
      .select({ runsCount: usageRecords.runsCount })
      .from(usageRecords)
      .where(
        sql`${usageRecords.workspaceId} = ${workspaceId} AND ${usageRecords.period} = ${period}`,
      )
      .limit(1);

    const current = usage[0]?.runsCount ?? 0;

    if (current >= limit) {
      return c.json(
        {
          error: "Monthly run limit reached. Upgrade your plan to run more agents.",
          limit,
          current,
        },
        403,
      );
    }

    await next();
  });
}
