"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MCPConfigForm, type MCPConfigFormData } from "@/components/connectors/mcp-config-form";

export interface InstallDialogApp {
  id: string;
  name: string;
  authType: "oauth" | "api_key" | "mcp";
}

interface InstallDialogProps {
  app: InstallDialogApp | null;
  isOpen: boolean;
  onClose: () => void;
  onInstall: (data: {
    type: string;
    name: string;
    authType: string;
    credentials: Record<string, unknown>;
    config: Record<string, unknown>;
  }) => Promise<void>;
}

export function InstallDialog({ app, isOpen, onClose, onInstall }: InstallDialogProps) {
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GitHub fields
  const [ghToken, setGhToken] = useState("");
  const [ghOwner, setGhOwner] = useState("");

  // Slack fields
  const [slackToken, setSlackToken] = useState("");

  // HTTP API fields
  const [httpBaseUrl, setHttpBaseUrl] = useState("");
  const [httpAuthType, setHttpAuthType] = useState("none");
  const [httpToken, setHttpToken] = useState("");
  const [httpHeaderName, setHttpHeaderName] = useState("");
  const [httpUsername, setHttpUsername] = useState("");
  const [httpPassword, setHttpPassword] = useState("");

  // PostgreSQL fields
  const [pgConnectionString, setPgConnectionString] = useState("");

  // MCP fields
  const [mcpConfig, setMcpConfig] = useState<MCPConfigFormData>({
    serverName: "",
    transport: "http",
    url: "",
  });

  const resetForm = () => {
    setSuccess(false);
    setError(null);
    setIsSubmitting(false);
    setGhToken("");
    setGhOwner("");
    setSlackToken("");
    setHttpBaseUrl("");
    setHttpAuthType("none");
    setHttpToken("");
    setHttpHeaderName("");
    setHttpUsername("");
    setHttpPassword("");
    setPgConnectionString("");
    setMcpConfig({ serverName: "", transport: "http", url: "" });
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const buildPayload = () => {
    if (!app) return null;

    switch (app.id) {
      case "github":
        return {
          type: "github",
          name: "GitHub",
          authType: "oauth",
          credentials: { token: ghToken },
          config: ghOwner ? { defaultOwner: ghOwner } : {},
        };
      case "slack":
        return {
          type: "slack",
          name: "Slack",
          authType: "oauth",
          credentials: { token: slackToken },
          config: {},
        };
      case "http-api":
        return {
          type: "http",
          name: "HTTP API",
          authType: "api_key",
          credentials: buildHttpCredentials(),
          config: { baseUrl: httpBaseUrl },
        };
      case "postgres":
        return {
          type: "postgres",
          name: "PostgreSQL",
          authType: "api_key",
          credentials: { connectionString: pgConnectionString },
          config: {},
        };
      case "mcp-server":
        return {
          type: "mcp",
          name: mcpConfig.serverName || "MCP Server",
          authType: "mcp",
          credentials: {},
          config: {
            transport: mcpConfig.transport,
            ...(mcpConfig.transport === "http" ? { url: mcpConfig.url } : {}),
            ...(mcpConfig.transport === "stdio"
              ? { command: mcpConfig.command, args: mcpConfig.args }
              : {}),
            ...(mcpConfig.env ? { env: mcpConfig.env } : {}),
          },
        };
      default:
        return null;
    }
  };

  const buildHttpCredentials = (): Record<string, unknown> => {
    switch (httpAuthType) {
      case "bearer":
        return { authType: "bearer", token: httpToken };
      case "api_key":
        return { authType: "api_key", headerName: httpHeaderName, token: httpToken };
      case "basic":
        return { authType: "basic", username: httpUsername, password: httpPassword };
      default:
        return { authType: "none" };
    }
  };

  const handleConnect = async () => {
    const payload = buildPayload();
    if (!payload) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await onInstall(payload);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create connector");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = (): boolean => {
    if (!app) return false;

    switch (app.id) {
      case "github":
        return ghToken.trim().length > 0;
      case "slack":
        return slackToken.trim().length > 0;
      case "http-api": {
        if (!httpBaseUrl.trim()) return false;
        if (httpAuthType === "bearer" || httpAuthType === "api_key")
          return httpToken.trim().length > 0;
        if (httpAuthType === "basic")
          return httpUsername.trim().length > 0 && httpPassword.trim().length > 0;
        return true;
      }
      case "postgres":
        return pgConnectionString.trim().length > 0;
      case "mcp-server":
        return (
          mcpConfig.serverName.trim().length > 0 &&
          (mcpConfig.transport === "http"
            ? (mcpConfig.url ?? "").trim().length > 0
            : (mcpConfig.command ?? "").trim().length > 0)
        );
      default:
        return false;
    }
  };

  if (!app) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect {app.name}</DialogTitle>
          <DialogDescription>
            {app.id === "github"
              ? "Enter a personal access token to connect GitHub."
              : app.id === "slack"
                ? "Enter a Slack bot token to connect your workspace."
                : app.id === "http-api"
                  ? "Configure a REST API connection."
                  : app.id === "postgres"
                    ? "Enter your PostgreSQL connection string."
                    : app.id === "mcp-server"
                      ? "Enter the MCP server URL or command."
                      : `Connect ${app.name} to your workspace.`}
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-lg font-semibold">Connected!</p>
            <Button onClick={handleClose} className="w-full">
              Close
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* GitHub Fields */}
            {app.id === "github" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="gh-token">Personal Access Token</Label>
                  <Input
                    id="gh-token"
                    type="password"
                    placeholder="ghp_..."
                    value={ghToken}
                    onChange={(e) => setGhToken(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gh-owner">Default Owner (optional)</Label>
                  <Input
                    id="gh-owner"
                    placeholder="Organization or username"
                    value={ghOwner}
                    onChange={(e) => setGhOwner(e.target.value)}
                  />
                </div>
              </>
            )}

            {/* Slack Fields */}
            {app.id === "slack" && (
              <div className="space-y-2">
                <Label htmlFor="slack-token">Bot Token</Label>
                <Input
                  id="slack-token"
                  type="password"
                  placeholder="xoxb-..."
                  value={slackToken}
                  onChange={(e) => setSlackToken(e.target.value)}
                />
              </div>
            )}

            {/* HTTP API Fields */}
            {app.id === "http-api" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="http-base-url">Base URL</Label>
                  <Input
                    id="http-base-url"
                    placeholder="https://api.example.com"
                    value={httpBaseUrl}
                    onChange={(e) => setHttpBaseUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Auth Type</Label>
                  <Select value={httpAuthType} onValueChange={setHttpAuthType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="bearer">Bearer Token</SelectItem>
                      <SelectItem value="api_key">API Key</SelectItem>
                      <SelectItem value="basic">Basic Auth</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {httpAuthType === "bearer" && (
                  <div className="space-y-2">
                    <Label htmlFor="http-bearer-token">Bearer Token</Label>
                    <Input
                      id="http-bearer-token"
                      type="password"
                      placeholder="Enter bearer token"
                      value={httpToken}
                      onChange={(e) => setHttpToken(e.target.value)}
                    />
                  </div>
                )}
                {httpAuthType === "api_key" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="http-header-name">Header Name</Label>
                      <Input
                        id="http-header-name"
                        placeholder="X-API-Key"
                        value={httpHeaderName}
                        onChange={(e) => setHttpHeaderName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="http-api-key">API Key</Label>
                      <Input
                        id="http-api-key"
                        type="password"
                        placeholder="Enter API key"
                        value={httpToken}
                        onChange={(e) => setHttpToken(e.target.value)}
                      />
                    </div>
                  </>
                )}
                {httpAuthType === "basic" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="http-username">Username</Label>
                      <Input
                        id="http-username"
                        placeholder="Username"
                        value={httpUsername}
                        onChange={(e) => setHttpUsername(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="http-password">Password</Label>
                      <Input
                        id="http-password"
                        type="password"
                        placeholder="Password"
                        value={httpPassword}
                        onChange={(e) => setHttpPassword(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </>
            )}

            {/* PostgreSQL Fields */}
            {app.id === "postgres" && (
              <div className="space-y-2">
                <Label htmlFor="pg-connection">Connection String</Label>
                <Input
                  id="pg-connection"
                  type="password"
                  placeholder="postgresql://user:pass@host:5432/db"
                  value={pgConnectionString}
                  onChange={(e) => setPgConnectionString(e.target.value)}
                />
              </div>
            )}

            {/* MCP Server Fields */}
            {app.id === "mcp-server" && (
              <MCPConfigForm inline onChange={setMcpConfig} />
            )}

            <Button
              onClick={handleConnect}
              className="w-full"
              disabled={!isFormValid() || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
