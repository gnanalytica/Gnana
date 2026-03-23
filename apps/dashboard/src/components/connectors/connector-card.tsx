"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
}

export function ConnectorCard({ connector, onTest, onDelete }: ConnectorCardProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const icon = typeIcons[connector.type] ?? "\uD83D\uDD0C";
  const status = connector.enabled ? "active" : "disabled";

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
          <Badge
            variant={status === "active" ? "default" : "destructive"}
            className={status === "active" ? "bg-green-600 hover:bg-green-600/80" : ""}
          >
            {status === "active" ? "Active" : "Disabled"}
          </Badge>
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
        <p className="text-sm text-muted-foreground mb-4">Auth: {connector.authType}</p>
        <div className="flex gap-2">
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
