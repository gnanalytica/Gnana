"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ArrowRightLeft } from "lucide-react";

function TransformNodeComponent({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  return (
    <div className="bg-card border-2 border-orange-400 rounded-lg p-4 min-w-[150px] shadow-md">
      <Handle type="target" position={Position.Left} className="!bg-orange-400" />
      <Handle type="source" position={Position.Right} className="!bg-orange-400" />
      <div className="flex items-center gap-2">
        <ArrowRightLeft className="h-4 w-4 text-orange-400" />
        <span className="text-xs uppercase font-semibold text-orange-400">Transform</span>
      </div>
      <div className="text-sm text-foreground mt-1">
        {typeof d.expression === "string" ? d.expression : "Map data"}
      </div>
    </div>
  );
}

export const TransformNode = memo(TransformNodeComponent);
