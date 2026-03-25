import { Hono } from "hono";
import { eq, and, desc, sql, connectors, connectorTools, type Database } from "@gnana/db";
import { MCPClient, type MCPManager } from "@gnana/mcp";
import type { MCPServerConfig } from "@gnana/core";
import { requireRole } from "../middleware/rbac.js";
import { planLimit } from "../middleware/plan-limits.js";
import { cacheControl } from "../middleware/cache.js";
import { encryptJson, decryptJson } from "../utils/encryption.js";
import { createConnectorSchema } from "../validation/schemas.js";
import { errorResponse } from "../utils/errors.js";

export function connectorRoutes(db: Database, mcpManager: MCPManager) {
  const app = new Hono();

  // List connectors — viewer+
  app.get("/", requireRole("viewer"), cacheControl("private, max-age=60"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
    const offset = Number(c.req.query("offset")) || 0;

    const whereClause = eq(connectors.workspaceId, workspaceId);

    const result = await db
      .select()
      .from(connectors)
      .where(whereClause)
      .orderBy(desc(connectors.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(connectors)
      .where(whereClause);
    const total = countResult[0]?.count ?? 0;

    return c.json({
      data: result.map((conn) => ({ ...conn, credentials: "***" })),
      total,
      limit,
      offset,
    });
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
      return errorResponse(c, 404, "NOT_FOUND", "Connector not found");
    }
    return c.json({ ...result[0], credentials: "***" });
  });

  // Register connector — admin+ with plan limit check
  app.post("/", requireRole("admin"), planLimit(db, "maxConnectors", connectors), async (c) => {
    const workspaceId = c.get("workspaceId");
    const body = await c.req.json();
    const parsed = createConnectorSchema.safeParse(body);
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
      .insert(connectors)
      .values({
        type: data.type,
        name: data.name,
        authType: data.authType,
        credentials: encryptJson(data.credentials),
        config: data.config ?? {},
        workspaceId,
      })
      .returning();
    return c.json({ ...result[0], credentials: "***" }, 201);
  });

  // Get connector tools — viewer+
  app.get("/:id/tools", requireRole("viewer"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");

    // Verify the connector belongs to the current workspace before returning tools
    const connector = await db
      .select({ id: connectors.id })
      .from(connectors)
      .where(and(eq(connectors.id, id), eq(connectors.workspaceId, workspaceId)));
    if (connector.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Connector not found");
    }

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
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");

    const result = await db
      .select()
      .from(connectors)
      .where(and(eq(connectors.id, id), eq(connectors.workspaceId, workspaceId)))
      .limit(1);

    const connector = result[0];
    if (!connector) return errorResponse(c, 404, "NOT_FOUND", "Connector not found");

    try {
      const creds = decryptJson(connector.credentials) as Record<string, string> | null;
      const config = connector.config as Record<string, string>;

      switch (connector.type) {
        case "github": {
          const token = creds?.token;
          if (!token) return c.json({ success: false, message: "No token configured" });
          const res = await fetch("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${token}`, "User-Agent": "Gnana" },
          });
          if (res.ok) {
            const user = (await res.json()) as { login: string };
            return c.json({ success: true, message: `Connected as ${user.login}` });
          }
          return c.json({ success: false, message: `GitHub API error: ${res.status}` });
        }
        case "slack": {
          const token = creds?.token;
          if (!token) return c.json({ success: false, message: "No token configured" });
          const res = await fetch("https://slack.com/api/auth.test", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = (await res.json()) as { ok: boolean; team?: string; error?: string };
          if (data.ok) {
            return c.json({ success: true, message: `Connected to ${data.team}` });
          }
          return c.json({ success: false, message: `Slack error: ${data.error}` });
        }
        case "http": {
          const baseUrl = config?.baseUrl;
          if (!baseUrl) return c.json({ success: false, message: "No base URL configured" });
          const res = await fetch(baseUrl, { method: "HEAD" });
          return c.json({ success: true, message: `Reachable (HTTP ${res.status})` });
        }
        case "mcp": {
          const connConfig = connector.config as {
            transport: string;
            serverName?: string;
            url?: string;
            command?: string;
            args?: string[];
            env?: Record<string, string>;
          };
          const mcpConfig: MCPServerConfig = {
            name: connConfig.serverName || connector.name,
            transport: connConfig.transport as "stdio" | "http",
            command: connConfig.command,
            args: connConfig.args,
            url: connConfig.url,
            env: connConfig.env,
          };

          const testClient = new MCPClient(mcpConfig);
          try {
            await testClient.connect();
            const tools = testClient.getTools();
            await testClient.disconnect();
            return c.json({
              success: true,
              message: `Connected. Discovered ${tools.length} tool(s).`,
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
              })),
            });
          } catch (err) {
            return c.json({
              success: false,
              message: `MCP connection failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
        default:
          return c.json({ success: true, message: "Connector type not testable yet" });
      }
    } catch (err) {
      return c.json({
        success: false,
        message: `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  });

  // Refresh MCP tools — connect, discover, persist to connector_tools
  app.post("/:id/refresh-tools", requireRole("admin"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");

    const result = await db
      .select()
      .from(connectors)
      .where(
        and(
          eq(connectors.id, id),
          eq(connectors.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    const connector = result[0];
    if (!connector)
      return errorResponse(c, 404, "NOT_FOUND", "Connector not found");
    if (connector.type !== "mcp") {
      return c.json(
        {
          error: {
            code: "INVALID_TYPE",
            message: "Only MCP connectors support tool refresh",
          },
        },
        400,
      );
    }

    const connConfig = connector.config as {
      transport: string;
      serverName?: string;
      url?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    };
    const mcpConfig: MCPServerConfig = {
      name: connConfig.serverName || connector.name,
      transport: connConfig.transport as "stdio" | "http",
      command: connConfig.command,
      args: connConfig.args,
      url: connConfig.url,
      env: connConfig.env,
    };

    const testClient = new MCPClient(mcpConfig);
    try {
      await testClient.connect();
      const tools = testClient.getTools();
      await testClient.disconnect();

      // Delete existing tool rows for this connector
      await db
        .delete(connectorTools)
        .where(eq(connectorTools.connectorId, id));

      // Insert new tool rows
      if (tools.length > 0) {
        await db.insert(connectorTools).values(
          tools.map((t) => ({
            connectorId: id,
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        );
      }

      return c.json({
        success: true,
        toolCount: tools.length,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
      });
    } catch (err) {
      return c.json(
        {
          success: false,
          message: `MCP refresh failed: ${err instanceof Error ? err.message : String(err)}`,
        },
        500,
      );
    }
  });

  // MCP server status — checks in-memory MCPManager
  app.get("/:id/status", requireRole("viewer"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");

    // Verify connector exists and belongs to workspace
    const result = await db
      .select({ id: connectors.id, type: connectors.type })
      .from(connectors)
      .where(
        and(
          eq(connectors.id, id),
          eq(connectors.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    const connector = result[0];
    if (!connector)
      return errorResponse(c, 404, "NOT_FOUND", "Connector not found");

    if (connector.type !== "mcp") {
      return c.json({
        connected: true,
        toolCount: 0,
        lastConnected: null,
        error: null,
      });
    }

    const status = mcpManager.getServerStatus(id);
    if (!status) {
      return c.json({
        connected: false,
        toolCount: 0,
        lastConnected: null,
        error: null,
      });
    }

    return c.json({
      connected: status.connected,
      toolCount: status.toolCount,
      lastConnected: status.lastConnected?.toISOString() ?? null,
      error: status.error,
    });
  });

  // Health check — test connector connectivity, persist result
  app.post("/:id/health", requireRole("editor"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");

    const rows = await db
      .select()
      .from(connectors)
      .where(and(eq(connectors.id, id), eq(connectors.workspaceId, workspaceId)))
      .limit(1);

    if (rows.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Connector not found");
    }

    const connector = rows[0]!;
    const start = Date.now();
    let status: "healthy" | "unhealthy" = "unhealthy";
    let error: string | undefined;

    try {
      if (connector.type === "mcp") {
        const serverStatus = mcpManager.getServerStatus(id);
        if (serverStatus?.connected) {
          status = "healthy";
        } else {
          error = serverStatus?.error ?? "Not connected";
        }
      } else {
        // For standard connectors, try a lightweight API call
        const creds = decryptJson(connector.credentials) as Record<string, unknown>;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        try {
          if (connector.type === "github") {
            const resp = await fetch("https://api.github.com/user", {
              headers: { Authorization: `Bearer ${creds.token}`, "User-Agent": "Gnana" },
              signal: controller.signal,
            });
            status = resp.ok ? "healthy" : "unhealthy";
            if (!resp.ok) error = `HTTP ${resp.status}`;
          } else if (connector.type === "slack") {
            const resp = await fetch("https://slack.com/api/auth.test", {
              method: "POST",
              headers: { Authorization: `Bearer ${creds.token}` },
              signal: controller.signal,
            });
            const body = (await resp.json()) as { ok: boolean; error?: string };
            status = body.ok ? "healthy" : "unhealthy";
            if (!body.ok) error = body.error ?? "Auth test failed";
          } else if (connector.type === "http") {
            const config = connector.config as Record<string, unknown>;
            const baseUrl = (config.baseUrl as string) ?? "";
            if (baseUrl) {
              const resp = await fetch(baseUrl, { signal: controller.signal });
              status = resp.ok ? "healthy" : "unhealthy";
              if (!resp.ok) error = `HTTP ${resp.status}`;
            } else {
              error = "No base URL configured";
            }
          }
        } finally {
          clearTimeout(timeout);
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Health check failed";
    }

    const latencyMs = Date.now() - start;

    // Persist health status
    await db
      .update(connectors)
      .set({ lastHealthStatus: status, lastHealthCheckAt: new Date() })
      .where(eq(connectors.id, id));

    return c.json({ status, latencyMs, error });
  });

  return app;
}
