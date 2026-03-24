"use client";

import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw, SkipForward } from "lucide-react";

interface ExecutionToolbarProps {
  isRunning: boolean;
  isPaused: boolean;
  step: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onStep: () => void;
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
}: ExecutionToolbarProps) {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-card border border-border rounded-lg shadow-lg px-2 py-1.5">
      {!isRunning ? (
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onStart} title="Start preview">
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
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onStep}
        title="Step forward"
      >
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
      {isRunning && (
        <span className="text-xs text-muted-foreground px-1">
          Step {step + 1}
        </span>
      )}
    </div>
  );
}
