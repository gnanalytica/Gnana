"use client";

import { useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { PipelineView } from "@/components/runs/pipeline-view";
import { PhaseDetail, type PhaseData } from "@/components/runs/phase-detail";
import { ApprovalGate } from "@/components/runs/approval-gate";
import { useRun } from "@/lib/hooks/use-runs";
import { api } from "@/lib/api";
import type { PipelineStage } from "@/types";

// ---------- Status styling ----------

const statusBadgeClasses: Record<string, string> = {
  completed:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  analyzing:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  planning:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  executing:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  awaiting_approval:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  approved:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  queued: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function formatDuration(start: string) {
  const ms = Date.now() - new Date(start).getTime();
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatRelativeTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr ago`;
}

// Build phases from a run object
function buildPhases(run: {
  status: PipelineStage;
  triggerType: string;
  triggerData: Record<string, unknown>;
  analysis?: unknown;
  plan?: unknown;
  inputTokens: number;
  outputTokens: number;
}): PhaseData[] {
  const allStages: Array<{
    id: string;
    label: string;
    stageKey: PipelineStage;
  }> = [
    { id: "trigger", label: "Trigger", stageKey: "queued" },
    { id: "analyzing", label: "Analysis", stageKey: "analyzing" },
    { id: "planning", label: "Planning", stageKey: "planning" },
    {
      id: "awaiting_approval",
      label: "Approval",
      stageKey: "awaiting_approval",
    },
    { id: "executing", label: "Execution", stageKey: "executing" },
    { id: "completed", label: "Complete", stageKey: "completed" },
  ];

  const stageOrder: PipelineStage[] = [
    "queued",
    "analyzing",
    "planning",
    "awaiting_approval",
    "approved",
    "executing",
    "completed",
  ];

  const currentIndex = stageOrder.indexOf(run.status);

  return allStages.map((stage) => {
    const stageIdx = stageOrder.indexOf(stage.stageKey);
    let status: PhaseData["status"];
    if (stageIdx < currentIndex) {
      status = "completed";
    } else if (stageIdx === currentIndex) {
      status = "active";
    } else {
      status = "pending";
    }

    // Handle failed/rejected as final states
    if (run.status === "failed" || run.status === "rejected") {
      if (stageIdx <= currentIndex) {
        status = "completed";
      } else {
        status = "pending";
      }
    }

    return {
      id: stage.id,
      label: stage.label,
      status,
    };
  });
}

// ---------- Component ----------

export default function RunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const phaseRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [openPhases, setOpenPhases] = useState<Set<string>>(
    new Set(["analyzing", "awaiting_approval"]),
  );
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const runId = params.id as string;
  const { run, isLoading, error } = useRun(runId);

  function togglePhase(phaseId: string) {
    setOpenPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }
      return next;
    });
  }

  function handlePhaseClick(phaseId: string) {
    setOpenPhases((prev) => {
      const next = new Set(prev);
      next.add(phaseId);
      return next;
    });

    setTimeout(() => {
      const el = phaseRefs.current[phaseId];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  }

  async function handleApprove(modifications?: string) {
    try {
      setApprovalError(null);
      await api.runs.approve(runId, modifications);
      // Reload the page to see updated status
      window.location.reload();
    } catch (err) {
      setApprovalError(
        err instanceof Error ? err.message : "Failed to approve run"
      );
    }
  }

  async function handleReject(reason?: string) {
    try {
      setApprovalError(null);
      await api.runs.reject(runId, { reason });
      // Reload the page to see updated status
      window.location.reload();
    } catch (err) {
      setApprovalError(
        err instanceof Error ? err.message : "Failed to reject run"
      );
    }
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/runs")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Runs
        </Button>
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-destructive">
                Cannot connect to server
              </p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/runs")}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Runs
        </Button>
        <h1 className="text-2xl font-bold">Run not found</h1>
        <p className="text-muted-foreground mt-2">
          No run with ID &ldquo;{runId}&rdquo; exists.
        </p>
      </div>
    );
  }

  const phases = buildPhases(run);

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      {/* Back button + Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/runs")}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Runs
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">Run {runId}</h1>
          <Badge variant="outline" className="text-xs">
            {run.agentId}
          </Badge>
          <Badge
            variant="secondary"
            className={cn(
              "border-0 text-xs capitalize",
              statusBadgeClasses[run.status],
            )}
          >
            {run.status.replace(/_/g, " ")}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Started {formatRelativeTime(run.createdAt)}
          </span>
          <span className="text-xs text-muted-foreground">
            Duration: {formatDuration(run.createdAt)}
          </span>
        </div>
      </div>

      <Separator />

      {/* Pipeline visualization */}
      <PipelineView status={run.status} onPhaseClick={handlePhaseClick} />

      <Separator />

      {/* Approval gate (shown prominently when awaiting approval) */}
      {run.status === "awaiting_approval" && run.plan && (
        <>
          <ApprovalGate
            plan={run.plan}
            onApprove={handleApprove}
            onReject={handleReject}
          />
          {approvalError && (
            <p className="text-sm text-destructive">{approvalError}</p>
          )}
        </>
      )}

      {/* Phase details */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Phase Details</h2>
        <div className="space-y-2">
          {phases.map((phase) => (
            <div
              key={phase.id}
              ref={(el) => {
                phaseRefs.current[phase.id] = el;
              }}
            >
              <PhaseDetail
                phase={phase}
                isOpen={openPhases.has(phase.id)}
                onToggle={() => togglePhase(phase.id)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
