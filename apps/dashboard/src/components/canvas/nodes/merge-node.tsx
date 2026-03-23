"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Combine } from "lucide-react";

function MergeNodeComponent({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  const inputCount = typeof d.inputs === "number" ? d.inputs : 2;
  return (
    <div className="bg-card border-2 border-teal-400 rounded-lg p-4 min-w-[150px] shadow-md">
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
      </div>
      <div className="text-sm text-foreground mt-1">Wait for {inputCount}</div>
    </div>
  );
}

export const MergeNode = memo(MergeNodeComponent);
