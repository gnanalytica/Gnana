"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PipelineStage } from "@/types";
import type { RunFilters } from "./run-filters";

interface MockRun {
  id: string;
  agentName: string;
  agentId: string;
  status: PipelineStage;
  triggerType: string;
  startedAgo: string;
  duration: string;
  model: string;
  tokens: number;
}

const mockRuns: MockRun[] = [
  {
    id: "run-abc123",
    agentName: "Weekly Report Agent",
    agentId: "agent-1",
    status: "awaiting_approval",
    triggerType: "manual",
    startedAgo: "2 min ago",
    duration: "1m 42s",
    model: "gpt-4o",
    tokens: 6350,
  },
  {
    id: "run-def456",
    agentName: "Slack Summarizer",
    agentId: "agent-2",
    status: "executing",
    triggerType: "webhook",
    startedAgo: "5 min ago",
    duration: "3m 12s",
    model: "claude-3.5-sonnet",
    tokens: 12480,
  },
  {
    id: "run-ghi789",
    agentName: "Code Review Agent",
    agentId: "agent-3",
    status: "completed",
    triggerType: "webhook",
    startedAgo: "12 min ago",
    duration: "2m 05s",
    model: "gpt-4o",
    tokens: 8920,
  },
  {
    id: "run-jkl012",
    agentName: "Data Pipeline Monitor",
    agentId: "agent-4",
    status: "failed",
    triggerType: "assignment",
    startedAgo: "25 min ago",
    duration: "0m 34s",
    model: "claude-3.5-sonnet",
    tokens: 2100,
  },
  {
    id: "run-mno345",
    agentName: "Weekly Report Agent",
    agentId: "agent-1",
    status: "completed",
    triggerType: "manual",
    startedAgo: "1 hr ago",
    duration: "4m 18s",
    model: "gpt-4o",
    tokens: 15300,
  },
  {
    id: "run-pqr678",
    agentName: "Slack Summarizer",
    agentId: "agent-2",
    status: "analyzing",
    triggerType: "mention",
    startedAgo: "1 hr ago",
    duration: "0m 22s",
    model: "claude-3.5-sonnet",
    tokens: 1840,
  },
  {
    id: "run-stu901",
    agentName: "Code Review Agent",
    agentId: "agent-3",
    status: "planning",
    triggerType: "webhook",
    startedAgo: "2 hr ago",
    duration: "1m 08s",
    model: "gpt-4o",
    tokens: 4520,
  },
  {
    id: "run-vwx234",
    agentName: "Data Pipeline Monitor",
    agentId: "agent-4",
    status: "completed",
    triggerType: "assignment",
    startedAgo: "3 hr ago",
    duration: "5m 42s",
    model: "claude-3.5-sonnet",
    tokens: 18700,
  },
  {
    id: "run-yza567",
    agentName: "Weekly Report Agent",
    agentId: "agent-1",
    status: "queued",
    triggerType: "manual",
    startedAgo: "3 hr ago",
    duration: "--",
    model: "gpt-4o",
    tokens: 0,
  },
  {
    id: "run-bcd890",
    agentName: "Slack Summarizer",
    agentId: "agent-2",
    status: "completed",
    triggerType: "webhook",
    startedAgo: "5 hr ago",
    duration: "2m 55s",
    model: "claude-3.5-sonnet",
    tokens: 9640,
  },
];

const statusDotColors: Record<string, string> = {
  completed: "bg-green-500",
  failed: "bg-red-500",
  analyzing: "bg-blue-500 animate-pulse",
  planning: "bg-blue-500 animate-pulse",
  executing: "bg-blue-500 animate-pulse",
  awaiting_approval: "bg-amber-500",
  approved: "bg-green-400",
  queued: "bg-gray-400",
  rejected: "bg-red-400",
};

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

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

interface RunListProps {
  filters: RunFilters;
}

export function RunList({ filters }: RunListProps) {
  const router = useRouter();
  const [visibleCount, setVisibleCount] = useState(5);

  const filteredRuns = mockRuns.filter((run) => {
    if (filters.status !== "all" && run.status !== filters.status) return false;
    if (filters.agent !== "all" && run.agentId !== filters.agent) return false;
    if (filters.triggerType !== "all" && run.triggerType !== filters.triggerType)
      return false;
    return true;
  });

  const visibleRuns = filteredRuns.slice(0, visibleCount);
  const hasMore = visibleCount < filteredRuns.length;

  if (filteredRuns.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">
            No runs match the current filters.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <Card>
        <CardContent className="p-0">
          {/* Header row */}
          <div className="hidden sm:grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] gap-4 items-center px-6 py-3 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span className="w-2" />
            <span>Agent</span>
            <span>Status</span>
            <span>Trigger</span>
            <span>Started</span>
            <span>Duration</span>
            <span className="text-right">Tokens</span>
          </div>

          <div className="divide-y divide-border">
            {visibleRuns.map((run) => (
              <div
                key={run.id}
                onClick={() => router.push(`/runs/${run.id}`)}
                className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] gap-4 items-center px-6 py-4 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    statusDotColors[run.status],
                  )}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {run.agentName}
                  </p>
                  <p className="text-xs text-muted-foreground sm:hidden">
                    {run.startedAgo}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className={cn(
                    "border-0 text-xs capitalize",
                    statusBadgeClasses[run.status],
                  )}
                >
                  {formatStatus(run.status)}
                </Badge>
                <Badge variant="outline" className="text-xs capitalize">
                  {run.triggerType}
                </Badge>
                <span className="hidden sm:inline text-xs text-muted-foreground whitespace-nowrap">
                  {run.startedAgo}
                </span>
                <span className="hidden sm:inline text-xs text-muted-foreground whitespace-nowrap">
                  {run.duration}
                </span>
                <span className="hidden sm:inline text-xs text-muted-foreground whitespace-nowrap text-right tabular-nums">
                  {run.tokens > 0 ? run.tokens.toLocaleString() : "--"}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((c) => c + 5)}
          >
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
