import { Hono } from "hono";
import { eq, and, desc, sql, agents, type Database } from "@gnana/db";
import { requireRole } from "../middleware/rbac.js";
import { planLimit } from "../middleware/plan-limits.js";
import { cacheControl } from "../middleware/cache.js";
import { createAgentSchema, updateAgentSchema } from "../validation/schemas.js";
import { errorResponse } from "../utils/errors.js";

export function agentRoutes(db: Database) {
  const app = new Hono();

  // List agents — viewer+
  app.get("/", requireRole("viewer"), cacheControl("private, max-age=60"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
    const offset = Number(c.req.query("offset")) || 0;

    const whereClause = and(eq(agents.workspaceId, workspaceId), eq(agents.enabled, true));

    const result = await db
      .select()
      .from(agents)
      .where(whereClause)
      .orderBy(desc(agents.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(agents)
      .where(whereClause);
    const total = countResult[0]?.count ?? 0;

    return c.json({ data: result, total, limit, offset });
  });

  // Get agent by ID — viewer+
  app.get("/:id", requireRole("viewer"), cacheControl("private, max-age=120"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    const result = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)));
    if (result.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Agent not found");
    }
    return c.json(result[0]);
  });

  // Create agent — editor+ with plan limit check
  app.post("/", requireRole("editor"), planLimit(db, "maxAgents", agents), async (c) => {
    const workspaceId = c.get("workspaceId");
    const body = await c.req.json();
    const parsed = createAgentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Validation failed", details: parsed.error.flatten().fieldErrors } }, 400);
    }
    const data = parsed.data;
    const result = await db
      .insert(agents)
      .values({
        name: data.name,
        description: data.description ?? "",
        systemPrompt: data.systemPrompt,
        toolsConfig: data.toolsConfig ?? {},
        llmConfig: data.llmConfig,
        triggersConfig: data.triggersConfig ?? [],
        approval: data.approval ?? "required",
        maxToolRounds: data.maxToolRounds ?? 10,
        workspaceId,
      })
      .returning();
    return c.json(result[0], 201);
  });

  // Update agent — editor+
  app.put("/:id", requireRole("editor"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    const body = await c.req.json();
    const parsed = updateAgentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Validation failed", details: parsed.error.flatten().fieldErrors } }, 400);
    }
    const data = parsed.data;
    const result = await db
      .update(agents)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)))
      .returning();
    if (result.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Agent not found");
    }
    return c.json(result[0]);
  });

  // Delete agent — editor+
  app.delete("/:id", requireRole("editor"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    await db
      .update(agents)
      .set({ enabled: false })
      .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)));
    return c.json({ ok: true });
  });

  return app;
}
