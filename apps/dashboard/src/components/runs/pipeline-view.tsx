"use client";

import {
  Zap,
  Search,
  ListChecks,
  ShieldCheck,
  Play,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineStage } from "@/types";

interface PipelinePhase {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  activeColor: string;
  completedBg: string;
}

const phases: PipelinePhase[] = [
  {
    id: "trigger",
    label: "Trigger",
    icon: Zap,
    color: "text-purple-500",
    activeColor: "border-purple-500 bg-purple-50 dark:bg-purple-950/30",
    completedBg: "bg-purple-500",
  },
  {
    id: "analyzing",
    label: "Analyze",
    icon: Search,
    color: "text-blue-500",
    activeColor: "border-blue-500 bg-blue-50 dark:bg-blue-950/30",
    completedBg: "bg-blue-500",
  },
  {
    id: "planning",
    label: "Plan",
    icon: ListChecks,
    color: "text-green-500",
    activeColor: "border-green-500 bg-green-50 dark:bg-green-950/30",
    completedBg: "bg-green-500",
  },
  {
    id: "awaiting_approval",
    label: "Approval",
    icon: ShieldCheck,
    color: "text-amber-500",
    activeColor: "border-amber-500 bg-amber-50 dark:bg-amber-950/30",
    completedBg: "bg-amber-500",
  },
  {
    id: "executing",
    label: "Execute",
    icon: Play,
    color: "text-pink-500",
    activeColor: "border-pink-500 bg-pink-50 dark:bg-pink-950/30",
    completedBg: "bg-pink-500",
  },
  {
    id: "completed",
    label: "Complete",
    icon: CheckCircle2,
    color: "text-green-500",
    activeColor: "border-green-500 bg-green-50 dark:bg-green-950/30",
    completedBg: "bg-green-500",
  },
];

// Map pipeline stage to the index of the *active* phase
function getPhaseIndex(status: PipelineStage): number {
  switch (status) {
    case "queued":
      return -1; // nothing active yet
    case "analyzing":
      return 1;
    case "planning":
      return 2;
    case "awaiting_approval":
    case "approved":
      return 3;
    case "executing":
      return 4;
    case "completed":
      return 5;
    case "failed":
    case "rejected":
      return -2; // special handling
    default:
      return -1;
  }
}

// Determine which phase failed for failed/rejected status
function getFailedPhaseIndex(status: PipelineStage): number {
  switch (status) {
    case "rejected":
      return 3; // approval phase
    case "failed":
      return 4; // execution phase
    default:
      return -1;
  }
}

interface PipelineViewProps {
  status: PipelineStage;
  onPhaseClick: (phase: string) => void;
}

export function PipelineView({ status, onPhaseClick }: PipelineViewProps) {
  const activeIndex = getPhaseIndex(status);
  const failedIndex = getFailedPhaseIndex(status);

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-center justify-between min-w-[600px] px-4 py-6">
        {phases.map((phase, i) => {
          const isCompleted =
            activeIndex >= 0 ? i < activeIndex : i < (failedIndex >= 0 ? failedIndex : 0);
          // Trigger is always "completed" unless queued
          const isTriggerDone = phase.id === "trigger" && status !== "queued";
          const isPhaseCompleted = isCompleted || isTriggerDone;
          const isActive = activeIndex === i;
          const isFailed = failedIndex === i;
          const isPending = !isPhaseCompleted && !isActive && !isFailed;

          return (
            <div key={phase.id} className="flex items-center flex-1 last:flex-none">
              {/* Phase node */}
              <button
                onClick={() => onPhaseClick(phase.id)}
                className={cn(
                  "relative flex flex-col items-center gap-2 group",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg p-2",
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all",
                    isPhaseCompleted && [
                      "border-transparent",
                      phase.completedBg,
                    ],
                    isActive && [phase.activeColor, "border-2"],
                    isFailed && "border-red-500 bg-red-50 dark:bg-red-950/30",
                    isPending && "border-muted-foreground/30 bg-muted/50",
                    isActive && "animate-pulse",
                  )}
                >
                  {isPhaseCompleted ? (
                    <CheckCircle2 className="h-5 w-5 text-white" />
                  ) : isFailed ? (
                    <XCircle className="h-5 w-5 text-red-500" />
                  ) : (
                    <phase.icon
                      className={cn(
                        "h-5 w-5",
                        isActive ? phase.color : "text-muted-foreground/50",
                      )}
                    />
                  )}
                </div>
                <span
                  className={cn(
                    "text-xs font-medium whitespace-nowrap",
                    isPhaseCompleted && "text-foreground",
                    isActive && phase.color,
                    isFailed && "text-red-500",
                    isPending && "text-muted-foreground/50",
                  )}
                >
                  {phase.label}
                </span>
              </button>

              {/* Connector line (not after last) */}
              {i < phases.length - 1 && (
                <div className="flex-1 mx-1">
                  <div
                    className={cn(
                      "h-0.5 w-full rounded-full transition-colors",
                      isPhaseCompleted || isTriggerDone
                        ? "bg-primary/40"
                        : "bg-muted-foreground/20",
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
