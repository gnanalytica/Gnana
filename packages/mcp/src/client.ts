import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ToolDefinition, MCPServerConfig } from "@gnana/core";

export interface MCPClientStatus {
  connected: boolean;
  toolCount: number;
  lastConnected: Date | null;
  error: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A single MCP server connection.
 *
 * Wraps the @modelcontextprotocol/sdk Client and exposes discovered tools
 * as Gnana ToolDefinition[] (with handler functions that proxy callTool).
 *
 * Supports stdio and streamable-HTTP transports.
 */
export class MCPClient {
  private client: Client;
  private transport: Transport | null = null;
  private tools: ToolDefinition[] = [];
  private readonly config: MCPServerConfig;
  private _status: MCPClientStatus = {
    connected: false,
    toolCount: 0,
    lastConnected: null,
    error: null,
  };
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_BASE_MS = 1000;

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
      // Swallow -- transport may already be closed
    }
    this.transport = null;
    this.tools = [];
    this._status.connected = false;
    this._status.toolCount = 0;
  }

  /** Reconnect with exponential backoff. 3 retries max. */
  async reconnect(): Promise<void> {
    await this.disconnect();
    // Re-create the internal SDK client -- the old one is closed
    this.client = new Client({ name: "gnana", version: "0.0.1" });

    for (let attempt = 1; attempt <= MCPClient.MAX_RETRIES; attempt++) {
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

    // MCP results contain a content array -- extract text parts
    if ("content" in result && Array.isArray(result.content)) {
      const parts = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!);
      return parts.join("\n") || JSON.stringify(result.content);
    }

    // Compatibility: some SDK versions return toolResult directly
    if ("toolResult" in result) {
      return typeof result.toolResult === "string"
        ? result.toolResult
        : JSON.stringify(result.toolResult);
    }

    return JSON.stringify(result);
  }

  // ---- Private ----

  private createTransport(): Transport {
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
    throw new Error(`Unsupported MCP transport: ${String(this.config.transport)}`);
  }

  /** Call tools/list and convert MCP tool schemas to ToolDefinition[]. */
  private async discoverTools(): Promise<void> {
    const result = await this.client.listTools();
    const serverName = this.config.name;

    this.tools = result.tools.map((mcpTool) => {
      const qualifiedName = `mcp_${serverName}_${mcpTool.name}`;
      // Capture the raw tool name for the closure -- the handler
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
