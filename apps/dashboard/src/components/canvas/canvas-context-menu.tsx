"use client";

import {
  Brain,
  Wrench,
  ShieldCheck,
  GitBranch,
  Repeat,
  GitFork,
  Combine,
  ArrowRightLeft,
  Copy,
  Clipboard,
  Trash2,
  LayoutGrid,
  Maximize,
  MousePointer,
  Pencil,
  CopyPlus,
  Group,
  Tag,
} from "lucide-react";
import type { PipelineNodeType } from "@/types/pipeline";

interface ContextMenuState {
  type: "pane" | "node" | "edge";
  x: number;
  y: number;
  nodeId?: string;
  edgeId?: string;
  multiSelected?: boolean;
}

interface CanvasContextMenuProps {
  state: ContextMenuState | null;
  onClose: () => void;
  onAddNode: (type: PipelineNodeType, position: { x: number; y: number }) => void;
  onPaste: () => void;
  onAutoLayout: () => void;
  onSelectAll: () => void;
  onFitView: () => void;
  onEditNode: () => void;
  onDuplicateNode: () => void;
  onCopyNode: () => void;
  onDeleteNode: () => void;
  onGroupNodes: () => void;
  onDeleteEdge: () => void;
  hasClipboard: boolean;
}

const NODE_TYPE_ITEMS: { type: PipelineNodeType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { type: "llm", label: "LLM", icon: Brain },
  { type: "tool", label: "Tool", icon: Wrench },
  { type: "humanGate", label: "Approval Gate", icon: ShieldCheck },
  { type: "condition", label: "Condition", icon: GitBranch },
  { type: "loop", label: "Loop", icon: Repeat },
  { type: "parallel", label: "Parallel", icon: GitFork },
  { type: "merge", label: "Merge", icon: Combine },
  { type: "transform", label: "Transform", icon: ArrowRightLeft },
];

export function CanvasContextMenu({
  state,
  onClose,
  onAddNode,
  onPaste,
  onAutoLayout,
  onSelectAll,
  onFitView,
  onEditNode,
  onDuplicateNode,
  onCopyNode,
  onDeleteNode,
  onGroupNodes,
  onDeleteEdge,
  hasClipboard,
}: CanvasContextMenuProps) {
  if (!state) return null;

  return (
    <div
      className="fixed z-50"
      style={{ left: state.x, top: state.y }}
    >
      <div className="min-w-[180px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
        {state.type === "pane" && (
          <>
            <div>
              <div className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground">
                <span className="flex items-center gap-2">
                  <Brain className="h-3.5 w-3.5" />
                  Add Node
                </span>
              </div>
              <div className="ml-1 pl-2 border-l border-border">
                {NODE_TYPE_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.type}
                      className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        onAddNode(item.type, { x: state.x, y: state.y });
                        onClose();
                      }}
                    >
                      <Icon className="h-3.5 w-3.5 mr-2" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="-mx-1 my-1 h-px bg-border" />
            <button
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              onClick={() => { onPaste(); onClose(); }}
              disabled={!hasClipboard}
            >
              <Clipboard className="h-3.5 w-3.5 mr-2" />
              Paste
              <span className="ml-auto text-xs text-muted-foreground">Ctrl+V</span>
            </button>
            <div className="-mx-1 my-1 h-px bg-border" />
            <button
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => { onAutoLayout(); onClose(); }}
            >
              <LayoutGrid className="h-3.5 w-3.5 mr-2" />
              Auto Layout
            </button>
            <button
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => { onSelectAll(); onClose(); }}
            >
              <MousePointer className="h-3.5 w-3.5 mr-2" />
              Select All
              <span className="ml-auto text-xs text-muted-foreground">Ctrl+A</span>
            </button>
            <button
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => { onFitView(); onClose(); }}
            >
              <Maximize className="h-3.5 w-3.5 mr-2" />
              Fit View
            </button>
          </>
        )}

        {state.type === "node" && (
          <>
            <button
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => { onEditNode(); onClose(); }}
            >
              <Pencil className="h-3.5 w-3.5 mr-2" />
              Edit
            </button>
            <button
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => { onDuplicateNode(); onClose(); }}
            >
              <CopyPlus className="h-3.5 w-3.5 mr-2" />
              Duplicate
              <span className="ml-auto text-xs text-muted-foreground">Ctrl+D</span>
            </button>
            <button
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => { onCopyNode(); onClose(); }}
            >
              <Copy className="h-3.5 w-3.5 mr-2" />
              Copy
              <span className="ml-auto text-xs text-muted-foreground">Ctrl+C</span>
            </button>
            {state.multiSelected && (
              <>
                <div className="-mx-1 my-1 h-px bg-border" />
                <button
                  className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                  onClick={() => { onGroupNodes(); onClose(); }}
                >
                  <Group className="h-3.5 w-3.5 mr-2" />
                  Group
                </button>
              </>
            )}
            <div className="-mx-1 my-1 h-px bg-border" />
            <button
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground text-destructive"
              onClick={() => { onDeleteNode(); onClose(); }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
              <span className="ml-auto text-xs text-muted-foreground">Del</span>
            </button>
          </>
        )}

        {state.type === "edge" && (
          <>
            <button
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => { onDeleteEdge(); onClose(); }}
            >
              <Tag className="h-3.5 w-3.5 mr-2" />
              Add Label
            </button>
            <div className="-mx-1 my-1 h-px bg-border" />
            <button
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground text-destructive"
              onClick={() => { onDeleteEdge(); onClose(); }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete Edge
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export type { ContextMenuState };
