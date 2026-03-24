"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitFork, AlertTriangle } from "lucide-react";

function ParallelNodeComponent({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  const branchCount = typeof d.branches === "number" ? d.branches : 2;
  const hasErrors = Array.isArray(d._errors) && d._errors.length > 0;
  const isExecuting = d._executing === true;
  const isExecuted = d._executed === true;
  const isCompleted = d._completed === true;
  const isFailed = d._failed === true;

  return (
    <div
      className={`bg-card border-2 rounded-lg p-4 min-w-[150px] shadow-md transition-all ${
        hasErrors ? "border-destructive" : "border-cyan-400"
      } ${isExecuting ? "ring-2 ring-blue-500 animate-pulse" : ""} ${isCompleted ? "ring-2 ring-green-500/50" : ""} ${isFailed ? "ring-2 ring-red-500" : ""} ${isExecuted ? "opacity-70" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-cyan-400" />
      {Array.from({ length: branchCount }, (_, i) => (
        <Handle
          key={i}
          type="source"
          position={Position.Right}
          id={`branch-${i}`}
          className="!bg-cyan-400"
          style={{ top: `${((i + 1) / (branchCount + 1)) * 100}%` }}
        />
      ))}
      <div className="flex items-center gap-2">
        <GitFork className="h-4 w-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-cyan-400">Parallel</span>
        {hasErrors && <AlertTriangle className="h-3 w-3 text-destructive" />}
      </div>
      <div className="text-sm text-foreground mt-1">{branchCount} branches</div>
    </div>
  );
}

export const ParallelNode = memo(ParallelNodeComponent);
