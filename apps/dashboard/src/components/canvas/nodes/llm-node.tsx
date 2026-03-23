"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Brain, ListChecks, Rocket } from "lucide-react";

const phaseConfig = {
  analyze: { icon: Brain, color: "phase-analyze", label: "Analyze" },
  plan: { icon: ListChecks, color: "phase-plan", label: "Plan" },
  execute: { icon: Rocket, color: "phase-execute", label: "Execute" },
} as const;

type Phase = keyof typeof phaseConfig;

function LLMNodeComponent({ data }: NodeProps) {
  const d = data as any;
  const phase: Phase = d.phase ?? "analyze";
  const config = phaseConfig[phase];
  const Icon = config.icon;

  return (
    <div
      className={`bg-card border-2 border-${config.color} rounded-lg p-4 min-w-[160px] shadow-md`}
    >
      <Handle type="target" position={Position.Left} className={`!bg-${config.color}`} />
      <Handle type="source" position={Position.Right} className={`!bg-${config.color}`} />
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 text-${config.color}`} />
        <span className={`text-xs uppercase font-semibold text-${config.color}`}>
          {config.label}
        </span>
      </div>
      <div className="text-sm text-foreground mt-1">{d.model ?? "No model"}</div>
      {d.provider && <div className="text-xs text-muted-foreground">{d.provider}</div>}
      {typeof d.toolCount === "number" && d.toolCount > 0 && (
        <div className="mt-1">
          <span className="text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5">
            {d.toolCount} tool{d.toolCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

export const LLMNode = memo(LLMNodeComponent);
