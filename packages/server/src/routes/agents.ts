import { Hono } from "hono";
import { eq, and, agents, type Database } from "@gnana/db";
import { requireRole } from "../middleware/rbac.js";
import { planLimit } from "../middleware/plan-limits.js";

export function agentRoutes(db: Database) {
  const app = new Hono();

  // List agents — viewer+
  app.get("/", requireRole("viewer"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const result = await db
      .select()
      .from(agents)
      .where(and(eq(agents.workspaceId, workspaceId), eq(agents.enabled, true)));
    return c.json(result);
  });

  // Get agent by ID — viewer+
  app.get("/:id", requireRole("viewer"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    const result = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)));
    if (result.length === 0) {
      return c.json({ error: "Agent not found" }, 404);
    }
    return c.json(result[0]);
  });

  // Create agent — editor+ with plan limit check
  app.post("/", requireRole("editor"), planLimit(db, "maxAgents", agents), async (c) => {
    const workspaceId = c.get("workspaceId");
    const body = await c.req.json();
    const result = await db
      .insert(agents)
      .values({
        name: body.name,
        description: body.description ?? "",
        systemPrompt: body.systemPrompt,
        toolsConfig: body.toolsConfig ?? {},
        llmConfig: body.llmConfig,
        triggersConfig: body.triggersConfig ?? [],
        approval: body.approval ?? "required",
        maxToolRounds: body.maxToolRounds ?? 10,
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
    const result = await db
      .update(agents)
      .set({
        ...body,
        updatedAt: new Date(),
      })
      .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)))
      .returning();
    if (result.length === 0) {
      return c.json({ error: "Agent not found" }, 404);
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
