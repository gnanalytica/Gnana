"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Pencil, Palette, Play, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { useAgent } from "@/lib/hooks/use-agents";
import { api } from "@/lib/api";

const approvalBadgeClasses: Record<string, string> = {
  required: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  auto: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  conditional: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
};

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { agent, isLoading, error } = useAgent(id);
  const [runTriggering, setRunTriggering] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runSuccess, setRunSuccess] = useState(false);

  async function handleRunNow() {
    try {
      setRunTriggering(true);
      setRunError(null);
      setRunSuccess(false);
      await api.runs.trigger({ agentId: id, payload: {} });
      setRunSuccess(true);
      setTimeout(() => setRunSuccess(false), 3000);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Failed to trigger run");
    } finally {
      setRunTriggering(false);
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
      <div className="p-8">
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-destructive">Cannot connect to server</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
        <Button asChild className="mt-4" variant="secondary">
          <Link href="/agents">Back to Agents</Link>
        </Button>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold">Agent not found</h1>
        <p className="text-muted-foreground mt-2">No agent with ID &ldquo;{id}&rdquo; exists.</p>
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
        <Button onClick={handleRunNow} disabled={runTriggering}>
          <Play className="h-4 w-4" />
          {runTriggering ? "Triggering..." : "Run Now"}
        </Button>
        {runSuccess && <span className="text-sm text-green-600">Run triggered!</span>}
        {runError && <span className="text-sm text-destructive">{runError}</span>}
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
            <h3 className="text-sm font-medium text-muted-foreground">System Prompt</h3>
            <div className="rounded-lg border p-4 font-mono text-sm whitespace-pre-wrap bg-muted/50">
              {agent.systemPrompt}
            </div>
          </div>

          {/* Model Config */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">Model Configuration</h3>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium">Stage</th>
                    <th className="text-left px-4 py-2 font-medium">Model</th>
                    <th className="text-left px-4 py-2 font-medium">Provider</th>
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
            <h3 className="text-sm font-medium text-muted-foreground">Triggers</h3>
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
            <h3 className="text-sm font-medium text-muted-foreground">Approval Mode</h3>
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
