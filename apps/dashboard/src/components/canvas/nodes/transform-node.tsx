"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ArrowRightLeft, AlertTriangle } from "lucide-react";

function TransformNodeComponent({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  const hasErrors = Array.isArray(d._errors) && d._errors.length > 0;
  const isExecuting = d._executing === true;
  const isExecuted = d._executed === true;

  return (
    <div
      className={`bg-card border-2 rounded-lg p-4 min-w-[150px] shadow-md transition-all ${
        hasErrors ? "border-destructive" : "border-orange-400"
      } ${isExecuting ? "ring-2 ring-primary animate-pulse" : ""} ${isExecuted ? "opacity-70" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-orange-400" />
      <Handle type="source" position={Position.Right} className="!bg-orange-400" />
      <div className="flex items-center gap-2">
        <ArrowRightLeft className="h-4 w-4 text-orange-400" />
        <span className="text-xs uppercase font-semibold text-orange-400">Transform</span>
        {hasErrors && <AlertTriangle className="h-3 w-3 text-destructive" />}
      </div>
      <div className="text-sm text-foreground mt-1">
        {typeof d.expression === "string" ? d.expression : "Map data"}
      </div>
    </div>
  );
}

export const TransformNode = memo(TransformNodeComponent);
