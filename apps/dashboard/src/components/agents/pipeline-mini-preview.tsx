"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, GitBranch } from "lucide-react";
import type { PipelineSpec } from "@/types/pipeline";

interface PipelineMiniPreviewProps {
  spec: PipelineSpec;
  onOpenCanvas: () => void;
}

const NODE_W = 80;
const NODE_H = 36;
const GAP_X = 40;
const GAP_Y = 16;
const PAD = 16;
const MAX_PER_ROW = 4;

const TYPE_COLORS: Record<string, string> = {
  trigger: "#3b82f6",
  llm: "#a855f7",
  tool: "#22c55e",
  humanGate: "#f97316",
  condition: "#eab308",
  output: "#6b7280",
  loop: "#06b6d4",
  parallel: "#ec4899",
  merge: "#8b5cf6",
  transform: "#14b8a6",
  group: "#64748b",
};

interface LayoutNode {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  depth: number;
}

function layoutNodes(spec: PipelineSpec) {
  const { nodes, edges } = spec;
  if (nodes.length === 0) return { laid: [] as LayoutNode[], width: 0, height: 0 };

  // Build adjacency from edges
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const n of nodes) {
    adj.set(n.id, []);
    inDeg.set(n.id, 0);
  }
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }

  // BFS from roots (in-degree 0), fall back to first node
  const roots = nodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0);
  if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0]!);

  const visited = new Set<string>();
  const depthMap = new Map<string, number>();
  const queue: { id: string; depth: number }[] = [];

  for (const r of roots) {
    queue.push({ id: r.id, depth: 0 });
    visited.add(r.id);
    depthMap.set(r.id, 0);
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const children = adj.get(cur.id) ?? [];
    for (const child of children) {
      if (!visited.has(child)) {
        visited.add(child);
        depthMap.set(child, cur.depth + 1);
        queue.push({ id: child, depth: cur.depth + 1 });
      }
    }
  }

  // Add any unvisited nodes
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      depthMap.set(n.id, (depthMap.size > 0 ? Math.max(...depthMap.values()) + 1 : 0));
    }
  }

  // Group by depth
  const byDepth = new Map<number, typeof nodes>();
  for (const n of nodes) {
    const d = depthMap.get(n.id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(n);
  }

  // If total columns exceed MAX_PER_ROW, wrap depths into virtual rows
  const maxDepth = Math.max(...byDepth.keys(), 0);
  const laid: LayoutNode[] = [];
  let maxX = 0;
  let maxY = 0;

  for (let d = 0; d <= maxDepth; d++) {
    const group = byDepth.get(d) ?? [];
    const col = d % MAX_PER_ROW;
    const wrapRow = Math.floor(d / MAX_PER_ROW);

    for (let i = 0; i < group.length; i++) {
      const n = group[i]!;
      const x = PAD + col * (NODE_W + GAP_X);
      const maxInDepth = Math.max(...[...byDepth.values()].map((g) => g.length));
      const rowOffset = wrapRow * (maxInDepth * (NODE_H + GAP_Y) + GAP_Y * 2);
      const y = PAD + rowOffset + i * (NODE_H + GAP_Y);
      laid.push({
        id: n.id,
        type: n.type,
        label: (n.data?.label as string) ?? (n.data?.name as string) ?? n.type ?? "node",
        x,
        y,
        depth: d,
      });
      maxX = Math.max(maxX, x + NODE_W);
      maxY = Math.max(maxY, y + NODE_H);
    }
  }

  return { laid, width: maxX + PAD, height: maxY + PAD };
}

export function PipelineMiniPreview({ spec, onOpenCanvas }: PipelineMiniPreviewProps) {
  const { laid, width, height } = useMemo(() => layoutNodes(spec), [spec]);
  const posMap = useMemo(() => {
    const m = new Map<string, LayoutNode>();
    for (const n of laid) m.set(n.id, n);
    return m;
  }, [laid]);

  const svgW = Math.max(width, 200);
  const svgH = Math.max(height, 60);

  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Pipeline Preview</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
            {spec.nodes.length} nodes
          </Badge>
        </div>
      </div>

      {/* SVG diagram */}
      <div className="overflow-x-auto p-2" style={{ maxHeight: 220 }}>
        <svg
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="block"
        >
          {/* Edges */}
          {spec.edges.map((e, i) => {
            const src = posMap.get(e.source);
            const tgt = posMap.get(e.target);
            if (!src || !tgt) return null;
            const x1 = src.x + NODE_W;
            const y1 = src.y + NODE_H / 2;
            const x2 = tgt.x;
            const y2 = tgt.y + NODE_H / 2;
            // Simple bezier curve
            const midX = (x1 + x2) / 2;
            return (
              <g key={`edge-${i}`}>
                <path
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="currentColor"
                  className="text-muted-foreground/40"
                  strokeWidth={1.5}
                />
                {/* Arrow head */}
                <polygon
                  points={`${x2},${y2} ${x2 - 5},${y2 - 3} ${x2 - 5},${y2 + 3}`}
                  fill="currentColor"
                  className="text-muted-foreground/40"
                />
              </g>
            );
          })}

          {/* Nodes */}
          {laid.map((n, i) => {
            const color = TYPE_COLORS[n.type] ?? "#6b7280";
            return (
              <g
                key={n.id}
                className="transition-opacity duration-300"
                style={{
                  opacity: 1,
                  animation: `fadeIn 300ms ${i * 60}ms both`,
                }}
              >
                <rect
                  x={n.x}
                  y={n.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  ry={6}
                  fill="var(--background, #fff)"
                  stroke={color}
                  strokeWidth={1.5}
                />
                {/* Colored left accent */}
                <rect
                  x={n.x}
                  y={n.y}
                  width={4}
                  height={NODE_H}
                  rx={2}
                  fill={color}
                />
                <text
                  x={n.x + NODE_W / 2 + 2}
                  y={n.y + NODE_H / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-foreground"
                  fontSize={9}
                  fontFamily="inherit"
                >
                  {(n.label ?? "").length > 10 ? (n.label ?? "").slice(0, 9) + "\u2026" : n.label ?? ""}
                </text>
              </g>
            );
          })}

          {/* Keyframe animation definition */}
          <defs>
            <style>{`
              @keyframes fadeIn {
                from { opacity: 0; transform: translateY(4px); }
                to { opacity: 1; transform: translateY(0); }
              }
            `}</style>
          </defs>
        </svg>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t">
        <Button size="sm" className="w-full gap-2 h-7 text-xs" onClick={onOpenCanvas}>
          Open in Canvas
          <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
