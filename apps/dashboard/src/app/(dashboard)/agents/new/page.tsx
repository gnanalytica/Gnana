"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChatOnboarding } from "@/components/agents/chat-onboarding";
import { SplitCanvas } from "@/components/canvas/split-canvas";
import { WizardShell } from "@/components/agents/wizard/wizard-shell";
import type { WizardData } from "@/components/agents/wizard/wizard-shell";
import type { PipelineSpec } from "@/types/pipeline";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Settings2 } from "lucide-react";

type Phase = "chat" | "canvas" | "wizard";

export default function NewAgentPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("chat");
  const [pipelineSpec, setPipelineSpec] = useState<PipelineSpec | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpenCanvas = (spec: PipelineSpec) => {
    setPipelineSpec(spec);
    setPhase("canvas");
  };

  const handleWizardComplete = async (data: WizardData) => {
    try {
      setError(null);
      const agent = await api.agents.create({
        name: data.name,
        description: data.description,
        systemPrompt: data.systemPrompt,
        llmConfig: data.llmConfig,
        toolsConfig: { tools: data.tools },
        triggersConfig: data.triggers,
        approval: data.approval,
        maxToolRounds: data.maxToolRounds,
      });
      router.push(`/agents/${(agent as Record<string, unknown>).id}`);
    } catch (err) {
      console.error("Failed to create agent:", err);
      setError(err instanceof Error ? err.message : "Failed to create agent");
    }
  };

  // Phase 1: Chat onboarding (full-screen)
  if (phase === "chat") {
    return (
      <div className="h-screen flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b">
          <h1 className="text-lg font-semibold">Create Agent</h1>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => setPhase("wizard")}
          >
            <Settings2 className="h-4 w-4" />
            Use classic wizard
          </Button>
        </div>
        <div className="flex-1">
          <ChatOnboarding onOpenCanvas={handleOpenCanvas} />
        </div>
      </div>
    );
  }

  // Phase 2+3: Canvas + Chat split view
  if (phase === "canvas" && pipelineSpec) {
    return (
      <div className="h-screen w-full">
        <SplitCanvas
          initialNodes={pipelineSpec.nodes}
          initialEdges={pipelineSpec.edges}
        />
      </div>
    );
  }

  // Fallback: classic wizard
  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Create Agent</h1>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => setPhase("chat")}
        >
          Use AI builder
        </Button>
      </div>
      <p className="text-muted-foreground mb-8">Set up your AI agent in 4 simple steps.</p>
      {error && (
        <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <WizardShell onComplete={handleWizardComplete} />
    </div>
  );
}
