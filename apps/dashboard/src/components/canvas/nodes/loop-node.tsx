"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Repeat } from "lucide-react";

function LoopNodeComponent({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  return (
    <div className="bg-card border-2 border-amber-400 rounded-lg p-4 min-w-[150px] shadow-md">
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
