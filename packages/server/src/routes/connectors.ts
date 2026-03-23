import { Hono } from "hono";
import { eq, and, connectors, connectorTools, type Database } from "@gnana/db";
import { requireRole } from "../middleware/rbac.js";
import { planLimit } from "../middleware/plan-limits.js";

export function connectorRoutes(db: Database) {
  const app = new Hono();

  // List connectors — viewer+
  app.get("/", requireRole("viewer"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const result = await db
      .select()
      .from(connectors)
      .where(eq(connectors.workspaceId, workspaceId));
    return c.json(result);
  });

  // Get connector by ID — viewer+
  app.get("/:id", requireRole("viewer"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    const result = await db
      .select()
      .from(connectors)
      .where(and(eq(connectors.id, id), eq(connectors.workspaceId, workspaceId)));
    if (result.length === 0) {
      return c.json({ error: "Connector not found" }, 404);
    }
    return c.json(result[0]);
  });

  // Register connector — admin+ with plan limit check
  app.post("/", requireRole("admin"), planLimit(db, "maxConnectors", connectors), async (c) => {
    const workspaceId = c.get("workspaceId");
    const body = await c.req.json();
    const result = await db
      .insert(connectors)
      .values({
        type: body.type,
        name: body.name,
        authType: body.authType,
        credentials: body.credentials,
        config: body.config ?? {},
        workspaceId,
      })
      .returning();
    return c.json(result[0], 201);
  });

  // Get connector tools — viewer+
  app.get("/:id/tools", requireRole("viewer"), async (c) => {
    const id = c.req.param("id");
    const result = await db.select().from(connectorTools).where(eq(connectorTools.connectorId, id));
    return c.json(result);
  });

  // Delete connector — admin+
  app.delete("/:id", requireRole("admin"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    await db
      .update(connectors)
      .set({ enabled: false })
      .where(and(eq(connectors.id, id), eq(connectors.workspaceId, workspaceId)));
    return c.json({ ok: true });
  });

  // Test connector — admin+
  app.post("/:id/test", requireRole("admin"), async (c) => {
    // Placeholder — connector testing will be implemented with connector system
    return c.json({ ok: true, message: "Connection test not yet implemented" });
  });

  return app;
}
