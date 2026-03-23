"use client";

import { use } from "react";
import Link from "next/link";
import { Pencil, Palette, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type { Agent } from "@/types";

// Placeholder agents map (same data as agents page, keyed by id)
const agentsById: Record<string, Agent> = {
  "agent-1": {
    id: "agent-1",
    name: "Weekly Report Agent",
    description:
      "Generates comprehensive weekly reports from multiple data sources including Jira, GitHub, and Confluence.",
    systemPrompt:
      "You are a reporting assistant. Gather data from configured sources and generate a well-structured weekly summary report.\n\nFollow these steps:\n1. Query Jira for completed tickets this week\n2. Check GitHub for merged PRs and key commits\n3. Review Confluence for updated documentation\n4. Compile findings into a structured report\n5. Post the report to the designated Slack channel",
    toolsConfig: {
      jira_search: { endpoint: "https://company.atlassian.net" },
      github_pulls: { repo: "org/main-repo" },
      confluence_read: { space: "TEAM" },
      slack_post: { channel: "#weekly-reports" },
      markdown_render: {},
    },
    llmConfig: {
      analysis: {
        provider: "anthropic",
        model: "Claude Sonnet",
        maxTokens: 4096,
        temperature: 0.3,
      },
      planning: {
        provider: "anthropic",
        model: "Claude Sonnet",
        maxTokens: 4096,
        temperature: 0.2,
      },
      execution: {
        provider: "anthropic",
        model: "Claude Haiku",
        maxTokens: 2048,
        temperature: 0.1,
      },
    },
    triggersConfig: [
      { type: "cron", config: { schedule: "0 9 * * 1" } },
      { type: "manual" },
    ],
    approval: "auto",
    maxToolRounds: 10,
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-20T00:00:00Z",
  },
  "agent-2": {
    id: "agent-2",
    name: "Slack Summarizer",
    description:
      "Monitors Slack channels and provides daily digests of important discussions and decisions.",
    systemPrompt:
      "You are a Slack summarizer. Read through channel messages and extract key discussions, decisions, and action items.",
    toolsConfig: {
      slack_read: {},
      slack_post: {},
    },
    llmConfig: {
      analysis: { provider: "anthropic", model: "Claude Sonnet" },
      planning: { provider: "anthropic", model: "Claude Haiku" },
    },
    triggersConfig: [{ type: "cron", config: { schedule: "0 17 * * *" } }],
    approval: "auto",
    createdAt: "2026-03-05T00:00:00Z",
    updatedAt: "2026-03-18T00:00:00Z",
  },
  "agent-3": {
    id: "agent-3",
    name: "Code Review Agent",
    description:
      "Automatically reviews pull requests for code quality, security issues, and adherence to team standards.",
    systemPrompt:
      "You are a code reviewer. Analyze pull request diffs and provide constructive feedback on code quality, security, and best practices.",
    toolsConfig: {
      github_pulls: {},
      github_comments: {},
      code_analysis: {},
    },
    llmConfig: {
      analysis: { provider: "anthropic", model: "Claude Sonnet" },
      planning: { provider: "anthropic", model: "Claude Sonnet" },
      execution: { provider: "anthropic", model: "Claude Sonnet" },
    },
    triggersConfig: [{ type: "webhook" }],
    approval: "required",
    maxToolRounds: 5,
    createdAt: "2026-03-10T00:00:00Z",
    updatedAt: "2026-03-22T00:00:00Z",
  },
  "agent-4": {
    id: "agent-4",
    name: "Data Pipeline Monitor",
    description:
      "Monitors data pipeline health and alerts on failures or anomalies in data quality metrics.",
    systemPrompt:
      "You are a data pipeline monitor. Check pipeline status, analyze metrics, and raise alerts when issues are detected.",
    toolsConfig: {
      db_query: {},
      metrics_read: {},
      slack_post: {},
      pagerduty_alert: {},
    },
    llmConfig: {
      analysis: { provider: "openai", model: "GPT-4o" },
      planning: { provider: "openai", model: "GPT-4o" },
      execution: { provider: "openai", model: "GPT-4o-mini" },
    },
    triggersConfig: [
      { type: "cron", config: { schedule: "*/15 * * * *" } },
      { type: "webhook" },
    ],
    approval: "conditional",
    maxToolRounds: 8,
    createdAt: "2026-03-12T00:00:00Z",
    updatedAt: "2026-03-21T00:00:00Z",
  },
};

const approvalBadgeClasses: Record<string, string> = {
  required:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  auto: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  conditional:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
};

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const agent = agentsById[id];

  if (!agent) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold">Agent not found</h1>
        <p className="text-muted-foreground mt-2">
          No agent with ID &ldquo;{id}&rdquo; exists.
        </p>
        <Button asChild className="mt-4" variant="secondary">
          <Link href="/agents">Back to Agents</Link>
        </Button>
      </div>
    );
  }

  const toolNames = Object.keys(agent.toolsConfig);
  const triggerTypes = agent.triggersConfig.map((t) => t.type);

  const modelRows = [
    {
      stage: "Analysis",
      model: agent.llmConfig.analysis.model,
      provider: agent.llmConfig.analysis.provider,
    },
    {
      stage: "Planning",
      model: agent.llmConfig.planning.model,
      provider: agent.llmConfig.planning.provider,
    },
    ...(agent.llmConfig.execution
      ? [
          {
            stage: "Execution",
            model: agent.llmConfig.execution.model,
            provider: agent.llmConfig.execution.provider,
          },
        ]
      : []),
  ];

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{agent.name}</h1>
        <p className="text-muted-foreground">{agent.description}</p>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <Button asChild variant="secondary">
          <Link href={`/agents/${id}/edit`}>
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/agents/${id}/canvas`}>
            <Palette className="h-4 w-4" />
            Edit in Canvas
          </Link>
        </Button>
        <Button>
          <Play className="h-4 w-4" />
          Run Now
        </Button>
      </div>

      <Separator />

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="runs">Run History</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* System Prompt */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              System Prompt
            </h3>
            <div className="rounded-lg border p-4 font-mono text-sm whitespace-pre-wrap bg-muted/50">
              {agent.systemPrompt}
            </div>
          </div>

          {/* Model Config */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Model Configuration
            </h3>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium">Stage</th>
                    <th className="text-left px-4 py-2 font-medium">Model</th>
                    <th className="text-left px-4 py-2 font-medium">
                      Provider
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {modelRows.map((row) => (
                    <tr key={row.stage} className="border-b last:border-0">
                      <td className="px-4 py-2">{row.stage}</td>
                      <td className="px-4 py-2">{row.model}</td>
                      <td className="px-4 py-2 capitalize">{row.provider}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tools */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Tools ({toolNames.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {toolNames.map((name) => (
                <Badge key={name} variant="secondary">
                  {name}
                </Badge>
              ))}
            </div>
          </div>

          {/* Triggers */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Triggers
            </h3>
            <div className="flex flex-wrap gap-2">
              {triggerTypes.map((type) => (
                <Badge key={type} variant="outline">
                  {type}
                </Badge>
              ))}
            </div>
          </div>

          {/* Approval Mode */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Approval Mode
            </h3>
            <Badge
              variant="secondary"
              className={`border-0 ${approvalBadgeClasses[agent.approval]}`}
            >
              {agent.approval}
            </Badge>
          </div>
        </TabsContent>

        {/* Run History Tab */}
        <TabsContent value="runs" className="mt-6">
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            Run history will appear here.
          </div>
        </TabsContent>

        {/* Configuration Tab */}
        <TabsContent value="config" className="mt-6">
          <pre className="rounded-lg border p-4 font-mono text-sm overflow-auto bg-muted/50">
            {JSON.stringify(agent, null, 2)}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  );
}
