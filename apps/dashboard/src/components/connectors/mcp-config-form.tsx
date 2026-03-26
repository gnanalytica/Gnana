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
  const [transport, setTransport] = useState<"stdio" | "http">(initialConfig?.transport ?? "http");
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

  const notifyChange = () => {
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
            notifyChange();
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
            notifyChange();
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
              notifyChange();
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
                notifyChange();
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
                notifyChange();
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
            notifyChange();
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
