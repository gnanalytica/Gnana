import { createGitHubConnector } from "@gnana/connector-github";
import { createHttpConnector } from "@gnana/connector-http";
import { createSlackConnector } from "@gnana/connector-slack";
import { ToolExecutorImpl } from "@gnana/core";
import type { ToolDefinition, MCPServerConfig } from "@gnana/core";
import type { MCPManager } from "@gnana/mcp";
import { connectors, and, inArray, eq, type Database } from "@gnana/db";
import { decryptJson } from "../utils/encryption.js";

export interface ToolsConfig {
  connectors: Array<{ connectorId: string; tools?: string[] }>;
  /** MCP server connector IDs from agent config. */
  mcpServers?: string[];
}

/**
 * Resolves a ToolExecutor populated with tools from the requested connectors
 * and MCP servers.
 * Loads connector records from DB, decrypts credentials, calls the appropriate
 * factory, and optionally filters to specific tool names.
 * For MCP connectors, connects on-demand via MCPManager.
 */
export async function resolveTools(
  config: ToolsConfig,
  workspaceId: string,
  db: Database,
  mcpManager?: MCPManager,
): Promise<ToolExecutorImpl> {
  const executor = new ToolExecutorImpl();

  // ---- Standard connector tools ----
  if (config.connectors && config.connectors.length > 0) {
    // Build a map of connectorId -> requested tool names for quick lookup
    const toolFilterMap = new Map<string, string[] | undefined>();
    for (const entry of config.connectors) {
      toolFilterMap.set(entry.connectorId, entry.tools);
    }

    const connectorIds = config.connectors.map((c) => c.connectorId);

    // Load connector rows from DB, filtered by IDs + workspaceId + enabled
    const rows = await db
      .select()
      .from(connectors)
      .where(
        and(
          inArray(connectors.id, connectorIds),
          eq(connectors.workspaceId, workspaceId),
          eq(connectors.enabled, true),
        ),
      );

    for (const row of rows) {
      const decryptedCredentials = decryptJson(row.credentials);
      const decryptedConfig = decryptJson(row.config);

      let connectorTools: ToolDefinition[] = [];

      switch (row.type) {
        case "github": {
          const creds = decryptedCredentials as Record<string, unknown>;
          connectorTools = createGitHubConnector({
            token: (creds["token"] as string) ?? "",
            owner: (creds["owner"] as string | undefined) ?? undefined,
          }) as unknown as ToolDefinition[];
          break;
        }

        case "slack": {
          const creds = decryptedCredentials as Record<string, unknown>;
          connectorTools = createSlackConnector({
            token: (creds["token"] as string) ?? "",
          }) as unknown as ToolDefinition[];
          break;
        }

        case "http": {
          const cfg = decryptedConfig as Record<string, unknown>;
          const creds = decryptedCredentials as Record<string, unknown> | null;
          connectorTools = createHttpConnector({
            baseUrl: (cfg["baseUrl"] as string) ?? "",
            auth: (creds?.["auth"] ?? cfg["auth"]) as
              | {
                  type: "bearer" | "basic" | "api-key";
                  token?: string;
                  username?: string;
                  password?: string;
                  headerName?: string;
                  apiKey?: string;
                }
              | undefined,
            defaultHeaders: cfg["defaultHeaders"] as Record<string, string> | undefined,
            endpoints:
              (cfg["endpoints"] as import("@gnana/connector-http").HttpEndpointConfig[]) ?? [],
          }) as unknown as ToolDefinition[];
          break;
        }

        default:
          // Unknown connector type — skip silently
          break;
      }

      // Apply optional tool name filter
      const requestedTools = toolFilterMap.get(row.id);
      if (requestedTools && requestedTools.length > 0) {
        const allowedSet = new Set(requestedTools);
        connectorTools = connectorTools.filter((t) => allowedSet.has(t.name));
      }

      executor.registerTools(connectorTools);
    }
  }

  // ---- MCP server tools ----
  if (mcpManager && config.mcpServers && config.mcpServers.length > 0) {
    for (const serverId of config.mcpServers) {
      const status = mcpManager.getServerStatus(serverId);

      if (!status || !status.connected) {
        // Server not connected — try to start it
        const mcpConfig = await loadMCPServerConfig(db, serverId, workspaceId);
        if (mcpConfig) {
          try {
            await mcpManager.startServer(serverId, mcpConfig);
          } catch (err) {
            // Log warning but don't fail the whole run — graceful degradation
            console.warn(`Failed to connect MCP server ${serverId}:`, err);
            continue;
          }
        } else {
          continue; // Connector not found or disabled
        }
      }

      // Get tools from the connected server and register them
      const mcpTools = mcpManager.getServerTools(serverId);
      executor.registerTools(mcpTools);
    }
  }

  return executor;
}

/** Load MCPServerConfig from the connectors table. */
export async function loadMCPServerConfig(
  db: Database,
  connectorId: string,
  workspaceId: string,
): Promise<MCPServerConfig | null> {
  const result = await db
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.id, connectorId),
        eq(connectors.workspaceId, workspaceId),
        eq(connectors.type, "mcp"),
        eq(connectors.enabled, true),
      ),
    )
    .limit(1);

  const connector = result[0];
  if (!connector) return null;

  const config = connector.config as Record<string, unknown>;
  return {
    name: (config.serverName as string) || connector.name,
    transport: config.transport as "stdio" | "http",
    command: config.command as string | undefined,
    args: config.args as string[] | undefined,
    url: config.url as string | undefined,
    env: config.env as Record<string, string> | undefined,
  };
}
