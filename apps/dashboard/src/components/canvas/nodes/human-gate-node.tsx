"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ShieldCheck, AlertTriangle } from "lucide-react";

function HumanGateNodeComponent({ data }: NodeProps) {
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
      className={`bg-card border-2 rounded-lg p-4 min-w-[140px] shadow-md transition-all ${
        hasErrors ? "border-destructive" : "border-phase-approve"
      } ${isExecuting ? "ring-2 ring-blue-500 animate-pulse" : ""} ${isCompleted ? "ring-2 ring-green-500/50" : ""} ${isFailed ? "ring-2 ring-red-500" : ""} ${isExecuted ? "opacity-70" : ""} ${isDryRunExecuted ? "ring-2 ring-green-500 !border-green-500" : ""} ${isDryRunSkipped ? "opacity-40" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-phase-approve" />
      <Handle type="source" position={Position.Right} className="!bg-phase-approve" />
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-phase-approve" />
        <span className="text-xs uppercase font-semibold text-phase-approve">Approval Gate</span>
        {hasErrors && <AlertTriangle className="h-3 w-3 text-destructive" />}
      </div>
      <div className="text-sm text-foreground mt-1">{(d.approval as string) ?? "required"}</div>
    </div>
  );
}

export const HumanGateNode = memo(HumanGateNodeComponent);
