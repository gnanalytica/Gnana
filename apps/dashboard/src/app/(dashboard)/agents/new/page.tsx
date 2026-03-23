"use client";

import { useRouter } from "next/navigation";
import { WizardShell } from "@/components/agents/wizard/wizard-shell";
import type { WizardData } from "@/components/agents/wizard/wizard-shell";

export default function NewAgentPage() {
  const router = useRouter();

  const handleComplete = async (data: WizardData) => {
    // For now, just log and redirect. API integration comes later.
    console.log("Creating agent:", data);
    // await api.agents.create(data);
    router.push("/agents");
  };

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2">Create Agent</h1>
      <p className="text-muted-foreground mb-8">
        Set up your AI agent in 4 simple steps.
      </p>
      <WizardShell onComplete={handleComplete} />
    </div>
  );
}
