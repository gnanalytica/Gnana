"use client";

import { use } from "react";
import { SplitCanvas } from "@/components/canvas/split-canvas";
import { useAgent } from "@/lib/hooks/use-agents";
import { Loader2 } from "lucide-react";
import type { NodeSpec, EdgeSpec } from "@/types/pipeline";

export default function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { agent, isLoading, error } = useAgent(id);

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading agent...</span>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <div className="text-muted-foreground">
          {error ?? "Agent not found"}
        </div>
      </div>
    );
  }

  const pipelineConfig = agent.pipelineConfig as { nodes?: NodeSpec[]; edges?: EdgeSpec[] } | undefined;

  return (
    <div className="h-screen w-full">
      <SplitCanvas
        agentId={id}
        initialNodes={pipelineConfig?.nodes}
        initialEdges={pipelineConfig?.edges}
      />
    </div>
  );
}
