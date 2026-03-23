"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentCard } from "@/components/agents/agent-card";
import type { Agent } from "@/types";

// Placeholder data
const placeholderAgents: Agent[] = [
  {
    id: "agent-1",
    name: "Weekly Report Agent",
    description:
      "Generates comprehensive weekly reports from multiple data sources including Jira, GitHub, and Confluence.",
    systemPrompt:
      "You are a reporting assistant. Gather data from configured sources and generate a well-structured weekly summary report.",
    toolsConfig: {
      jira_search: {},
      github_pulls: {},
      confluence_read: {},
      slack_post: {},
      markdown_render: {},
    },
    llmConfig: {
      analysis: { provider: "anthropic", model: "Claude Sonnet" },
      planning: { provider: "anthropic", model: "Claude Sonnet" },
      execution: { provider: "anthropic", model: "Claude Haiku" },
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
  {
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
  {
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
  {
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
];

export default function AgentsPage() {
  const [search, setSearch] = useState("");

  const filteredAgents = useMemo(() => {
    if (!search.trim()) return placeholderAgents;
    const query = search.toLowerCase();
    return placeholderAgents.filter((agent) =>
      agent.name.toLowerCase().includes(query)
    );
  }, [search]);

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agents</h1>
        <Button asChild>
          <Link href="/agents/new">
            <Plus className="h-4 w-4" />
            Create Agent
          </Link>
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Agent Grid or Empty State */}
      {filteredAgents.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filteredAgents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground mb-4">
            {search ? "No agents match your search." : "No agents yet."}
          </p>
          {!search && (
            <Button asChild>
              <Link href="/agents/new">
                <Plus className="h-4 w-4" />
                Create your first agent
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
