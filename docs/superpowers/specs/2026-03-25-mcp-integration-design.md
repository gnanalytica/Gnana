# MCP Server Integration — Design Spec

## Overview

Integrate Model Context Protocol (MCP) servers as first-class tool sources in Gnana. Users add MCP servers as connectors (via the dashboard App Store), and their tools become available to agents alongside connector-provided tools. The MCPClient handles transport, tool discovery, and invocation. The MCPManager handles multi-server lifecycle per workspace. During agent execution, MCP tools are resolved and registered into the ToolExecutor transparently — the DAG executor and pipeline engine do not know or care whether a tool comes from a connector or an MCP server.

## Current State

- `packages/mcp/src/index.ts` exports `MCPClientAdapter` — a working prototype that can connect via stdio/HTTP, list tools (as `LLMToolDef[]`), and call tools. Uses `@modelcontextprotocol/sdk` Client, StdioClientTransport, and StreamableHTTPClientTransport.
- `@gnana/core` defines `ToolDefinition` with `{ name, description, inputSchema, handler }` and `MCPServerConfig` with `{ name, transport, command?, url?, env? }`.
- `AgentDefinition` has `mcpServers?: MCPServerConfig[]` but it is unused at runtime.
- The `connectors` table stores connector config as JSONB. MCP servers are already saveable as `type='mcp'` connectors.
- The dashboard App Store already has an "MCP Server" card and an install dialog with transport + URL/command fields.
- The `run:execute` job handler in `packages/server/src/index.ts` does not yet build a full RunContext with tool resolution — it just marks runs as completed.

## Design

### 1. MCPClient — `packages/mcp/src/client.ts`

Refactor the existing `MCPClientAdapter` into a focused `MCPClient` class. One instance per MCP server connection.

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
  private status: MCPClientStatus = {
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
      this.status = {
        connected: true,
        toolCount: this.tools.length,
        lastConnected: new Date(),
        error: null,
      };
      this.retryCount = 0;
    } catch (err) {
      this.status.connected = false;
      this.status.error = err instanceof Error ? err.message : String(err);
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
    this.status.connected = false;
    this.status.toolCount = 0;
  }

  /** Reconnect with exponential backoff. 3 retries max. */
  async reconnect(): Promise<void> {
    await this.disconnect();
    for (let attempt = 1; attempt <= MCPClient.MAX_RETRIES; attempt++) {
      this.retryCount = attempt;
      const delay = MCPClient.RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
      try {
        await this.connect();
        return;
      } catch {
        if (attempt === MCPClient.MAX_RETRIES) {
          throw new Error(
            `Failed to reconnect to MCP server "${this.config.name}" after ${MCPClient.MAX_RETRIES} attempts`,
          );
        }
      }
    }
  }

  isConnected(): boolean {
    return this.status.connected;
  }

  getStatus(): MCPClientStatus {
    return { ...this.status };
  }

  /** Get all discovered tools as Gnana ToolDefinitions. */
  getTools(): ToolDefinition[] {
    return this.tools;
  }

  /** Call a tool on this MCP server. Accepts the raw tool name (without namespace prefix). */
  async callTool(toolName: string, input: unknown): Promise<string> {
    if (!this.status.connected) {
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

      const toolDef: ToolDefinition = {
        name: qualifiedName,
        description: mcpTool.description ?? "",
        inputSchema: mcpTool.inputSchema as Record<string, unknown>,
        handler: async (input) => {
          return this.callTool(mcpTool.name, input);
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

**Key decisions:**

- Namespacing uses underscores: `mcp_servername_toolname`. This avoids confusion with the double-underscore `__` separator used by the existing `MCPClientAdapter` (which we are replacing), and is safe for LLM tool-use formats that may treat double underscores specially.
- The `handler` closure captures the MCPClient instance and the raw tool name, so once registered in ToolExecutor, calling `execute("mcp_filesystem_readFile", input)` transparently routes to the right MCP server.
- `discoverTools()` is called during `connect()` so tools are always available immediately after connection.

### 2. MCPManager — `packages/mcp/src/manager.ts`

Manages the full lifecycle of multiple MCP server connections. One instance per server process (not per workspace — connections are loaded on-demand per workspace).

```typescript
import { MCPClient, type MCPClientStatus } from "./client.js";
import type { MCPServerConfig, ToolDefinition } from "@gnana/core";

export interface MCPServerInfo {
  serverId: string; // connector ID from database
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
        result.push({ serverId, config, status: client.getStatus() });
      }
    }
    return result;
  }

  /** Get status of a single server. */
  getServerStatus(serverId: string): MCPClientStatus | null {
    return this.clients.get(serverId)?.getStatus() ?? null;
  }

  /** Disconnect all servers. Call on process shutdown. */
  async shutdown(): Promise<void> {
    const ids = [...this.clients.keys()];
    await Promise.allSettled(ids.map((id) => this.stopServer(id)));
  }
}
```

**Key decisions:**

- The MCPManager does not access the database directly. Server configs are passed in from the caller (the run executor or the API route). This keeps the MCP package pure — no DB dependency.
- Server IDs correspond to connector UUIDs from the `connectors` table.
- The manager is stateful — connections persist between runs. If agent A and agent B both use the same MCP server connector, they share the connection.

### 3. Types — `packages/mcp/src/types.ts`

Re-export and extend the core MCPServerConfig for MCP-package-specific needs.

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

### 4. Package Barrel — `packages/mcp/src/index.ts`

```typescript
export { MCPClient } from "./client.js";
export type { MCPClientStatus } from "./client.js";
export { MCPManager } from "./manager.js";
export type { MCPServerRecord } from "./types.js";
```

The old `MCPClientAdapter` is removed. Any code importing it should switch to `MCPClient` + `MCPManager`.

### 5. Core Type Updates — `packages/core/src/types.ts`

Add `args` to `MCPServerConfig`:

```typescript
export interface MCPServerConfig {
  name: string;
  transport: "stdio" | "http";
  command?: string; // stdio: the command to spawn
  args?: string[]; // stdio: command arguments
  url?: string; // http: server URL
  env?: Record<string, string>; // environment variables for the server process
}
```

The existing interface already has `name`, `transport`, `command`, `url`, `env`. It is missing `args`. Add it.

### 6. Integration with Agent Execution — Tool Resolution

**File: `packages/server/src/execution/resolve-tools.ts` (new)**

This module resolves all tools for an agent run: connector tools + MCP tools.

```typescript
import { ToolExecutorImpl } from "@gnana/core";
import type { ToolDefinition, MCPServerConfig } from "@gnana/core";
import type { MCPManager } from "@gnana/mcp";
import type { Database } from "@gnana/db";

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

  // 1. Load connector tools from DB (non-MCP connectors)
  //    Query connectorTools for all enabled connectors in the workspace
  //    that are assigned to this agent (via agent.toolsConfig or all workspace connectors).
  //    Each connector tool row already has name, description, inputSchema.
  //    Build ToolDefinitions with HTTP-based handlers that call the connector API.
  //    (Implementation detail — existing connector tool resolution, out of scope for this spec.)

  // 2. Load MCP tools
  for (const serverId of opts.mcpServerIds) {
    const status = opts.mcpManager.getServerStatus(serverId);

    if (!status || !status.connected) {
      // Server not connected — try to start it
      const config = await loadMCPServerConfig(opts.db, serverId, opts.workspaceId);
      if (config) {
        try {
          await opts.mcpManager.startServer(serverId, config);
        } catch (err) {
          // Log warning but don't fail the whole run
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
async function loadMCPServerConfig(
  db: Database,
  connectorId: string,
  workspaceId: string,
): Promise<MCPServerConfig | null> {
  // Query: SELECT * FROM connectors
  //   WHERE id = connectorId AND workspace_id = workspaceId
  //   AND type = 'mcp' AND enabled = true
  // Extract config JSONB and map to MCPServerConfig:
  //   { name: connector.name, transport, command, args, url, env }
  // Return null if not found or disabled.
  // (Actual Drizzle query omitted — follows the same pattern as connectorRoutes.)
  return null; // placeholder
}
```

**Integration point — `packages/server/src/index.ts`**

The `run:execute` job handler needs to be updated:

```typescript
// In createGnanaServer():
const mcpManager = new MCPManager();

// In the run:execute handler:
queue.register("run:execute", async (payload) => {
  const { runId, agentId, workspaceId } = payload as {
    runId: string;
    agentId: string;
    workspaceId: string;
  };

  const agent = /* load agent from DB */;
  const mcpServerIds = extractMCPServerIds(agent);

  const toolExecutor = await resolveTools({
    db,
    mcpManager,
    agentId,
    workspaceId,
    mcpServerIds,
  });

  // Build RunContext or DAGContext with toolExecutor and run the pipeline.
  // ...
});

// On server shutdown:
process.on("SIGTERM", async () => {
  await mcpManager.shutdown();
  queue.stop();
});
```

Where `extractMCPServerIds` reads the agent's `toolsConfig` or `pipelineConfig` JSONB to find which MCP connector IDs the agent uses. The schema for this is:

```typescript
// agent.toolsConfig contains:
{
  connectorIds: string[];   // regular connector IDs
  mcpServerIds: string[];   // MCP connector IDs
}
```

### 7. MCP Connector API Routes

**File: modify `packages/server/src/routes/connectors.ts`**

Add MCP-specific endpoints to the existing connector routes.

#### `POST /api/connectors/:id/test` — MCP case

Add an `mcp` case to the existing test endpoint switch:

```typescript
case "mcp": {
  const connConfig = connector.config as { transport: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> };
  const mcpConfig: MCPServerConfig = {
    name: connector.name,
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
      tools: tools.map(t => ({ name: t.name, description: t.description })),
    });
  } catch (err) {
    return c.json({
      success: false,
      message: `MCP connection failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
```

#### `GET /api/connectors/:id/tools` — already exists

The existing endpoint returns rows from `connector_tools`. For MCP connectors, tools are discovered dynamically (not stored in the DB). Two options:

**Option A (recommended):** On MCP connector creation/test, persist discovered tools to `connector_tools` table. This means the tools list is a snapshot that updates when the user clicks "Refresh" or reconnects. Advantages: consistent with non-MCP connectors, works when MCP server is offline, no live connection needed to browse tools.

**Option B:** For MCP connectors, live-query the MCP server. Requires an active connection.

**Decision:** Option A. Persist tool snapshots to `connector_tools` on first connect and on manual refresh. Add a `POST /api/connectors/:id/refresh-tools` endpoint:

```typescript
app.post("/:id/refresh-tools", requireRole("admin"), async (c) => {
  // 1. Load connector (verify type='mcp' and workspace ownership)
  // 2. Build MCPServerConfig from connector.config
  // 3. Create temporary MCPClient, connect, get tools
  // 4. Delete existing connector_tools rows for this connector
  // 5. Insert new rows from discovered tools
  // 6. Disconnect temporary client
  // 7. Return new tool list
});
```

### 8. MCP Connector in Dashboard

#### App Store Card — already exists

The MCP Server card in `apps/dashboard/src/app/(dashboard)/connectors/store/page.tsx` is already defined:

```typescript
{
  id: "mcp-server",
  name: "MCP Server",
  icon: "\uD83D\uDD27",
  category: "Custom",
  description: "Connect a Model Context Protocol server",
  authType: "mcp",
}
```

No changes needed.

#### Install Dialog — enhance existing

The install dialog in `apps/dashboard/src/components/connectors/install-dialog.tsx` already has MCP fields (transport select, URL/command input). Enhance it:

**Add these fields for MCP:**

- Server name input (used for tool namespacing, defaults to connector name)
- Args input (for stdio, comma-separated or multi-line)
- Env vars input (key=value pairs, one per line)

**Updated MCP section in install dialog:**

```tsx
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
          Used for tool namespacing: mcp_{"{name}"}_toolName
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
          <div className="space-y-2">
            <Label htmlFor="mcp-env">Environment Variables (KEY=VALUE, one per line)</Label>
            <Textarea
              id="mcp-env"
              placeholder="API_KEY=sk-123&#10;DEBUG=true"
              value={mcpEnv}
              onChange={(e) => setMcpEnv(e.target.value)}
              rows={3}
            />
          </div>
        </>
      )}
    </>
  );
}
```

**Updated buildPayload for MCP:**

```typescript
case "mcp-server": {
  const args = mcpTransport === "stdio" && mcpArgs.trim()
    ? mcpArgs.split("\n").map(s => s.trim()).filter(Boolean)
    : undefined;
  const env = mcpEnv.trim()
    ? Object.fromEntries(
        mcpEnv.split("\n").map(line => {
          const idx = line.indexOf("=");
          return idx > 0 ? [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] : null;
        }).filter(Boolean) as [string, string][]
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
      ...(mcpTransport === "http" ? { url: mcpUrl } : { command: mcpCommand, args }),
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
    },
  };
}
```

#### MCP Config Form — `apps/dashboard/src/components/connectors/mcp-config-form.tsx` (new)

Optional dedicated component for detailed MCP server configuration. Used for editing an existing MCP connector. Extracted from the install dialog for reuse on the connector detail page.

```typescript
export interface MCPConfigFormProps {
  initialConfig?: {
    serverName: string;
    transport: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
  };
  onSave: (config: MCPConfigFormData) => Promise<void>;
  onTest: () => Promise<{
    success: boolean;
    message: string;
    tools?: { name: string; description: string }[];
  }>;
}

export interface MCPConfigFormData {
  serverName: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}
```

This form shows:

- Server name input
- Transport select (stdio / HTTP)
- Transport-specific fields (command + args + env for stdio, URL for HTTP)
- "Test Connection" button that calls `onTest` and displays results (tool count + tool names)
- "Save" button

### 9. MCP Server Status on Connectors Page

On the connectors list page (`apps/dashboard/src/app/(dashboard)/connectors/page.tsx`), the `ConnectorCard` component shows each installed connector. For MCP connectors, enhance the card to show:

- Connection status badge: "Connected" (green), "Disconnected" (gray), "Error" (red)
- Tool count (e.g., "12 tools")
- Last connected timestamp
- Error message (if status is error)
- "Reconnect" button (calls `POST /api/connectors/:id/test` which also reconnects)
- "Refresh Tools" button (calls `POST /api/connectors/:id/refresh-tools`)

**New API endpoint for MCP server status:**

```
GET /api/connectors/:id/status
```

Returns:

```typescript
{
  connected: boolean;
  toolCount: number;
  lastConnected: string | null; // ISO timestamp
  error: string | null;
}
```

This endpoint checks the in-memory MCPManager for the server's status. If the server is not in the manager (not started yet), it returns `{ connected: false, toolCount: 0, lastConnected: null, error: null }`.

### 10. MCP Server Selection in Agent Builder

When configuring an agent's tools (in the agent builder or canvas), users need to select which MCP servers to include. This is stored in the agent's `toolsConfig` JSONB.

**Agent tools config shape:**

```typescript
interface AgentToolsConfig {
  /** Connector IDs for standard connectors (GitHub, Slack, etc.). */
  connectorIds: string[];
  /** Connector IDs for MCP server connectors. */
  mcpServerIds: string[];
}
```

The agent builder UI shows:

- A list of installed connectors (non-MCP) with checkboxes
- A list of installed MCP server connectors with checkboxes + expandable tool list
- Selected MCP servers show their discovered tools (read from `connector_tools`)

## Files to Create/Modify

### Create

| File                                                           | Purpose                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/mcp/src/client.ts`                                   | MCPClient class — single server connection, transport, tool discovery |
| `packages/mcp/src/manager.ts`                                  | MCPManager — multi-server lifecycle management                        |
| `packages/mcp/src/types.ts`                                    | MCPServerRecord and MCP-specific types                                |
| `packages/server/src/execution/resolve-tools.ts`               | Tool resolution: connector tools + MCP tools -> ToolExecutor          |
| `apps/dashboard/src/components/connectors/mcp-config-form.tsx` | Reusable MCP configuration form component                             |

### Modify

| File                                                          | Change                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/mcp/src/index.ts`                                   | Replace MCPClientAdapter with new barrel exports                  |
| `packages/core/src/types.ts`                                  | Add `args?: string[]` to MCPServerConfig                          |
| `packages/server/src/index.ts`                                | Instantiate MCPManager, pass to run executor, shutdown on SIGTERM |
| `packages/server/src/routes/connectors.ts`                    | Add MCP test case, `/refresh-tools` endpoint, `/status` endpoint  |
| `apps/dashboard/src/components/connectors/install-dialog.tsx` | Add server name, args, env fields for MCP                         |
| `apps/dashboard/src/components/connectors/connector-card.tsx` | Show MCP status, tool count, reconnect button                     |

### No Changes Needed

| File                                                           | Reason                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `apps/dashboard/src/app/(dashboard)/connectors/store/page.tsx` | MCP Server card already exists                                                    |
| `packages/core/src/tool-executor.ts`                           | No changes — MCP tools are standard ToolDefinitions                               |
| `packages/core/src/dag-executor.ts`                            | No changes — uses ToolExecutor interface, agnostic to tool source                 |
| `packages/core/src/pipeline.ts`                                | No changes — same reason                                                          |
| `packages/db/src/schema.ts`                                    | No schema changes — `connectors` and `connector_tools` tables already support MCP |

## Data Flow

### Adding an MCP Server

```
User opens App Store
  -> Clicks "Install" on MCP Server card
  -> Fills out form (transport, URL/command, server name, args, env)
  -> Clicks "Connect"
  -> Dashboard POST /api/connectors { type: "mcp", config: { ... } }
  -> Server creates connector row in DB
  -> Dashboard calls POST /api/connectors/:id/test
  -> Server creates temporary MCPClient, connects, discovers tools
  -> Server persists tools to connector_tools table
  -> Returns tool list to dashboard
  -> Dashboard shows "Connected! 12 tools discovered"
```

### Agent Run with MCP Tools

```
Job queue picks up run:execute
  -> Load agent from DB
  -> Extract mcpServerIds from agent.toolsConfig
  -> resolveTools():
      -> For each mcpServerId:
          -> Check MCPManager: is it connected?
          -> If not: load config from connectors table, start server
          -> Get ToolDefinition[] from MCPManager
          -> Register in ToolExecutor
  -> Build RunContext/DAGContext with the ToolExecutor
  -> Execute pipeline / DAG
  -> Tools like "mcp_filesystem_readFile" are called via ToolExecutor
  -> ToolExecutor calls the handler closure
  -> Handler calls MCPClient.callTool("readFile", input)
  -> MCPClient sends tools/call to the MCP server
  -> Result flows back through the pipeline
```

### MCP Server Reconnection

```
During resolveTools(), MCPManager reports server disconnected
  -> resolveTools() calls mcpManager.startServer(serverId, config)
  -> MCPClient.connect() fails
  -> MCPClient.reconnect() retries 3 times with exponential backoff (1s, 2s, 4s)
  -> If all retries fail: log warning, skip this server's tools
  -> Run continues with available tools (graceful degradation)
```

## Security Considerations

- **Stdio transport:** Spawns a child process on the server. Only allow stdio MCP servers on self-hosted / trusted deployments. In managed cloud, restrict to HTTP transport only (enforce via server config flag `ALLOW_STDIO_MCP=true/false`).
- **Environment variables:** The `env` field in MCP config can contain secrets. These are stored in the connector's `config` JSONB (not `credentials`). Consider moving sensitive env vars to the encrypted `credentials` field.
- **Tool execution:** MCP tools execute with the server's permissions. Audit logging should capture all MCP tool calls (already handled by the event bus emitting `run:tool_called` and `run:tool_result`).
- **Namespacing:** Tool name prefixing (`mcp_servername_toolname`) prevents a malicious MCP server from shadowing built-in tools.

## Testing Plan

1. **Unit tests for MCPClient:** Mock `@modelcontextprotocol/sdk` Client. Test connect, disconnect, reconnect (with retry), tool discovery, callTool.
2. **Unit tests for MCPManager:** Test multi-server lifecycle, getTools aggregation, shutdown.
3. **Integration test:** Spin up a real MCP server (e.g., `@modelcontextprotocol/server-memory` or a simple test server), connect via MCPClient, list tools, call a tool.
4. **API tests:** Test `/connectors/:id/test` with type=mcp, `/connectors/:id/refresh-tools`.
5. **E2E test:** Create MCP connector in dashboard, verify tools appear, trigger a run that uses an MCP tool.
