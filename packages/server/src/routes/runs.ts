import { Hono } from "hono";
import { eq, and, desc, sql, runs, runLogs, usageRecords, type Database } from "@gnana/db";
import type { EventBus } from "@gnana/core";
import { requireRole } from "../middleware/rbac.js";
import { planRunLimit } from "../middleware/plan-limits.js";

export function runRoutes(db: Database, events: EventBus) {
  const app = new Hono();

  // List runs — viewer+
  app.get("/", requireRole("viewer"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const limit = Number(c.req.query("limit") ?? "50");
    const result = await db
      .select()
      .from(runs)
      .where(eq(runs.workspaceId, workspaceId))
      .orderBy(desc(runs.createdAt))
      .limit(limit);
    return c.json(result);
  });

  // Get run by ID — viewer+
  app.get("/:id", requireRole("viewer"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    const result = await db
      .select()
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)));
    if (result.length === 0) {
      return c.json({ error: "Run not found" }, 404);
    }
    return c.json(result[0]);
  });

  // Trigger a new run — editor+ with monthly run limit check
  app.post("/", requireRole("editor"), planRunLimit(db), async (c) => {
    const workspaceId = c.get("workspaceId");
    const body = await c.req.json();
    const result = await db
      .insert(runs)
      .values({
        agentId: body.agentId,
        status: "queued",
        triggerType: body.triggerType ?? "manual",
        triggerData: body.payload ?? {},
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

    await events.emit("run:queued", { runId: run.id, agentId: run.agentId });
    return c.json(run, 201);
  });

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
      return c.json({ error: "Run not found" }, 404);
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
      return c.json({ error: "Run not found" }, 404);
    }
    await events.emit("run:rejected", { runId: id, reason: body.reason });
    return c.json(result[0]);
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
      return c.json({ error: "Run not found" }, 404);
    }
    return c.json(result[0]);
  });

  // Get run logs — viewer+
  app.get("/:id/logs", requireRole("viewer"), async (c) => {
    const id = c.req.param("id");
    const result = await db.select().from(runLogs).where(eq(runLogs.runId, id));
    return c.json(result);
  });

  return app;
}
