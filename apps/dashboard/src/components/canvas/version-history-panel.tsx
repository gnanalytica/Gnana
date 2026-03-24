"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, History, RotateCcw } from "lucide-react";
import type { NodeSpec, EdgeSpec } from "@/types/pipeline";

interface PipelineVersion {
  id: string;
  version: number;
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  message?: string;
  createdAt: string;
}

interface VersionHistoryPanelProps {
  agentId: string;
  onClose: () => void;
  onRestore: (nodes: NodeSpec[], edges: EdgeSpec[]) => void;
}

export function VersionHistoryPanel({ agentId, onClose, onRestore }: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<PipelineVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);

  useEffect(() => {
    // In a real implementation, this would fetch from the API
    // For now, we show an empty state
    setIsLoading(false);
    setVersions([]);
  }, [agentId]);

  return (
    <div className="flex flex-col h-full border-l border-border bg-card w-[280px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4" />
          <span className="text-sm font-semibold">Version History</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Version list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading && (
            <div className="text-sm text-muted-foreground text-center py-8">Loading...</div>
          )}
          {!isLoading && versions.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              No versions saved yet. Versions are created when you save the pipeline.
            </div>
          )}
          {versions.map((version) => (
            <button
              key={version.id}
              className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors ${
                selectedVersion === version.id ? "bg-accent" : ""
              }`}
              onClick={() => setSelectedVersion(version.id)}
            >
              <div className="font-medium">v{version.version}</div>
              {version.message && (
                <div className="text-xs text-muted-foreground truncate">{version.message}</div>
              )}
              <div className="text-xs text-muted-foreground mt-0.5">
                {new Date(version.createdAt).toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">
                {version.nodes.length} nodes, {version.edges.length} edges
              </div>
              {selectedVersion === version.id && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestore(version.nodes, version.edges);
                  }}
                >
                  <RotateCcw className="h-3 w-3" />
                  Restore
                </Button>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
