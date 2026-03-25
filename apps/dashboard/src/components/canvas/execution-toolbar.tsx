"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw, SkipForward, Eye, EyeOff, Loader2 } from "lucide-react";
import { useDryRun } from "@/lib/canvas/use-dry-run";
import type { NodeSpec, EdgeSpec } from "@/types/pipeline";

interface ExecutionToolbarProps {
  isRunning: boolean;
  isPaused: boolean;
  step: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onStep: () => void;
  /** Current pipeline nodes — required for dry-run preview */
  nodes?: NodeSpec[];
  /** Current pipeline edges — required for dry-run preview */
  edges?: EdgeSpec[];
  /** Called when preview results arrive so the canvas can highlight nodes */
  onPreviewChange?: (executedNodeIds: Set<string> | null) => void;
}

export function ExecutionToolbar({
  isRunning,
  isPaused,
  step,
  onStart,
  onPause,
  onResume,
  onReset,
  onStep,
  nodes = [],
  edges = [],
  onPreviewChange,
}: ExecutionToolbarProps) {
  const { preview, isLoading, runPreview, clearPreview } = useDryRun();

  const warningCount = preview?.warnings.length ?? 0;

  // Notify parent whenever preview changes
  useEffect(() => {
    if (!onPreviewChange) return;
    if (preview) {
      onPreviewChange(new Set(preview.executionOrder));
    } else {
      onPreviewChange(null);
    }
  }, [preview, onPreviewChange]);

  const handleRunPreview = () => {
    void runPreview(nodes, edges);
  };

  const handleClearPreview = () => {
    clearPreview();
  };

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-card border border-border rounded-lg shadow-lg px-2 py-1.5">
      {/* Execution playback controls */}
      {!isRunning ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onStart}
          title="Start preview"
        >
          <Play className="h-3.5 w-3.5" />
        </Button>
      ) : isPaused ? (
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onResume} title="Resume">
          <Play className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPause} title="Pause">
          <Pause className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onStep} title="Step forward">
        <SkipForward className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onReset}
        disabled={!isRunning && step === 0}
        title="Reset"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>

      {isRunning && <span className="text-xs text-muted-foreground px-1">Step {step + 1}</span>}

      {/* Divider */}
      <div className="w-px h-4 bg-border mx-0.5" />

      {/* Dry-run preview controls */}
      {preview ? (
        <>
          {/* Warning badge */}
          {warningCount > 0 && (
            <span
              className="flex items-center justify-center h-4 min-w-4 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1 leading-none"
              title={`${warningCount} warning${warningCount > 1 ? "s" : ""}`}
            >
              {warningCount}
            </span>
          )}
          {/* Execution order summary */}
          <span className="text-xs text-muted-foreground px-1">
            {preview.executionOrder.length} node{preview.executionOrder.length !== 1 ? "s" : ""}
          </span>
          {/* Clear preview */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleClearPreview}
            title="Clear preview"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleRunPreview}
          disabled={isLoading || nodes.length === 0}
          title="Dry-run preview"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}
