"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

function CustomEdgeComponent({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
  label,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isAnimating = (data as Record<string, unknown>)?._executing === true;
  const dataType = (data as Record<string, unknown>)?.dataType as string | undefined;
  const displayLabel = label ?? dataType;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          ...(isAnimating
            ? {
                strokeDasharray: "5 5",
                animation: "edge-flow 0.5s linear infinite",
              }
            : {}),
        }}
      />
      {displayLabel && (
        <EdgeLabelRenderer>
          <div
            className="absolute bg-background border border-border rounded-full px-2 py-0.5 text-[10px] font-medium text-muted-foreground pointer-events-none"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            {displayLabel}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const CustomEdge = memo(CustomEdgeComponent);
