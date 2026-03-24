import { Hono } from "hono";
import { eq, and, desc, pipelineVersions, type Database } from "@gnana/db";
import { requireRole } from "../middleware/rbac.js";

export function pipelineVersionRoutes(db: Database) {
  const app = new Hono();

  // List versions for an agent — viewer+
  app.get("/:agentId", requireRole("viewer"), async (c) => {
    const agentId = c.req.param("agentId");
    const workspaceId = c.get("workspaceId");
    const result = await db
      .select()
      .from(pipelineVersions)
      .where(
        and(
          eq(pipelineVersions.agentId, agentId),
          eq(pipelineVersions.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(pipelineVersions.version));
    return c.json(result);
  });

  // Create a new version — editor+
  app.post("/:agentId", requireRole("editor"), async (c) => {
    const agentId = c.req.param("agentId");
    const workspaceId = c.get("workspaceId");
    const body = await c.req.json();

    // Get the latest version number
    const latest = await db
      .select({ version: pipelineVersions.version })
      .from(pipelineVersions)
      .where(
        and(
          eq(pipelineVersions.agentId, agentId),
          eq(pipelineVersions.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(pipelineVersions.version))
      .limit(1);

    const nextVersion = (latest[0]?.version ?? 0) + 1;

    const result = await db
      .insert(pipelineVersions)
      .values({
        agentId,
        workspaceId,
        version: nextVersion,
        nodes: body.nodes,
        edges: body.edges,
        message: body.message ?? `Version ${nextVersion}`,
        createdBy: body.createdBy,
      })
      .returning();

    return c.json(result[0], 201);
  });

  // Get specific version — viewer+
  app.get("/:agentId/:versionId", requireRole("viewer"), async (c) => {
    const versionId = c.req.param("versionId");
    const workspaceId = c.get("workspaceId");
    const result = await db
      .select()
      .from(pipelineVersions)
      .where(
        and(
          eq(pipelineVersions.id, versionId),
          eq(pipelineVersions.workspaceId, workspaceId),
        ),
      );
    if (result.length === 0) {
      return c.json({ error: "Version not found" }, 404);
    }
    return c.json(result[0]);
  });

  return app;
}
