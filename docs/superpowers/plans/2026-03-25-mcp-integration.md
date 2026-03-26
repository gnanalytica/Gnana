# MCP Server Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement MCP server support so users can connect stdio and HTTP MCP servers as tool sources for their agent pipelines.

**Architecture:** MCPClient handles individual server connections (stdio/HTTP transport). MCPManager manages multiple connections per workspace. MCP tools are converted to standard ToolDefinition objects and registered alongside connector tools during execution. Dashboard adds MCP as a connector type with discovery UI.

**Tech Stack:** @modelcontextprotocol/sdk, @gnana/mcp package, Hono (server), Next.js + shadcn/ui (dashboard)

**Spec:** `docs/superpowers/specs/2026-03-25-mcp-integration-design.md`

---

## Task 1: MCPClient (stdio + HTTP transports, tool discovery)

**Files:**

- Create: `packages/mcp/src/client.ts`
- Modify: `packages/mcp/package.json` (add `@gnana/core` dependency)

**Steps:**

- [ ] Add `@gnana/core` as a workspace dependency in `packages/mcp/package.json`. The MCPClient needs `ToolDefinition` and `MCPServerConfig` from `@gnana/core`. Update `dependencies`:

  ```json
  {
    "dependencies": {
      "@modelcontextprotocol/sdk": "^1.12.0",
      "@gnana/core": "workspace:*",
      "@gnana/provider-base": "workspace:*"
    }
  }
  ```

- [ ] Create `packages/mcp/src/client.ts` with the complete MCPClient class. This replaces the monolithic `MCPClientAdapter` in `index.ts` with a focused per-connection class:

  ```typescript
  import { Client } from "@modelcontextprotocol/sdk/client/index.js";
  import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
  import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
  import type { ToolDefinition, MCPServerConfig } from "@gnana/core";

  export interface MCPClientStatus {
    connected: boolean;
    toolCount: number;
    lastConnected: Date | null;
    error: string | null;
  }

  export class MCPClient {
    private client: Client;
    private transport: StdioClientTransport | StreamableHTTPClientTransport | null = null;
    private tools: ToolDefinition[] = [];
    private config: MCPServerConfig;
    private _status: MCPClientStatus = {
      connected: false,
      toolCount: 0,
      lastConnected: null,
      error: null,
    };
    private retryCount = 0;
    private static MAX_RETRIES = 3;
    private static RETRY_BASE_MS = 1000;

    constructor(config: MCPServerConfig) {
      this.config = config;
      this.client = new Client({ name: "gnana", version: "0.0.1" });
    }

    /** Connect to the MCP server and discover tools. */
    async connect(): Promise<void> {
      try {
        this.transport = this.createTransport();
        await this.client.connect(this.transport);
        await this.discoverTools();
        this._status = {
          connected: true,
          toolCount: this.tools.length,
          lastConnected: new Date(),
          error: null,
        };
        this.retryCount = 0;
      } catch (err) {
        this._status.connected = false;
        this._status.error = err instanceof Error ? err.message : String(err);
        throw err;
      }
    }

    /** Disconnect and clean up transport. */
    async disconnect(): Promise<void> {
      try {
        await this.client.close();
      } catch {
        // Swallow — transport may already be closed
      }
      this.transport = null;
      this.tools = [];
      this._status.connected = false;
      this._status.toolCount = 0;
    }

    /** Reconnect with exponential backoff. 3 retries max. */
    async reconnect(): Promise<void> {
      await this.disconnect();
      // Re-create the internal SDK client — the old one is closed
      this.client = new Client({ name: "gnana", version: "0.0.1" });

      for (let attempt = 1; attempt <= MCPClient.MAX_RETRIES; attempt++) {
        this.retryCount = attempt;
        const delay = MCPClient.RETRY_BASE_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
        try {
          await this.connect();
          return;
        } catch {
          // Re-create client for next attempt since connect() failure
          // leaves the SDK client in an unusable state
          this.client = new Client({ name: "gnana", version: "0.0.1" });
          if (attempt === MCPClient.MAX_RETRIES) {
            throw new Error(
              `Failed to reconnect to MCP server "${this.config.name}" after ${MCPClient.MAX_RETRIES} attempts`,
            );
          }
        }
      }
    }

    isConnected(): boolean {
      return this._status.connected;
    }

    getStatus(): MCPClientStatus {
      return { ...this._status };
    }

    getConfig(): MCPServerConfig {
      return this.config;
    }

    /** Get all discovered tools as Gnana ToolDefinitions. */
    getTools(): ToolDefinition[] {
      return this.tools;
    }

    /**
     * Call a tool on this MCP server.
     * Accepts the raw tool name (without namespace prefix).
     */
    async callTool(toolName: string, input: unknown): Promise<string> {
      if (!this._status.connected) {
        throw new Error(`MCP server "${this.config.name}" is not connected`);
      }
      const result = await this.client.callTool({
        name: toolName,
        arguments: input as Record<string, unknown>,
      });
      // MCP results contain a content array — extract text parts
      const parts = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!);
      return parts.join("\n") || JSON.stringify(result.content);
    }

    // ---- Private ----

    private createTransport(): StdioClientTransport | StreamableHTTPClientTransport {
      if (this.config.transport === "stdio") {
        if (!this.config.command) {
          throw new Error(`MCP server "${this.config.name}": stdio transport requires a command`);
        }
        return new StdioClientTransport({
          command: this.config.command,
          args: this.config.args,
          env: this.config.env,
        });
      }
      if (this.config.transport === "http") {
        if (!this.config.url) {
          throw new Error(`MCP server "${this.config.name}": HTTP transport requires a url`);
        }
        return new StreamableHTTPClientTransport(new URL(this.config.url));
      }
      throw new Error(`Unsupported MCP transport: ${this.config.transport}`);
    }

    /** Call tools/list and convert MCP tool schemas to ToolDefinition[]. */
    private async discoverTools(): Promise<void> {
      const result = await this.client.listTools();
      const serverName = this.config.name;

      this.tools = result.tools.map((mcpTool) => {
        const qualifiedName = `mcp_${serverName}_${mcpTool.name}`;
        // Capture the raw tool name for the closure — the handler
        // calls the MCP server with the unqualified name
        const rawName = mcpTool.name;

        const toolDef: ToolDefinition = {
          name: qualifiedName,
          description: mcpTool.description ?? "",
          inputSchema: mcpTool.inputSchema as Record<string, unknown>,
          handler: async (input) => {
            return this.callTool(rawName, input);
          },
        };
        return toolDef;
      });
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  ```

- [ ] Run: `pnpm install && pnpm --filter @gnana/mcp typecheck && pnpm --filter @gnana/mcp build`

---

## Task 2: MCPManager (multi-server lifecycle)

**Files:**

- Create: `packages/mcp/src/manager.ts`
- Create: `packages/mcp/src/types.ts`

**Steps:**

- [ ] Create `packages/mcp/src/types.ts` with MCP-specific record types:

  ```typescript
  import type { MCPServerConfig } from "@gnana/core";

  /** Extended config for internal MCP package use. */
  export interface MCPServerRecord {
    /** Connector ID from database. */
    id: string;
    /** Workspace that owns this connector. */
    workspaceId: string;
    /** Core MCP config (name, transport, command/url, env). */
    config: MCPServerConfig;
    /** Whether the connector is enabled. */
    enabled: boolean;
  }
  ```

- [ ] Create `packages/mcp/src/manager.ts` with the MCPManager class:

  ```typescript
  import { MCPClient, type MCPClientStatus } from "./client.js";
  import type { MCPServerConfig, ToolDefinition } from "@gnana/core";

  export interface MCPServerInfo {
    /** Connector ID from database. */
    serverId: string;
    config: MCPServerConfig;
    status: MCPClientStatus;
  }

  export class MCPManager {
    private clients = new Map<string, MCPClient>();
    private configs = new Map<string, MCPServerConfig>();

    /** Start a connection to an MCP server. */
    async startServer(serverId: string, config: MCPServerConfig): Promise<void> {
      // Stop existing connection if any
      if (this.clients.has(serverId)) {
        await this.stopServer(serverId);
      }

      const client = new MCPClient(config);
      await client.connect();
      this.clients.set(serverId, client);
      this.configs.set(serverId, config);
    }

    /** Stop and clean up a server connection. */
    async stopServer(serverId: string): Promise<void> {
      const client = this.clients.get(serverId);
      if (client) {
        await client.disconnect();
        this.clients.delete(serverId);
        this.configs.delete(serverId);
      }
    }

    /** Stop + start. */
    async restartServer(serverId: string): Promise<void> {
      const config = this.configs.get(serverId);
      if (!config) {
        throw new Error(`No config found for MCP server ${serverId}`);
      }
      await this.stopServer(serverId);
      await this.startServer(serverId, config);
    }

    /** Get aggregated tools from all connected servers. */
    getTools(): ToolDefinition[] {
      const tools: ToolDefinition[] = [];
      for (const client of this.clients.values()) {
        if (client.isConnected()) {
          tools.push(...client.getTools());
        }
      }
      return tools;
    }

    /** Get tools from a specific server. */
    getServerTools(serverId: string): ToolDefinition[] {
      const client = this.clients.get(serverId);
      if (!client || !client.isConnected()) return [];
      return client.getTools();
    }

    /** Get status of all managed servers. */
    getServerStatuses(): MCPServerInfo[] {
      const result: MCPServerInfo[] = [];
      for (const [serverId, client] of this.clients) {
        const config = this.configs.get(serverId);
        if (config) {
          result.push({
            serverId,
            config,
            status: client.getStatus(),
          });
        }
      }
      return result;
    }

    /** Get status of a single server. */
    getServerStatus(serverId: string): MCPClientStatus | null {
      return this.clients.get(serverId)?.getStatus() ?? null;
    }

    /** Check if a server is registered (connected or not). */
    hasServer(serverId: string): boolean {
      return this.clients.has(serverId);
    }

    /** Disconnect all servers. Call on process shutdown. */
    async shutdown(): Promise<void> {
      const ids = [...this.clients.keys()];
      await Promise.allSettled(ids.map((id) => this.stopServer(id)));
    }
  }
  ```

- [ ] Run: `pnpm --filter @gnana/mcp typecheck && pnpm --filter @gnana/mcp build`

---

## Task 3: Package exports, types, and core update

**Files:**

- Modify: `packages/mcp/src/index.ts` (replace old barrel with new exports)
- Modify: `packages/core/src/types.ts` (add `args` to `MCPServerConfig`)

**Steps:**

- [ ] Update `packages/core/src/types.ts` to add `args?: string[]` to `MCPServerConfig`. The existing interface is:

  ```typescript
  export interface MCPServerConfig {
    name: string;
    transport: "stdio" | "http";
    command?: string;
    url?: string;
    env?: Record<string, string>;
  }
  ```

  Change it to:

  ```typescript
  export interface MCPServerConfig {
    name: string;
    transport: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
  }
  ```

- [ ] Replace the entire contents of `packages/mcp/src/index.ts` with the new barrel exports. Remove the old `MCPClientAdapter` class. New contents:

  ```typescript
  export { MCPClient } from "./client.js";
  export type { MCPClientStatus } from "./client.js";
  export { MCPManager } from "./manager.js";
  export type { MCPServerInfo } from "./manager.js";
  export type { MCPServerRecord } from "./types.js";
  ```

- [ ] Run: `pnpm --filter @gnana/core typecheck && pnpm --filter @gnana/core build`
- [ ] Run: `pnpm --filter @gnana/mcp typecheck && pnpm --filter @gnana/mcp build`
- [ ] Run: `pnpm build` (full monorepo build to catch any downstream breakage from the MCPClientAdapter removal)

---

## Task 4: Server integration (resolve-tools, connector routes, MCPManager lifecycle)

**Files:**

- Create: `packages/server/src/execution/resolve-tools.ts`
- Modify: `packages/server/src/index.ts` (instantiate MCPManager, pass to routes, shutdown)
- Modify: `packages/server/src/routes/connectors.ts` (MCP test case, refresh-tools, status endpoint)
- Modify: `packages/server/package.json` (add `@gnana/mcp` dependency)
- Modify: `packages/client/src/index.ts` (add `refreshTools` and `status` methods to ConnectorsAPI)

**Steps:**

- [ ] Add `@gnana/mcp` as a workspace dependency in `packages/server/package.json`:

  ```json
  {
    "dependencies": {
      "@gnana/mcp": "workspace:*"
    }
  }
  ```

  (Add this entry alongside the existing dependencies.)

- [ ] Create `packages/server/src/execution/resolve-tools.ts`. This module resolves all tools for an agent run, connecting MCP servers on-demand:

  ```typescript
  import { ToolExecutorImpl } from "@gnana/core";
  import type { MCPServerConfig } from "@gnana/core";
  import type { MCPManager } from "@gnana/mcp";
  import { eq, and, connectors, type Database } from "@gnana/db";

  export interface ResolveToolsOptions {
    db: Database;
    mcpManager: MCPManager;
    agentId: string;
    workspaceId: string;
    /** MCP server connector IDs from agent config. */
    mcpServerIds: string[];
  }

  export async function resolveTools(opts: ResolveToolsOptions): Promise<ToolExecutorImpl> {
    const executor = new ToolExecutorImpl();

    // Load MCP tools — connect on-demand if needed
    for (const serverId of opts.mcpServerIds) {
      const status = opts.mcpManager.getServerStatus(serverId);

      if (!status || !status.connected) {
        // Server not connected — try to start it
        const config = await loadMCPServerConfig(opts.db, serverId, opts.workspaceId);
        if (config) {
          try {
            await opts.mcpManager.startServer(serverId, config);
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
      const mcpTools = opts.mcpManager.getServerTools(serverId);
      executor.registerTools(mcpTools);
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
  ```

- [ ] Modify `packages/server/src/routes/connectors.ts` to add MCP-specific endpoints. Add the `MCPClient` import and the `MCPManager` parameter to the route factory. The modified file should:
  1. Change the function signature to accept `mcpManager`:

     ```typescript
     import { MCPClient, type MCPManager } from "@gnana/mcp";
     import type { MCPServerConfig } from "@gnana/core";
     import { loadMCPServerConfig } from "../execution/resolve-tools.js";

     export function connectorRoutes(db: Database, mcpManager: MCPManager) {
     ```

  2. Add the `mcp` case to the existing `POST /:id/test` switch statement, right before the `default:` case:

     ```typescript
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
     ```

  3. Add `POST /:id/refresh-tools` endpoint after the test endpoint. This connects to the MCP server, discovers tools, and persists them as `connector_tools` rows:

     ```typescript
     // Refresh MCP tools — connect, discover, persist to connector_tools
     app.post("/:id/refresh-tools", requireRole("admin"), async (c) => {
       const id = c.req.param("id");
       const workspaceId = c.get("workspaceId");

       const result = await db
         .select()
         .from(connectors)
         .where(and(eq(connectors.id, id), eq(connectors.workspaceId, workspaceId)))
         .limit(1);

       const connector = result[0];
       if (!connector) return errorResponse(c, 404, "NOT_FOUND", "Connector not found");
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
         await db.delete(connectorTools).where(eq(connectorTools.connectorId, id));

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
     ```

  4. Add `GET /:id/status` endpoint for checking live MCP server status:

     ```typescript
     // MCP server status — checks in-memory MCPManager
     app.get("/:id/status", requireRole("viewer"), async (c) => {
       const id = c.req.param("id");
       const workspaceId = c.get("workspaceId");

       // Verify connector exists and belongs to workspace
       const result = await db
         .select({ id: connectors.id, type: connectors.type })
         .from(connectors)
         .where(and(eq(connectors.id, id), eq(connectors.workspaceId, workspaceId)))
         .limit(1);

       const connector = result[0];
       if (!connector) return errorResponse(c, 404, "NOT_FOUND", "Connector not found");

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
     ```

- [ ] Modify `packages/server/src/index.ts` to instantiate MCPManager, pass it to connector routes, and wire up shutdown. Make these changes:
  1. Add the import at the top of the file:

     ```typescript
     import { MCPManager } from "@gnana/mcp";
     ```

  2. In `createGnanaServer()`, create the MCPManager instance and pass it to `createApp`:

     ```typescript
     const mcpManager = new MCPManager();
     const app = createApp(db, events, queue, mcpManager);
     ```

  3. Update `createApp` signature to accept `mcpManager`:

     ```typescript
     function createApp(
       db: Database,
       events: EventBus,
       queue: JobQueue,
       mcpManager: MCPManager,
     ) {
     ```

  4. Pass `mcpManager` to `connectorRoutes`:

     ```typescript
     api.route("/connectors", connectorRoutes(db, mcpManager));
     ```

  5. In the `start()` method, add graceful shutdown for the MCPManager:

     ```typescript
     start() {
       const port = config.port ?? 4000;
       queue.start();
       const httpServer = serve({ fetch: app.fetch, port }, (info) => {
         serverLog.info(
           { port: info.port },
           `Gnana server running on http://localhost:${info.port}`,
         );
       });

       // Graceful MCP shutdown
       const shutdownHandler = async () => {
         await mcpManager.shutdown();
       };
       process.on("SIGTERM", shutdownHandler);
       process.on("SIGINT", shutdownHandler);

       return httpServer;
     },
     ```

  6. Expose `mcpManager` in the return value alongside `app`, `db`, `events`, `queue`:

     ```typescript
     return {
       app,
       db,
       events,
       queue,
       mcpManager,
       start() { ... },
     };
     ```

- [ ] Modify `packages/client/src/index.ts` to add `refreshTools` and `status` methods to the `ConnectorsAPI` class. Add these after the existing `test` method:

  ```typescript
  async refreshTools(
    id: string,
  ): Promise<{
    success: boolean;
    toolCount?: number;
    tools?: { name: string; description: string }[];
    message?: string;
  }> {
    const res = await this.client.fetch(
      `/api/connectors/${id}/refresh-tools`,
      { method: "POST" },
    );
    return res.json() as Promise<{
      success: boolean;
      toolCount?: number;
      tools?: { name: string; description: string }[];
      message?: string;
    }>;
  }

  async status(
    id: string,
  ): Promise<{
    connected: boolean;
    toolCount: number;
    lastConnected: string | null;
    error: string | null;
  }> {
    const res = await this.client.fetch(
      `/api/connectors/${id}/status`,
    );
    return res.json() as Promise<{
      connected: boolean;
      toolCount: number;
      lastConnected: string | null;
      error: string | null;
    }>;
  }
  ```

- [ ] Run: `pnpm install && pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/client typecheck`
- [ ] Run: `pnpm build` (full monorepo build)

---

## Task 5: Dashboard MCP connector form and status UI

**Files:**

- Create: `apps/dashboard/src/components/connectors/mcp-config-form.tsx`
- Modify: `apps/dashboard/src/components/connectors/install-dialog.tsx` (add server name, args, env fields)
- Modify: `apps/dashboard/src/components/connectors/connector-card.tsx` (add MCP status, tool count, refresh)
- Modify: `apps/dashboard/src/lib/hooks/use-connectors.ts` (add `refreshTools` and `getStatus` methods)

**Steps:**

- [ ] Create `apps/dashboard/src/components/connectors/mcp-config-form.tsx`. This is a reusable MCP server configuration form used in both the install dialog and connector detail page:

  ```tsx
  "use client";

  import { useState } from "react";
  import { Loader2, CheckCircle2, XCircle } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { Textarea } from "@/components/ui/textarea";
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";

  export interface MCPConfigFormData {
    serverName: string;
    transport: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
  }

  export interface MCPTestResult {
    success: boolean;
    message: string;
    tools?: { name: string; description: string }[];
  }

  interface MCPConfigFormProps {
    initialConfig?: {
      serverName: string;
      transport: "stdio" | "http";
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
    };
    onSave?: (config: MCPConfigFormData) => Promise<void>;
    onTest?: () => Promise<MCPTestResult>;
    /** When true, renders inline without save/test buttons (for use inside install dialog). */
    inline?: boolean;
    /** Expose form values to parent via render props pattern. */
    onChange?: (config: MCPConfigFormData) => void;
  }

  export function MCPConfigForm({
    initialConfig,
    onSave,
    onTest,
    inline = false,
    onChange,
  }: MCPConfigFormProps) {
    const [serverName, setServerName] = useState(initialConfig?.serverName ?? "");
    const [transport, setTransport] = useState<"stdio" | "http">(
      initialConfig?.transport ?? "http",
    );
    const [url, setUrl] = useState(initialConfig?.url ?? "");
    const [command, setCommand] = useState(initialConfig?.command ?? "");
    const [argsText, setArgsText] = useState(initialConfig?.args?.join("\n") ?? "");
    const [envText, setEnvText] = useState(
      initialConfig?.env
        ? Object.entries(initialConfig.env)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")
        : "",
    );
    const [isTesting, setIsTesting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [testResult, setTestResult] = useState<MCPTestResult | null>(null);

    const buildConfig = (): MCPConfigFormData => {
      const args =
        transport === "stdio" && argsText.trim()
          ? argsText
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
      const env = envText.trim()
        ? Object.fromEntries(
            envText
              .split("\n")
              .map((line) => {
                const idx = line.indexOf("=");
                return idx > 0 ? [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] : null;
              })
              .filter(Boolean) as [string, string][],
          )
        : undefined;

      return {
        serverName,
        transport,
        ...(transport === "http" ? { url } : { command, args }),
        ...(env && Object.keys(env).length > 0 ? { env } : {}),
      };
    };

    const handleFieldChange = () => {
      if (onChange) {
        // Use setTimeout to get the latest state after React batching
        setTimeout(() => onChange(buildConfig()), 0);
      }
    };

    const handleTest = async () => {
      if (!onTest) return;
      setIsTesting(true);
      setTestResult(null);
      try {
        const result = await onTest();
        setTestResult(result);
      } catch (err) {
        setTestResult({
          success: false,
          message: err instanceof Error ? err.message : "Test failed",
        });
      } finally {
        setIsTesting(false);
      }
    };

    const handleSave = async () => {
      if (!onSave) return;
      setIsSaving(true);
      try {
        await onSave(buildConfig());
      } finally {
        setIsSaving(false);
      }
    };

    const isValid =
      serverName.trim().length > 0 &&
      (transport === "http" ? url.trim().length > 0 : command.trim().length > 0);

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="mcp-name">Server Name</Label>
          <Input
            id="mcp-name"
            placeholder="filesystem"
            value={serverName}
            onChange={(e) => {
              setServerName(e.target.value);
              handleFieldChange();
            }}
          />
          <p className="text-xs text-muted-foreground">
            Used for tool namespacing: mcp_{"<name>"}_toolName
          </p>
        </div>

        <div className="space-y-2">
          <Label>Transport</Label>
          <Select
            value={transport}
            onValueChange={(v) => {
              setTransport(v as "stdio" | "http");
              handleFieldChange();
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="http">HTTP (Streamable HTTP)</SelectItem>
              <SelectItem value="stdio">Stdio (local process)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {transport === "http" && (
          <div className="space-y-2">
            <Label htmlFor="mcp-url">Server URL</Label>
            <Input
              id="mcp-url"
              placeholder="http://localhost:3001/mcp"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                handleFieldChange();
              }}
            />
          </div>
        )}

        {transport === "stdio" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="mcp-command">Command</Label>
              <Input
                id="mcp-command"
                placeholder="npx @modelcontextprotocol/server-filesystem"
                value={command}
                onChange={(e) => {
                  setCommand(e.target.value);
                  handleFieldChange();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mcp-args">Arguments (one per line)</Label>
              <Textarea
                id="mcp-args"
                placeholder="/path/to/allowed/directory"
                value={argsText}
                onChange={(e) => {
                  setArgsText(e.target.value);
                  handleFieldChange();
                }}
                rows={3}
              />
            </div>
          </>
        )}

        <div className="space-y-2">
          <Label htmlFor="mcp-env">Environment Variables (KEY=VALUE, one per line)</Label>
          <Textarea
            id="mcp-env"
            placeholder={"API_KEY=sk-123\nDEBUG=true"}
            value={envText}
            onChange={(e) => {
              setEnvText(e.target.value);
              handleFieldChange();
            }}
            rows={3}
          />
        </div>

        {testResult && (
          <div
            className={`rounded-md p-3 text-sm ${
              testResult.success
                ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              {testResult.success ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <span className="font-medium">{testResult.message}</span>
            </div>
            {testResult.tools && testResult.tools.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs font-medium">Discovered tools:</p>
                <ul className="text-xs space-y-0.5 ml-4 list-disc">
                  {testResult.tools.map((tool) => (
                    <li key={tool.name}>
                      <span className="font-mono">{tool.name}</span> — {tool.description}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!inline && (
          <div className="flex gap-2">
            {onTest && (
              <Button variant="outline" onClick={handleTest} disabled={!isValid || isTesting}>
                {isTesting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  "Test Connection"
                )}
              </Button>
            )}
            {onSave && (
              <Button onClick={handleSave} disabled={!isValid || isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] Modify `apps/dashboard/src/components/connectors/install-dialog.tsx` to enhance the MCP section with server name, args, and env fields. Make the following changes:
  1. Add new state variables for MCP fields after the existing `mcpUrl` state:

     ```typescript
     // MCP fields
     const [mcpTransport, setMcpTransport] = useState("http");
     const [mcpUrl, setMcpUrl] = useState("");
     const [mcpName, setMcpName] = useState("");
     const [mcpCommand, setMcpCommand] = useState("");
     const [mcpArgs, setMcpArgs] = useState("");
     const [mcpEnv, setMcpEnv] = useState("");
     ```

  2. Add the new state resets to `resetForm()`:

     ```typescript
     setMcpName("");
     setMcpCommand("");
     setMcpArgs("");
     setMcpEnv("");
     ```

  3. Add the `Textarea` import at the top:

     ```typescript
     import { Textarea } from "@/components/ui/textarea";
     ```

  4. Replace the MCP Server Fields section (`{app.id === "mcp-server" && (...)}`) with the enhanced version:

     ```tsx
     {
       /* MCP Server Fields */
     }
     {
       app.id === "mcp-server" && (
         <>
           <div className="space-y-2">
             <Label htmlFor="mcp-name">Server Name</Label>
             <Input
               id="mcp-name"
               placeholder="filesystem"
               value={mcpName}
               onChange={(e) => setMcpName(e.target.value)}
             />
             <p className="text-xs text-muted-foreground">
               Used for tool namespacing: mcp_name_toolName
             </p>
           </div>
           <div className="space-y-2">
             <Label>Transport</Label>
             <Select value={mcpTransport} onValueChange={setMcpTransport}>
               <SelectTrigger>
                 <SelectValue />
               </SelectTrigger>
               <SelectContent>
                 <SelectItem value="http">HTTP (Streamable HTTP)</SelectItem>
                 <SelectItem value="stdio">Stdio (local process)</SelectItem>
               </SelectContent>
             </Select>
           </div>
           {mcpTransport === "http" && (
             <div className="space-y-2">
               <Label htmlFor="mcp-url">Server URL</Label>
               <Input
                 id="mcp-url"
                 placeholder="http://localhost:3001/mcp"
                 value={mcpUrl}
                 onChange={(e) => setMcpUrl(e.target.value)}
               />
             </div>
           )}
           {mcpTransport === "stdio" && (
             <>
               <div className="space-y-2">
                 <Label htmlFor="mcp-command">Command</Label>
                 <Input
                   id="mcp-command"
                   placeholder="npx @modelcontextprotocol/server-filesystem"
                   value={mcpCommand}
                   onChange={(e) => setMcpCommand(e.target.value)}
                 />
               </div>
               <div className="space-y-2">
                 <Label htmlFor="mcp-args">Arguments (one per line)</Label>
                 <Textarea
                   id="mcp-args"
                   placeholder="/path/to/allowed/directory"
                   value={mcpArgs}
                   onChange={(e) => setMcpArgs(e.target.value)}
                   rows={3}
                 />
               </div>
             </>
           )}
           <div className="space-y-2">
             <Label htmlFor="mcp-env">Environment Variables (KEY=VALUE, one per line)</Label>
             <Textarea
               id="mcp-env"
               placeholder={"API_KEY=sk-123\nDEBUG=true"}
               value={mcpEnv}
               onChange={(e) => setMcpEnv(e.target.value)}
               rows={3}
             />
           </div>
         </>
       );
     }
     ```

  5. Replace the `mcp-server` case in `buildPayload()`:

     ```typescript
     case "mcp-server": {
       const args =
         mcpTransport === "stdio" && mcpArgs.trim()
           ? mcpArgs
               .split("\n")
               .map((s) => s.trim())
               .filter(Boolean)
           : undefined;
       const env = mcpEnv.trim()
         ? Object.fromEntries(
             mcpEnv
               .split("\n")
               .map((line) => {
                 const idx = line.indexOf("=");
                 return idx > 0
                   ? [line.slice(0, idx).trim(), line.slice(idx + 1).trim()]
                   : null;
               })
               .filter(Boolean) as [string, string][],
           )
         : undefined;
       return {
         type: "mcp",
         name: mcpName || "MCP Server",
         authType: "mcp",
         credentials: {},
         config: {
           transport: mcpTransport,
           serverName: mcpName,
           ...(mcpTransport === "http"
             ? { url: mcpUrl }
             : { command: mcpCommand, args }),
           ...(env && Object.keys(env).length > 0 ? { env } : {}),
         },
       };
     }
     ```

  6. Update `isFormValid()` for the `mcp-server` case to require server name and transport-specific field:

     ```typescript
     case "mcp-server":
       return (
         mcpName.trim().length > 0 &&
         (mcpTransport === "http"
           ? mcpUrl.trim().length > 0
           : mcpCommand.trim().length > 0)
       );
     ```

- [ ] Modify `apps/dashboard/src/lib/hooks/use-connectors.ts` to add `refreshTools` and `getStatus` methods:
  1. Add these functions inside `useConnectors()`, after `testConnector`:

     ```typescript
     const refreshTools = async (id: string) => {
       const result = await api.connectors.refreshTools(id);
       return result as {
         success: boolean;
         toolCount?: number;
         tools?: { name: string; description: string }[];
         message?: string;
       };
     };

     const getStatus = async (id: string) => {
       const result = await api.connectors.status(id);
       return result as {
         connected: boolean;
         toolCount: number;
         lastConnected: string | null;
         error: string | null;
       };
     };
     ```

  2. Add them to the return object:

     ```typescript
     return {
       connectors,
       isLoading,
       error,
       refetch: fetchConnectors,
       createConnector,
       deleteConnector,
       testConnector,
       refreshTools,
       getStatus,
     };
     ```

- [ ] Modify `apps/dashboard/src/components/connectors/connector-card.tsx` to show MCP-specific status information. Make the following changes:
  1. Add new imports and props:

     ```typescript
     import { useState, useEffect } from "react";
     import { Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
     ```

  2. Extend `ConnectorCardProps` to include the new callbacks:

     ```typescript
     interface ConnectorCardProps {
       connector: Connector;
       onTest: (id: string) => Promise<{ success: boolean; message?: string }>;
       onDelete: (id: string) => Promise<void>;
       onRefreshTools?: (id: string) => Promise<{
         success: boolean;
         toolCount?: number;
         tools?: { name: string; description: string }[];
         message?: string;
       }>;
       onGetStatus?: (id: string) => Promise<{
         connected: boolean;
         toolCount: number;
         lastConnected: string | null;
         error: string | null;
       }>;
     }
     ```

  3. Inside the component, add MCP status state and a useEffect to fetch it:

     ```typescript
     const [mcpStatus, setMcpStatus] = useState<{
       connected: boolean;
       toolCount: number;
       lastConnected: string | null;
       error: string | null;
     } | null>(null);
     const [isRefreshing, setIsRefreshing] = useState(false);

     useEffect(() => {
       if (connector.type === "mcp" && onGetStatus) {
         onGetStatus(connector.id)
           .then(setMcpStatus)
           .catch(() => {});
       }
     }, [connector.id, connector.type, onGetStatus]);

     const handleRefresh = async () => {
       if (!onRefreshTools) return;
       setIsRefreshing(true);
       try {
         const result = await onRefreshTools(connector.id);
         if (result.success && result.toolCount !== undefined) {
           setMcpStatus((prev) =>
             prev
               ? { ...prev, toolCount: result.toolCount!, connected: true }
               : {
                   connected: true,
                   toolCount: result.toolCount!,
                   lastConnected: new Date().toISOString(),
                   error: null,
                 },
           );
         }
       } catch {
         // Error handled by parent
       } finally {
         setIsRefreshing(false);
       }
     };
     ```

  4. In the JSX, add MCP status display between the status badge area and the `<CardContent>`. Add this inside `<CardContent>` before the test result display:

     ```tsx
     {
       connector.type === "mcp" && mcpStatus && (
         <div className="mb-3 space-y-1">
           <div className="flex items-center gap-2 text-xs">
             {mcpStatus.connected ? (
               <>
                 <Wifi className="h-3 w-3 text-green-500" />
                 <span className="text-green-700 dark:text-green-400">Connected</span>
               </>
             ) : (
               <>
                 <WifiOff className="h-3 w-3 text-muted-foreground" />
                 <span className="text-muted-foreground">Disconnected</span>
               </>
             )}
             <span className="text-muted-foreground">
               {mcpStatus.toolCount} tool{mcpStatus.toolCount !== 1 ? "s" : ""}
             </span>
           </div>
           {mcpStatus.error && <p className="text-xs text-destructive">{mcpStatus.error}</p>}
           {mcpStatus.lastConnected && (
             <p className="text-xs text-muted-foreground">
               Last connected: {new Date(mcpStatus.lastConnected).toLocaleString()}
             </p>
           )}
         </div>
       );
     }
     ```

  5. Add a "Refresh Tools" button in the button row for MCP connectors:

     ```tsx
     {
       connector.type === "mcp" && onRefreshTools && (
         <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
           {isRefreshing ? (
             <>
               <Loader2 className="mr-1 h-3 w-3 animate-spin" />
               Refreshing...
             </>
           ) : (
             <>
               <RefreshCw className="mr-1 h-3 w-3" />
               Refresh Tools
             </>
           )}
         </Button>
       );
     }
     ```

- [ ] Modify `apps/dashboard/src/app/(dashboard)/connectors/page.tsx` to pass the new callbacks to `ConnectorCard`:
  1. Destructure the new methods from `useConnectors`:

     ```typescript
     const {
       connectors,
       isLoading,
       error,
       deleteConnector,
       testConnector,
       refreshTools,
       getStatus,
     } = useConnectors();
     ```

  2. Update the `ConnectorCard` component usage to pass the new props:

     ```tsx
     <ConnectorCard
       key={connector.id}
       connector={connector}
       onTest={testConnector}
       onDelete={deleteConnector}
       onRefreshTools={refreshTools}
       onGetStatus={getStatus}
     />
     ```

- [ ] Run: `pnpm --filter gnana-dashboard typecheck`
- [ ] Run: `pnpm build` (full monorepo build)
- [ ] Commit all changes.
