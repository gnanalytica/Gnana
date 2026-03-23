"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WizardShell } from "@/components/agents/wizard/wizard-shell";
import type { WizardData } from "@/components/agents/wizard/wizard-shell";
import { api } from "@/lib/api";

export default function NewAgentPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const handleComplete = async (data: WizardData) => {
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

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2">Create Agent</h1>
      <p className="text-muted-foreground mb-8">Set up your AI agent in 4 simple steps.</p>
      {error && (
        <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <WizardShell onComplete={handleComplete} />
    </div>
  );
}
