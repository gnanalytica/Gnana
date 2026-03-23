import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Database } from "@gnana/db";
import { connectors, connectorTools } from "@gnana/db";

export function connectorRoutes(db: Database) {
  const app = new Hono();

  // List connectors
  app.get("/", async (c) => {
    const result = await db.select().from(connectors);
    return c.json(result);
  });

  // Get connector by ID
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const result = await db.select().from(connectors).where(eq(connectors.id, id));
    if (result.length === 0) {
      return c.json({ error: "Connector not found" }, 404);
    }
    return c.json(result[0]);
  });

  // Register connector
  app.post("/", async (c) => {
    const body = await c.req.json();
    const result = await db
      .insert(connectors)
      .values({
        type: body.type,
        name: body.name,
        authType: body.authType,
        credentials: body.credentials,
        config: body.config ?? {},
        workspaceId: body.workspaceId,
      })
      .returning();
    return c.json(result[0], 201);
  });

  // Get connector tools
  app.get("/:id/tools", async (c) => {
    const id = c.req.param("id");
    const result = await db.select().from(connectorTools).where(eq(connectorTools.connectorId, id));
    return c.json(result);
  });

  // Delete connector
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    await db.update(connectors).set({ enabled: false }).where(eq(connectors.id, id));
    return c.json({ ok: true });
  });

  // Test connector
  app.post("/:id/test", async (c) => {
    // Placeholder — connector testing will be implemented with connector system
    return c.json({ ok: true, message: "Connection test not yet implemented" });
  });

  return app;
}
