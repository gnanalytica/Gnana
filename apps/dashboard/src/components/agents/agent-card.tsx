import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Agent } from "@/types";

interface AgentCardProps {
  agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
  // Derive display info
  const modelName = agent.llmConfig.analysis.model;
  const toolCount = Object.keys(agent.toolsConfig).length;
  const triggerTypes = agent.triggersConfig.map((t) => t.type);

  return (
    <Link href={`/agents/${agent.id}`} className="block group">
      <Card className="h-full transition-colors group-hover:border-primary/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{agent.name}</CardTitle>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {agent.description}
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="text-xs">
            {modelName}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {toolCount} {toolCount === 1 ? "tool" : "tools"}
          </Badge>
          {triggerTypes.map((type) => (
            <Badge key={type} variant="outline" className="text-xs">
              {type}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </Link>
  );
}
