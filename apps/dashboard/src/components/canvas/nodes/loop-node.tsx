"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Repeat, AlertTriangle } from "lucide-react";

function LoopNodeComponent({ data }: NodeProps) {
  const d = (data ?? {}) as Record<string, unknown>;
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
        hasErrors ? "border-destructive" : "border-amber-400"
      } ${isExecuting ? "ring-2 ring-blue-500 animate-pulse" : ""} ${isCompleted ? "ring-2 ring-green-500/50" : ""} ${isFailed ? "ring-2 ring-red-500" : ""} ${isExecuted ? "opacity-70" : ""} ${isDryRunExecuted ? "ring-2 ring-green-500 !border-green-500" : ""} ${isDryRunSkipped ? "opacity-40" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-amber-400" />
      <Handle
        type="source"
        position={Position.Right}
        id="body"
        className="!bg-amber-400"
        style={{ top: "35%" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="done"
        className="!bg-status-completed"
        style={{ top: "65%" }}
      />
      <div className="flex items-center gap-2">
        <Repeat className="h-4 w-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-amber-400">Loop</span>
        {hasErrors && <AlertTriangle className="h-3 w-3 text-destructive" />}
      </div>
      <div className="text-sm text-foreground mt-1">
        {d.maxIterations ? `${d.maxIterations}x` : "Until condition"}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span className="text-amber-400">Body</span>
        <span className="text-status-completed">Done</span>
      </div>
    </div>
  );
}

export const LoopNode = memo(LoopNodeComponent);
