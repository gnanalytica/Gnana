import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { LLMToolDef } from "@gnana/provider-base";

export interface MCPServerConfig {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export class MCPClientAdapter {
  private clients = new Map<string, Client>();

  async connect(config: MCPServerConfig): Promise<void> {
    const client = new Client({ name: "gnana", version: "0.0.1" });

    if (config.transport === "stdio" && config.command) {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
      });
      await client.connect(transport);
    } else if (config.transport === "http" && config.url) {
      const transport = new StreamableHTTPClientTransport(new URL(config.url));
      await client.connect(transport);
    } else {
      throw new Error(`Invalid MCP config for ${config.name}: missing command or url`);
    }

    this.clients.set(config.name, client);
  }

  async disconnect(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (client) {
      await client.close();
      this.clients.delete(serverName);
    }
  }

  async disconnectAll(): Promise<void> {
    const names = [...this.clients.keys()];
    await Promise.allSettled(names.map((name) => this.disconnect(name)));
  }

  async listTools(serverName?: string): Promise<LLMToolDef[]> {
    const tools: LLMToolDef[] = [];

    const clients = serverName
      ? [[serverName, this.clients.get(serverName)] as const]
      : [...this.clients.entries()];

    for (const [name, client] of clients) {
      if (!client) continue;
      const result = await client.listTools();
      for (const tool of result.tools) {
        tools.push({
          name: `${name}__${tool.name}`,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema as Record<string, unknown>,
        });
      }
    }

    return tools;
  }

  async callTool(qualifiedName: string, input: Record<string, unknown>): Promise<string> {
    const separatorIndex = qualifiedName.indexOf("__");
    if (separatorIndex === -1) {
      throw new Error(
        `Invalid MCP tool name: ${qualifiedName}. Expected format: serverName__toolName`,
      );
    }

    const serverName = qualifiedName.slice(0, separatorIndex);
    const toolName = qualifiedName.slice(separatorIndex + 2);

    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    const result = await client.callTool({ name: toolName, arguments: input });
    // MCP tool results contain content array — extract text
    const textParts = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!);
    return textParts.join("\n") || JSON.stringify(result.content);
  }

  isConnected(serverName: string): boolean {
    return this.clients.has(serverName);
  }

  get connectedServers(): string[] {
    return [...this.clients.keys()];
  }
}
