"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Run } from "@/types";
import type { RunFilters } from "./run-filters";

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

function formatRelativeTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(start: string, end?: string) {
  const endTime = end ? new Date(end).getTime() : Date.now();
  const ms = endTime - new Date(start).getTime();
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins === 0 && secs === 0) return "--";
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

interface RunListProps {
  filters: RunFilters;
  runs?: Run[];
  isLoading?: boolean;
}

export function RunList({ filters, runs = [], isLoading = false }: RunListProps) {
  const router = useRouter();
  const [visibleCount, setVisibleCount] = useState(5);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  const filteredRuns = runs.filter((run) => {
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
            {runs.length === 0
              ? "No runs yet."
              : "No runs match the current filters."}
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
            {visibleRuns.map((run) => {
              const totalTokens = run.inputTokens + run.outputTokens;
              return (
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
                      {run.agentId}
                    </p>
                    <p className="text-xs text-muted-foreground sm:hidden">
                      {formatRelativeTime(run.createdAt)}
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
                    {formatRelativeTime(run.createdAt)}
                  </span>
                  <span className="hidden sm:inline text-xs text-muted-foreground whitespace-nowrap">
                    {formatDuration(run.createdAt, run.updatedAt)}
                  </span>
                  <span className="hidden sm:inline text-xs text-muted-foreground whitespace-nowrap text-right tabular-nums">
                    {totalTokens > 0 ? totalTokens.toLocaleString() : "--"}
                  </span>
                </div>
              );
            })}
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
