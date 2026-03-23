"use client";

import { useState } from "react";
import { X, Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { WizardData } from "./wizard-shell";

interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  connector: string;
}

const AVAILABLE_TOOLS: ToolDefinition[] = [
  // GitHub
  {
    id: "get_pr_diff",
    name: "Get PR Diff",
    description: "Fetches the diff for a pull request",
    connector: "GitHub",
  },
  {
    id: "search_codebase",
    name: "Search Codebase",
    description: "Searches code across repositories",
    connector: "GitHub",
  },
  {
    id: "get_file",
    name: "Get File",
    description: "Retrieves file contents from a repository",
    connector: "GitHub",
  },
  // Slack
  {
    id: "send_message",
    name: "Send Message",
    description: "Sends a message to a Slack channel",
    connector: "Slack",
  },
  {
    id: "search_messages",
    name: "Search Messages",
    description: "Searches Slack messages across channels",
    connector: "Slack",
  },
  // Postgres
  {
    id: "query",
    name: "Run Query",
    description: "Executes a SQL query against the database",
    connector: "Postgres",
  },
  {
    id: "list_tables",
    name: "List Tables",
    description: "Lists all tables in the database",
    connector: "Postgres",
  },
  {
    id: "describe_table",
    name: "Describe Table",
    description: "Returns the schema for a table",
    connector: "Postgres",
  },
];

interface StepToolsProps {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
}

export function StepTools({ data, onChange }: StepToolsProps) {
  const [search, setSearch] = useState("");

  const filteredTools = AVAILABLE_TOOLS.filter((tool) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      tool.name.toLowerCase().includes(q) ||
      tool.description.toLowerCase().includes(q) ||
      tool.connector.toLowerCase().includes(q)
    );
  });

  // Group by connector
  const grouped: Record<string, ToolDefinition[]> = {};
  for (const tool of filteredTools) {
    const key = tool.connector;
    const list = grouped[key] ?? [];
    list.push(tool);
    grouped[key] = list;
  }

  const toggleTool = (toolId: string) => {
    const current = data.tools;
    if (current.includes(toolId)) {
      onChange({ tools: current.filter((id) => id !== toolId) });
    } else {
      onChange({ tools: [...current, toolId] });
    }
  };

  const removeTool = (toolId: string) => {
    onChange({ tools: data.tools.filter((id) => id !== toolId) });
  };

  const selectedToolDefs = AVAILABLE_TOOLS.filter((t) => data.tools.includes(t.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-6">
        {/* Left: Available tools */}
        <div className="flex-[3] space-y-4">
          <h3 className="text-sm font-medium">Available Tools</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tools..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
            {Object.entries(grouped).map(([connector, tools]) => (
              <div key={connector}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {connector}
                </p>
                <div className="space-y-1">
                  {tools.map((tool) => (
                    <label
                      key={tool.id}
                      className="flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={data.tools.includes(tool.id)}
                        onChange={() => toggleTool(tool.id)}
                        className="mt-0.5 accent-primary"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{tool.name}</p>
                        <p className="text-xs text-muted-foreground">{tool.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {Object.keys(grouped).length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No tools match your search.
              </p>
            )}
          </div>
        </div>

        {/* Right: Selected tools */}
        <div className="flex-[2] space-y-4">
          <h3 className="text-sm font-medium">
            Selected Tools{" "}
            <span className="text-muted-foreground">({data.tools.length} tools selected)</span>
          </h3>
          <div className="space-y-1 min-h-[100px]">
            {selectedToolDefs.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No tools selected yet.
              </p>
            )}
            {selectedToolDefs.map((tool) => (
              <div
                key={tool.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{tool.name}</p>
                  <p className="text-xs text-muted-foreground">{tool.connector}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeTool(tool.id)}
                  className="text-muted-foreground hover:text-foreground ml-2 shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom action buttons */}
      <div className="flex flex-wrap gap-2 pt-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/connectors/store">Browse App Store</Link>
        </Button>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Add MCP Server
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add MCP Server</DialogTitle>
              <DialogDescription>
                Connect a Model Context Protocol server to provide additional tools for your agent.
                This feature is coming soon.
              </DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Add Custom Tool
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Custom Tool</DialogTitle>
              <DialogDescription>
                Define a custom tool with its own schema and handler. This feature is coming soon.
              </DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
