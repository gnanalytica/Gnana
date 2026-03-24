"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Bot, Play, Clock, Plus, AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAgents } from "@/lib/hooks/use-agents";
import { useRuns } from "@/lib/hooks/use-runs";

const statusColors: Record<string, string> = {
  completed: "bg-green-500",
  failed: "bg-red-500",
  analyzing: "bg-blue-500",
  planning: "bg-blue-500",
  executing: "bg-blue-500",
  awaiting_approval: "bg-amber-500",
  queued: "bg-gray-400",
  approved: "bg-green-400",
  rejected: "bg-red-400",
};

const statusBadgeClasses: Record<string, string> = {
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  analyzing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  planning: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  executing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  awaiting_approval: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  queued: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

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

export default function DashboardHome() {
  const { agents, isLoading: agentsLoading, error: agentsError, refetch: refetchAgents } = useAgents();
  const { runs, isLoading: runsLoading, error: runsError, refetch: refetchRuns } = useRuns();

  const isLoading = agentsLoading || runsLoading;
  const connectionError = agentsError || runsError;

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const runsToday = runs.filter((r) => new Date(r.createdAt) >= today).length;
    const awaitingApproval = runs.filter((r) => r.status === "awaiting_approval").length;

    return {
      activeAgents: agents.length,
      runsToday,
      awaitingApproval,
    };
  }, [agents, runs]);

  const recentRuns = useMemo(() => {
    return [...runs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [runs]);

  if (connectionError) {
    return (
      <div className="p-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold">Welcome to Gnana</h1>
          <p className="text-muted-foreground mt-1">
            AI Agent Dashboard — build, manage, and monitor agents.
          </p>
        </div>
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-destructive">Cannot connect to server</p>
              <p className="text-sm text-muted-foreground">
                Make sure the Gnana server is running at{" "}
                {process.env.NEXT_PUBLIC_GNANA_API_URL ?? "http://localhost:4000"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetchAgents();
                refetchRuns();
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Welcome to Gnana</h1>
        <p className="text-muted-foreground mt-1">
          AI Agent Dashboard — build, manage, and monitor agents.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Agents
            </CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {isLoading ? <Skeleton className="h-8 w-16" /> : stats.activeAgents}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Runs Today</CardTitle>
            <Play className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {isLoading ? <Skeleton className="h-8 w-16" /> : stats.runsToday}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Awaiting Approval
            </CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-500">
              {isLoading ? <Skeleton className="h-8 w-16" /> : stats.awaitingApproval}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Runs */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Runs</h2>
          <Link
            href="/runs"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            View All
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="divide-y divide-border">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-6 py-4">
                    <Skeleton className="h-2.5 w-2.5 rounded-full" />
                    <div className="flex-1 min-w-0">
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                ))}
              </div>
            ) : recentRuns.length === 0 ? (
              <div className="px-6 py-8 text-center text-muted-foreground">No recent runs</div>
            ) : (
              <div className="divide-y divide-border">
                {recentRuns.map((run) => (
                  <Link
                    key={run.id}
                    href={`/runs/${run.id}`}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-muted/50 transition-colors"
                  >
                    <span
                      className={cn("h-2.5 w-2.5 rounded-full shrink-0", statusColors[run.status])}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{run.agentId}</p>
                    </div>
                    <Badge
                      variant="secondary"
                      className={cn("border-0 text-xs", statusBadgeClasses[run.status])}
                    >
                      {run.status.replace(/_/g, " ")}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {run.triggerType}
                    </Badge>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatRelativeTime(run.createdAt)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <Button asChild>
          <Link href="/agents/new">
            <Plus className="h-4 w-4" />
            Create Agent
          </Link>
        </Button>
      </div>
    </div>
  );
}
