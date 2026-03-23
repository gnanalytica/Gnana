"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Plus, Search, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { AgentCard } from "@/components/agents/agent-card";
import { useAgents } from "@/lib/hooks/use-agents";

export default function AgentsPage() {
  const [search, setSearch] = useState("");
  const { agents, isLoading, error } = useAgents();

  const filteredAgents = useMemo(() => {
    if (!search.trim()) return agents;
    const query = search.toLowerCase();
    return agents.filter((agent) =>
      agent.name.toLowerCase().includes(query)
    );
  }, [search, agents]);

  if (error) {
    return (
      <div className="p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Agents</h1>
        </div>
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-destructive">
                Cannot connect to server
              </p>
              <p className="text-sm text-muted-foreground">
                Make sure the Gnana server is running at{" "}
                {process.env.NEXT_PUBLIC_GNANA_API_URL ?? "http://localhost:4000"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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

      {/* Loading State */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          Loading...
        </div>
      ) : /* Agent Grid or Empty State */
      filteredAgents.length > 0 ? (
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
