"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Wrench, AlertTriangle } from "lucide-react";

function ToolNodeComponent({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  const hasErrors = Array.isArray(d._errors) && d._errors.length > 0;
  const isExecuting = d._executing === true;
  const isExecuted = d._executed === true;

  return (
    <div
      className={`bg-card border-2 rounded-lg p-4 min-w-[140px] shadow-md transition-all ${
        hasErrors ? "border-destructive" : "border-muted"
      } ${isExecuting ? "ring-2 ring-primary animate-pulse" : ""} ${isExecuted ? "opacity-70" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs uppercase font-semibold text-muted-foreground">Tool</span>
        {hasErrors && <AlertTriangle className="h-3 w-3 text-destructive" />}
      </div>
      <div className="text-sm text-foreground mt-1">{(d.name as string) ?? "Unnamed"}</div>
      {typeof d.description === "string" && (
        <div className="text-xs text-muted-foreground mt-0.5">{d.description}</div>
      )}
    </div>
  );
}

export const ToolNode = memo(ToolNodeComponent);
