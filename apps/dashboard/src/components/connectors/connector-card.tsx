"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Connector } from "@/types";

const typeIcons: Record<string, string> = {
  github: "\uD83D\uDC19",
  slack: "\uD83D\uDCAC",
  postgres: "\uD83D\uDC18",
  http: "\uD83C\uDF10",
  mcp: "\uD83D\uDD27",
};

interface ConnectorCardProps {
  connector: Connector;
  onTest: (id: string) => Promise<{ success: boolean; message?: string }>;
  onDelete: (id: string) => Promise<void>;
  onRefreshTools?: (id: string) => Promise<{ success: boolean; toolCount?: number; message?: string }>;
}

export function ConnectorCard({ connector, onTest, onDelete, onRefreshTools }: ConnectorCardProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);
  const [refreshResult, setRefreshResult] = useState<{
    success: boolean;
    toolCount?: number;
    message?: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const icon = typeIcons[connector.type] ?? "\uD83D\uDD0C";
  const status = connector.enabled ? "active" : "disabled";
  const isMcp = connector.type === "mcp";

  // Extract MCP-specific config values
  const mcpConnected = isMcp ? connector.enabled : undefined;
  const mcpToolCount = isMcp
    ? (connector.config?.toolCount as number | undefined)
    : undefined;

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await onTest(connector.id);
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

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setIsDeleting(true);
    try {
      await onDelete(connector.id);
    } catch {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleRefreshTools = async () => {
    if (!onRefreshTools) return;
    setIsRefreshing(true);
    setRefreshResult(null);
    try {
      const result = await onRefreshTools(connector.id);
      setRefreshResult(result);
    } catch (err) {
      setRefreshResult({
        success: false,
        message: err instanceof Error ? err.message : "Refresh failed",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{icon}</span>
            <div>
              <CardTitle className="text-base">{connector.name}</CardTitle>
              <Badge variant="secondary" className="mt-1 text-[10px]">
                {connector.type}
              </Badge>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge
              variant={status === "active" ? "default" : "destructive"}
              className={status === "active" ? "bg-green-600 hover:bg-green-600/80" : ""}
            >
              {status === "active" ? "Active" : "Disabled"}
            </Badge>
            {isMcp && (
              <Badge
                variant={mcpConnected ? "default" : "outline"}
                className={
                  mcpConnected
                    ? "bg-blue-600 hover:bg-blue-600/80 text-[10px]"
                    : "text-[10px] text-muted-foreground"
                }
              >
                {mcpConnected ? "Connected" : "Disconnected"}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {testResult && (
          <div
            className={`rounded-md p-2 mb-3 text-xs ${
              testResult.success
                ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {testResult.message ?? (testResult.success ? "Connection OK" : "Test failed")}
          </div>
        )}
        {refreshResult && (
          <div
            className={`rounded-md p-2 mb-3 text-xs ${
              refreshResult.success
                ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {refreshResult.success
              ? refreshResult.toolCount !== undefined
                ? `Tools refreshed — ${refreshResult.toolCount} tool${refreshResult.toolCount === 1 ? "" : "s"} available`
                : "Tools refreshed"
              : (refreshResult.message ?? "Refresh failed")}
          </div>
        )}
        {isMcp && mcpToolCount !== undefined && (
          <p className="text-sm text-muted-foreground mb-2">
            {mcpToolCount} tool{mcpToolCount === 1 ? "" : "s"} available
          </p>
        )}
        <p className="text-sm text-muted-foreground mb-4">Auth: {connector.authType}</p>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleTest} disabled={isTesting}>
            {isTesting ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Testing...
              </>
            ) : (
              "Test"
            )}
          </Button>
          {isMcp && onRefreshTools && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshTools}
              disabled={isRefreshing}
            >
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
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Removing...
              </>
            ) : confirmDelete ? (
              "Confirm Remove?"
            ) : (
              "Remove"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
