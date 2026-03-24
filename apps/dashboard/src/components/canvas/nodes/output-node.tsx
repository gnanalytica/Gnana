"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CheckCircle, AlertTriangle } from "lucide-react";

function OutputNodeComponent({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  const hasErrors = Array.isArray(d._errors) && d._errors.length > 0;
  const isExecuting = d._executing === true;
  const isExecuted = d._executed === true;

  return (
    <div
      className={`bg-card border-2 rounded-lg p-4 min-w-[140px] shadow-md transition-all ${
        hasErrors ? "border-destructive" : "border-status-completed"
      } ${isExecuting ? "ring-2 ring-primary animate-pulse" : ""} ${isExecuted ? "opacity-70" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-status-completed" />
      <div className="flex items-center gap-2">
        <CheckCircle className="h-4 w-4 text-status-completed" />
        <span className="text-xs uppercase font-semibold text-status-completed">Output</span>
        {hasErrors && <AlertTriangle className="h-3 w-3 text-destructive" />}
      </div>
      <div className="text-sm text-foreground mt-1">{(d.label as string) ?? "Result"}</div>
    </div>
  );
}

export const OutputNode = memo(OutputNodeComponent);
