"use client";

import { ChevronDown, ChevronRight, Clock, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StreamingText } from "./streaming-text";
import { ToolCallCard, type ToolCallData } from "./tool-call-card";

export interface PhaseData {
  id: string;
  label: string;
  status: "completed" | "active" | "pending" | "failed";
  llmOutput?: string;
  isStreaming?: boolean;
  toolCalls?: ToolCallData[];
  inputTokens?: number;
  outputTokens?: number;
  duration?: string;
}

interface PhaseDetailProps {
  phase: PhaseData;
  isOpen: boolean;
  onToggle: () => void;
}

export function PhaseDetail({ phase, isOpen, onToggle }: PhaseDetailProps) {
  const isPending = phase.status === "pending";

  return (
    <div
      className={cn(
        "border rounded-lg overflow-hidden transition-colors",
        phase.status === "active" && "border-primary/50",
        phase.status === "failed" && "border-red-500/50",
        isPending && "opacity-50",
      )}
    >
      <button
        onClick={onToggle}
        disabled={isPending}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
          !isPending && "hover:bg-muted/50",
          isPending && "cursor-not-allowed",
        )}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-medium flex-1">{phase.label}</span>
        <Badge
          variant="secondary"
          className={cn(
            "border-0 text-xs capitalize",
            phase.status === "completed" &&
              "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
            phase.status === "active" &&
              "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
            phase.status === "failed" &&
              "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
            phase.status === "pending" &&
              "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
          )}
        >
          {phase.status}
        </Badge>
      </button>

      {isOpen && !isPending && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          {/* LLM Output */}
          {phase.llmOutput && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                LLM Output
              </h4>
              <StreamingText
                text={phase.llmOutput}
                isStreaming={phase.isStreaming}
              />
            </div>
          )}

          {/* Tool Calls */}
          {phase.toolCalls && phase.toolCalls.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Tool Calls
              </h4>
              <div className="space-y-2">
                {phase.toolCalls.map((tc) => (
                  <ToolCallCard key={tc.id} toolCall={tc} />
                ))}
              </div>
            </div>
          )}

          {/* Stats row */}
          {(phase.inputTokens != null ||
            phase.outputTokens != null ||
            phase.duration) && (
            <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-border">
              {phase.inputTokens != null && phase.outputTokens != null && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Cpu className="h-3.5 w-3.5" />
                  <span className="tabular-nums">
                    {phase.inputTokens.toLocaleString()} in /{" "}
                    {phase.outputTokens.toLocaleString()} out
                  </span>
                </div>
              )}
              {phase.duration && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{phase.duration}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
