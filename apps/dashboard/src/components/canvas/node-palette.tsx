"use client";

import { type DragEvent, useCallback } from "react";
import {
  Brain,
  Wrench,
  ShieldCheck,
  GitBranch,
  Repeat,
  GitFork,
  Combine,
  ArrowRightLeft,
} from "lucide-react";
import type { PipelineNodeType } from "@/types/pipeline";

interface PaletteItem {
  type: PipelineNodeType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  { type: "llm", label: "LLM", icon: Brain, shortcut: "L" },
  { type: "tool", label: "Tool", icon: Wrench, shortcut: "T" },
  { type: "humanGate", label: "Gate", icon: ShieldCheck, shortcut: "G" },
  { type: "condition", label: "Branch", icon: GitBranch, shortcut: "B" },
  { type: "loop", label: "Loop", icon: Repeat, shortcut: "O" },
  { type: "parallel", label: "Parallel", icon: GitFork, shortcut: "P" },
  { type: "merge", label: "Merge", icon: Combine, shortcut: "M" },
  { type: "transform", label: "Transform", icon: ArrowRightLeft, shortcut: "X" },
];

interface NodePaletteProps {
  onAddNode: (type: PipelineNodeType) => void;
}

export function NodePalette({ onAddNode }: NodePaletteProps) {
  const onDragStart = useCallback((e: DragEvent<HTMLButtonElement>, type: PipelineNodeType) => {
    e.dataTransfer.setData("application/reactflow-nodetype", type);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-card border border-border rounded-lg shadow-lg px-2 py-1.5">
      {PALETTE_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.type}
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
            onDoubleClick={() => onAddNode(item.type)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-grab active:cursor-grabbing"
            title={`${item.label} (${item.shortcut})`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Keyboard shortcut map: key → node type */
export const NODE_SHORTCUTS: Record<string, PipelineNodeType> = Object.fromEntries(
  PALETTE_ITEMS.map((i) => [i.shortcut.toLowerCase(), i.type]),
);
