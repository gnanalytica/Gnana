import { Hono } from "hono";
import { eq, and, desc, sql, providers, type Database } from "@gnana/db";
import { requireRole } from "../middleware/rbac.js";
import { cacheControl } from "../middleware/cache.js";
import { encrypt } from "../utils/encryption.js";
import { createProviderSchema } from "../validation/schemas.js";

export function providerRoutes(db: Database) {
  const app = new Hono();

  // List providers — viewer+
  app.get("/", requireRole("viewer"), cacheControl("private, max-age=60"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
    const offset = Number(c.req.query("offset")) || 0;

    const whereClause = eq(providers.workspaceId, workspaceId);

    const result = await db
      .select()
      .from(providers)
      .where(whereClause)
      .orderBy(desc(providers.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(providers)
      .where(whereClause);
    const total = countResult[0]?.count ?? 0;

    // Strip API keys from response
    return c.json({ data: result.map((p) => ({ ...p, apiKey: "***" })), total, limit, offset });
  });

  // Register provider — admin+
  app.post("/", requireRole("admin"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const body = await c.req.json();
    const parsed = createProviderSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Validation failed", details: parsed.error.flatten().fieldErrors } }, 400);
    }
    const data = parsed.data;
    const result = await db
      .insert(providers)
      .values({
        name: data.name,
        type: data.type,
        apiKey: encrypt(data.apiKey),
        baseUrl: data.baseUrl,
        config: data.config ?? {},
        workspaceId,
      })
      .returning();
    return c.json({ ...result[0], apiKey: "***" }, 201);
  });

  // Delete provider — admin+
  app.delete("/:id", requireRole("admin"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    await db
      .update(providers)
      .set({ enabled: false })
      .where(and(eq(providers.id, id), eq(providers.workspaceId, workspaceId)));
    return c.json({ ok: true });
  });

  return app;
}
