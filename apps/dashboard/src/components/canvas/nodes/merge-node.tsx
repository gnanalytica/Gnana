"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Combine, AlertTriangle } from "lucide-react";

function MergeNodeComponent({ data }: NodeProps) {
  const d = (data ?? {}) as Record<string, unknown>;
  const inputCount = typeof d.inputs === "number" ? d.inputs : 2;
  const hasErrors = Array.isArray(d._errors) && d._errors.length > 0;
  const isExecuting = d._executing === true;
  const isExecuted = d._executed === true;
  const isCompleted = d._completed === true;
  const isFailed = d._failed === true;
  const isDryRunExecuted = d._dryRunExecuted === true;
  const isDryRunSkipped = d._dryRunSkipped === true;

  return (
    <div
      className={`bg-card border-2 rounded-lg p-4 min-w-[150px] shadow-md transition-all ${
        hasErrors ? "border-destructive" : "border-teal-400"
      } ${isExecuting ? "ring-2 ring-blue-500 animate-pulse" : ""} ${isCompleted ? "ring-2 ring-green-500/50" : ""} ${isFailed ? "ring-2 ring-red-500" : ""} ${isExecuted ? "opacity-70" : ""} ${isDryRunExecuted ? "ring-2 ring-green-500 !border-green-500" : ""} ${isDryRunSkipped ? "opacity-40" : ""}`}
    >
      {Array.from({ length: inputCount }, (_, i) => (
        <Handle
          key={i}
          type="target"
          position={Position.Left}
          id={`input-${i}`}
          className="!bg-teal-400"
          style={{ top: `${((i + 1) / (inputCount + 1)) * 100}%` }}
        />
      ))}
      <Handle type="source" position={Position.Right} className="!bg-teal-400" />
      <div className="flex items-center gap-2">
        <Combine className="h-4 w-4 text-teal-400" />
        <span className="text-xs uppercase font-semibold text-teal-400">Merge</span>
        {hasErrors && <AlertTriangle className="h-3 w-3 text-destructive" />}
      </div>
      <div className="text-sm text-foreground mt-1">Wait for {inputCount}</div>
    </div>
  );
}

export const MergeNode = memo(MergeNodeComponent);
