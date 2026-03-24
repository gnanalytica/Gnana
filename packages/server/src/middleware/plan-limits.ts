import { createMiddleware } from "hono/factory";
import { eq, sql, workspaces, plans, usageRecords, type Database } from "@gnana/db";
import { getCached, setCache } from "./cache.js";
import { errorResponse } from "../utils/errors.js";

const PLAN_TTL = 300_000; // 5 minutes

interface PlanCache {
  planId: string | null;
  maxAgents: number;
  maxConnectors: number;
  maxMembers: number;
  maxRunsMonth: number;
}

/**
 * Fetch the workspace plan (with caching). Returns undefined if no plan.
 */
async function getWorkspacePlan(db: Database, workspaceId: string): Promise<PlanCache | undefined> {
  const cacheKey = `plan:${workspaceId}`;
  const cached = getCached<PlanCache>(cacheKey);
  if (cached) return cached;

  const ws = await db
    .select({ planId: workspaces.planId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!ws[0]?.planId) return undefined;

  const planRows = await db.select().from(plans).where(eq(plans.id, ws[0].planId)).limit(1);

  if (!planRows[0]) return undefined;

  const result: PlanCache = {
    planId: ws[0].planId,
    maxAgents: planRows[0].maxAgents,
    maxConnectors: planRows[0].maxConnectors,
    maxMembers: planRows[0].maxMembers,
    maxRunsMonth: planRows[0].maxRunsMonth,
  };

  setCache(cacheKey, result, PLAN_TTL);
  return result;
}

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

    const plan = await getWorkspacePlan(db, workspaceId);
    if (!plan) {
      // No plan assigned — no limits enforced
      await next();
      return;
    }

    const limit = plan[limitField];
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
      return errorResponse(
        c,
        403,
        "FORBIDDEN",
        `Plan limit reached for ${limitField} (${current}/${limit}). Upgrade your plan to create more.`,
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

    const plan = await getWorkspacePlan(db, workspaceId);
    if (!plan) {
      await next();
      return;
    }

    const limit = plan.maxRunsMonth;
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
      return errorResponse(
        c,
        403,
        "FORBIDDEN",
        `Monthly run limit reached (${current}/${limit}). Upgrade your plan to run more agents.`,
      );
    }

    await next();
  });
}
