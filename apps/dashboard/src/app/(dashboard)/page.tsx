import Link from "next/link";
import { Bot, Play, Clock, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PipelineStage } from "@/types";

// Placeholder data
const stats = {
  activeAgents: 4,
  runsToday: 12,
  awaitingApproval: 2,
};

const recentRuns: Array<{
  id: string;
  agentName: string;
  status: PipelineStage;
  triggerType: string;
  timeAgo: string;
}> = [
  {
    id: "run-1",
    agentName: "Weekly Report Agent",
    status: "completed",
    triggerType: "cron",
    timeAgo: "5 minutes ago",
  },
  {
    id: "run-2",
    agentName: "Slack Summarizer",
    status: "executing",
    triggerType: "webhook",
    timeAgo: "12 minutes ago",
  },
  {
    id: "run-3",
    agentName: "Code Review Agent",
    status: "awaiting_approval",
    triggerType: "manual",
    timeAgo: "1 hour ago",
  },
  {
    id: "run-4",
    agentName: "Data Pipeline Monitor",
    status: "failed",
    triggerType: "cron",
    timeAgo: "2 hours ago",
  },
  {
    id: "run-5",
    agentName: "Email Drafter",
    status: "queued",
    triggerType: "manual",
    timeAgo: "3 hours ago",
  },
];

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
  completed:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  analyzing:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  planning: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  executing:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  awaiting_approval:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  queued: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  approved:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

export default function DashboardHome() {
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
            <div className="text-3xl font-bold">{stats.activeAgents}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Runs Today
            </CardTitle>
            <Play className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.runsToday}</div>
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
              {stats.awaitingApproval}
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
            <div className="divide-y divide-border">
              {recentRuns.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center gap-4 px-6 py-4"
                >
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full shrink-0",
                      statusColors[run.status]
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {run.agentName}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "border-0 text-xs",
                      statusBadgeClasses[run.status]
                    )}
                  >
                    {run.status.replace("_", " ")}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {run.triggerType}
                  </Badge>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {run.timeAgo}
                  </span>
                </div>
              ))}
            </div>
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
