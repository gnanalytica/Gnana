"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Wrench } from "lucide-react";

function ToolNodeComponent({ data }: NodeProps) {
  const d = data as any;
  return (
    <div className="bg-card border-2 border-muted rounded-lg p-4 min-w-[140px] shadow-md">
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs uppercase font-semibold text-muted-foreground">Tool</span>
      </div>
      <div className="text-sm text-foreground mt-1">{d.name ?? "Unnamed"}</div>
      {d.description && <div className="text-xs text-muted-foreground mt-0.5">{d.description}</div>}
    </div>
  );
}

export const ToolNode = memo(ToolNodeComponent);
