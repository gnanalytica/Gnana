import { Hono } from "hono";
import { eq, and, desc, apiKeys, type Database } from "@gnana/db";
import { requireRole } from "../middleware/rbac.js";
import { randomBytes, createHash } from "node:crypto";

export function apiKeyRoutes(db: Database) {
  const app = new Hono();

  // List API keys — viewer+
  app.get("/", requireRole("viewer"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const result = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.workspaceId, workspaceId))
      .orderBy(desc(apiKeys.createdAt));

    // Mask actual keys — show prefix + last 4 chars
    return c.json(
      result.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        createdBy: k.createdBy,
        lastUsedAt: k.lastUsedAt,
        expiresAt: k.expiresAt,
        createdAt: k.createdAt,
      })),
    );
  });

  // Create API key — admin+
  app.post("/", requireRole("admin"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const body = await c.req.json();

    if (!body.name) {
      return c.json({ error: "Name is required" }, 400);
    }

    // Generate key: gnk_ + 32 random hex chars
    const rawKey = randomBytes(32).toString("hex");
    const fullKey = `gnk_${rawKey}`;
    const prefix = `gnk_${rawKey.slice(0, 8)}`;
    const keyHash = createHash("sha256").update(fullKey).digest("hex");

    const result = await db
      .insert(apiKeys)
      .values({
        workspaceId,
        name: body.name,
        keyHash,
        prefix,
        createdBy: userId,
      })
      .returning();

    const created = result[0]!;

    // Return the full key ONLY on creation
    return c.json(
      {
        id: created.id,
        name: created.name,
        key: fullKey,
        prefix: created.prefix,
        createdAt: created.createdAt,
      },
      201,
    );
  });

  // Delete/revoke API key — admin+
  app.delete("/:id", requireRole("admin"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");

    const result = await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId)))
      .returning();

    if (result.length === 0) {
      return c.json({ error: "API key not found" }, 404);
    }

    return c.json({ ok: true });
  });

  return app;
}
