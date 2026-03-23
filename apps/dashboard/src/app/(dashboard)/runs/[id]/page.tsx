"use client";

import { useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { PipelineView } from "@/components/runs/pipeline-view";
import { PhaseDetail, type PhaseData } from "@/components/runs/phase-detail";
import { ApprovalGate } from "@/components/runs/approval-gate";
import type { PipelineStage, Plan } from "@/types";
import type { ToolCallData } from "@/components/runs/tool-call-card";

// ---------- Mock data ----------

const mockPlan: Plan = {
  summary: "Generate Q1 sales report with risk analysis",
  steps: [
    {
      order: 1,
      title: "Query sales database",
      description: "Pull Q1 revenue data",
    },
    {
      order: 2,
      title: "Identify trends",
      description: "Compare with Q4 and Q1 last year",
    },
    {
      order: 3,
      title: "Risk assessment",
      description: "Flag at-risk accounts",
    },
    {
      order: 4,
      title: "Generate report",
      description: "Create formatted PDF report",
    },
  ],
};

const mockToolCalls: ToolCallData[] = [
  {
    id: "tc-1",
    name: "query_database",
    status: "completed",
    duration: "230ms",
    input: { query: "SELECT * FROM sales WHERE quarter = 'Q1'" },
    output: { rows: 1284, status: "ok" },
  },
  {
    id: "tc-2",
    name: "calculate_metrics",
    status: "completed",
    duration: "85ms",
    input: { metrics: ["revenue", "churn", "growth"] },
    output: { revenue: 2400000, churn: 3.2, growth: 12 },
  },
];

const mockRun = {
  id: "run-abc123",
  agentId: "agent-1",
  agentName: "Weekly Report Agent",
  status: "awaiting_approval" as PipelineStage,
  triggerType: "manual",
  triggerData: { context: "Analyze Q1 sales data" },
  analysis: {
    findings: [
      "Revenue up 12%",
      "3 at-risk accounts identified",
      "Churn rate decreased",
    ],
  },
  plan: mockPlan,
  inputTokens: 4520,
  outputTokens: 1830,
  createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockPhases: PhaseData[] = [
  {
    id: "trigger",
    label: "Trigger",
    status: "completed",
    llmOutput: "Run triggered manually.\nContext: Analyze Q1 sales data",
    inputTokens: 0,
    outputTokens: 0,
    duration: "0s",
  },
  {
    id: "analyzing",
    label: "Analysis",
    status: "completed",
    llmOutput:
      "Analyzing the request to generate a Q1 sales report...\n\nFindings:\n- Revenue is up 12% compared to Q4\n- 3 at-risk accounts identified based on declining engagement\n- Overall churn rate decreased by 0.8 percentage points\n- New customer acquisition rate increased by 15%\n\nRecommendation: Proceed with detailed report generation including risk assessment.",
    toolCalls: mockToolCalls,
    inputTokens: 2100,
    outputTokens: 890,
    duration: "24s",
  },
  {
    id: "planning",
    label: "Planning",
    status: "completed",
    llmOutput:
      'Plan generated successfully.\n\nSummary: Generate Q1 sales report with risk analysis\n\nSteps:\n1. Query sales database - Pull Q1 revenue data\n2. Identify trends - Compare with Q4 and Q1 last year\n3. Risk assessment - Flag at-risk accounts\n4. Generate report - Create formatted PDF report\n\nEstimated duration: ~3 minutes\nTools required: query_database, calculate_metrics, generate_pdf',
    inputTokens: 1420,
    outputTokens: 640,
    duration: "18s",
  },
  {
    id: "awaiting_approval",
    label: "Approval",
    status: "active",
    llmOutput: "Plan submitted for human approval. Waiting for response...",
    isStreaming: false,
    inputTokens: 1000,
    outputTokens: 300,
    duration: "2m 12s",
  },
  {
    id: "executing",
    label: "Execution",
    status: "pending",
  },
  {
    id: "completed",
    label: "Complete",
    status: "pending",
  },
];

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

// ---------- Component ----------

export default function RunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const phaseRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [openPhases, setOpenPhases] = useState<Set<string>>(
    new Set(["analyzing", "awaiting_approval"]),
  );

  const run = mockRun;
  const runId = params.id as string;

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
    // Open the phase and scroll to it
    setOpenPhases((prev) => {
      const next = new Set(prev);
      next.add(phaseId);
      return next;
    });

    // Scroll to the phase detail section
    setTimeout(() => {
      const el = phaseRefs.current[phaseId];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  }

  function handleApprove(modifications?: string) {
    // Placeholder: in real app, send API call
    console.log("Approved with modifications:", modifications);
  }

  function handleReject(reason?: string) {
    // Placeholder: in real app, send API call
    console.log("Rejected with reason:", reason);
  }

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
            {run.agentName}
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
        <ApprovalGate
          plan={run.plan}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}

      {/* Phase details */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Phase Details</h2>
        <div className="space-y-2">
          {mockPhases.map((phase) => (
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
