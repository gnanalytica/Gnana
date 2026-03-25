import { Hono } from "hono";
import { eq, and, desc, sql, runs, runLogs, usageRecords, type Database } from "@gnana/db";
import type { EventBus } from "@gnana/core";
import { requireRole } from "../middleware/rbac.js";
import { planRunLimit } from "../middleware/plan-limits.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { cacheControl } from "../middleware/cache.js";
import type { JobQueue } from "../job-queue.js";
import { createRunSchema } from "../validation/schemas.js";
import { errorResponse } from "../utils/errors.js";

export function runRoutes(db: Database, events: EventBus, queue?: JobQueue) {
  const app = new Hono();

  // List runs — viewer+
  app.get("/", requireRole("viewer"), cacheControl("private, max-age=30"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
    const offset = Number(c.req.query("offset")) || 0;

    const whereClause = eq(runs.workspaceId, workspaceId);

    const result = await db
      .select()
      .from(runs)
      .where(whereClause)
      .orderBy(desc(runs.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(runs)
      .where(whereClause);
    const total = countResult[0]?.count ?? 0;

    return c.json({ data: result, total, limit, offset });
  });

  // Get run by ID — viewer+
  app.get("/:id", requireRole("viewer"), cacheControl("private, max-age=120"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    const result = await db
      .select()
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)));
    if (result.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Run not found");
    }
    return c.json(result[0]);
  });

  // Trigger a new run — editor+ with monthly run limit check (10 req/min)
  app.post(
    "/",
    requireRole("editor"),
    rateLimit({ windowMs: 60_000, maxRequests: 10 }),
    planRunLimit(db),
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const body = await c.req.json();
      const parsed = createRunSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Validation failed",
              details: parsed.error.flatten().fieldErrors,
            },
          },
          400,
        );
      }
      const data = parsed.data;
      const result = await db
        .insert(runs)
        .values({
          agentId: data.agentId,
          status: "queued",
          triggerType: data.triggerType ?? "manual",
          triggerData: data.payload ?? {},
          workspaceId,
        })
        .returning();
      const run = result[0]!;

      // Track usage — increment the monthly run counter
      const period = new Date().toISOString().slice(0, 7); // "2026-03"
      await db
        .insert(usageRecords)
        .values({
          workspaceId,
          period,
          runsCount: 1,
          tokensUsed: 0,
        })
        .onConflictDoUpdate({
          target: [usageRecords.workspaceId, usageRecords.period],
          set: {
            runsCount: sql`${usageRecords.runsCount} + 1`,
            updatedAt: new Date(),
          },
        });

      // Enqueue background job if queue is available, otherwise just emit event
      if (queue) {
        await queue.enqueue("run:execute", {
          runId: run.id,
          agentId: run.agentId,
          workspaceId,
        });
      }

      await events.emit("run:queued", { runId: run.id, agentId: run.agentId });
      return c.json(run, 201);
    },
  );

  // Approve run — editor+
  app.post("/:id/approve", requireRole("editor"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    const body = await c.req.json().catch(() => ({}));
    const result = await db
      .update(runs)
      .set({ status: "approved", updatedAt: new Date() })
      .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)))
      .returning();
    if (result.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Run not found");
    }
    await events.emit("run:approved", { runId: id, modifications: body.modifications });
    return c.json(result[0]);
  });

  // Reject run — editor+
  app.post("/:id/reject", requireRole("editor"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    const body = await c.req.json().catch(() => ({}));
    const result = await db
      .update(runs)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)))
      .returning();
    if (result.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Run not found");
    }
    await events.emit("run:rejected", { runId: id, reason: body.reason });
    return c.json(result[0]);
  });

  // Resume run after human gate — editor+
  app.post("/:id/resume", requireRole("editor"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    const existing = await db
      .select()
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)));
    if (existing.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Run not found");
    }
    if (existing[0]!.status !== "awaiting_approval") {
      return errorResponse(c, 409, "CONFLICT", "Run is not awaiting approval");
    }
    await db
      .update(runs)
      .set({ status: "approved", updatedAt: new Date() })
      .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)));
    await events.emit("run:approved", { runId: id });
    if (queue) {
      await queue.enqueue("run:resume", { runId: id, workspaceId });
    }
    return c.json({ ok: true, runId: id, status: "approved" });
  });

  // Cancel run — editor+
  app.post("/:id/cancel", requireRole("editor"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    const result = await db
      .update(runs)
      .set({ status: "failed", error: "Cancelled by user", updatedAt: new Date() })
      .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)))
      .returning();
    if (result.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Run not found");
    }
    return c.json(result[0]);
  });

  // Get run logs — viewer+
  app.get("/:id/logs", requireRole("viewer"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");

    // Verify the run belongs to the current workspace before returning logs
    const run = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)));
    if (run.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Run not found");
    }

    const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
    const offset = Number(c.req.query("offset")) || 0;

    const whereClause = eq(runLogs.runId, id);

    const result = await db
      .select()
      .from(runLogs)
      .where(whereClause)
      .orderBy(desc(runLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(runLogs)
      .where(whereClause);
    const total = countResult[0]?.count ?? 0;

    return c.json({ data: result, total, limit, offset });
  });

  return app;
}
