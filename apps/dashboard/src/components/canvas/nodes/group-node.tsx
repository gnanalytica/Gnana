"use client";
import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { Group } from "lucide-react";

function GroupNodeComponent({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  const label = (d.label as string) ?? "Group";
  const childCount = (d.childCount as number) ?? 0;

  return (
    <div className="bg-muted/30 border-2 border-dashed border-muted-foreground/30 rounded-xl min-w-[300px] min-h-[200px] p-2">
      <div className="flex items-center gap-2 px-2 py-1 bg-card/80 rounded-md w-fit border border-border">
        <Group className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        {childCount > 0 && (
          <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">
            {childCount} nodes
          </span>
        )}
      </div>
    </div>
  );
}

export const GroupNode = memo(GroupNodeComponent);
