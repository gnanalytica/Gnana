"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StepIdentity } from "./step-identity";
import { StepModels } from "./step-models";
import { StepTools } from "./step-tools";
import { StepTriggers } from "./step-triggers";

export interface WizardData {
  name: string;
  description: string;
  systemPrompt: string;
  template?: string;
  llmConfig: {
    analysis: {
      provider: string;
      model: string;
      maxTokens?: number;
      temperature?: number;
    };
    planning: {
      provider: string;
      model: string;
      maxTokens?: number;
      temperature?: number;
    };
    execution?: {
      provider: string;
      model: string;
      maxTokens?: number;
      temperature?: number;
    };
  };
  tools: string[];
  triggers: Array<{ type: string; config?: Record<string, unknown> }>;
  approval: "required" | "auto" | "conditional";
  maxToolRounds: number;
}

const STEPS = ["Identity", "Models", "Tools", "Triggers"] as const;

const INITIAL_DATA: WizardData = {
  name: "",
  description: "",
  systemPrompt: "",
  llmConfig: {
    analysis: { provider: "", model: "" },
    planning: { provider: "", model: "" },
  },
  tools: [],
  triggers: [{ type: "manual" }],
  approval: "required",
  maxToolRounds: 5,
};

interface WizardShellProps {
  onComplete: (data: WizardData) => void;
}

export function WizardShell({ onComplete }: WizardShellProps) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [errors, setErrors] = useState<string[]>([]);

  const updateData = (updates: Partial<WizardData>) => {
    setData((prev) => ({ ...prev, ...updates }));
    // Clear errors when user makes changes
    if (errors.length > 0) setErrors([]);
  };

  const validate = (): boolean => {
    const errs: string[] = [];

    if (step === 0) {
      if (!data.name.trim()) errs.push("Name is required.");
    }

    if (step === 1) {
      if (!data.llmConfig.analysis.provider || !data.llmConfig.analysis.model)
        errs.push("Analysis model is required.");
      if (!data.llmConfig.planning.provider || !data.llmConfig.planning.model)
        errs.push("Planning model is required.");
    }

    setErrors(errs);
    return errs.length === 0;
  };

  const handleNext = () => {
    if (!validate()) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleBack = () => {
    setErrors([]);
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleCreate = () => {
    if (!validate()) return;
    onComplete(data);
  };

  return (
    <div className="space-y-8">
      {/* Step indicator */}
      <div className="flex items-center justify-center">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center">
            {/* Step circle */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-medium transition-colors",
                  i < step && "border-primary bg-primary text-primary-foreground",
                  i === step && "border-primary text-primary",
                  i > step && "border-muted-foreground/30 text-muted-foreground",
                )}
              >
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={cn(
                  "mt-1.5 text-xs",
                  i === step ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>

            {/* Connecting line */}
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "mx-2 h-0.5 w-12 sm:w-20",
                  i < step ? "bg-primary" : "bg-muted-foreground/30",
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
          {errors.map((err) => (
            <p key={err} className="text-sm text-destructive">
              {err}
            </p>
          ))}
        </div>
      )}

      {/* Step content */}
      <div className="min-h-[320px]">
        {step === 0 && <StepIdentity data={data} onChange={updateData} />}
        {step === 1 && <StepModels data={data} onChange={updateData} />}
        {step === 2 && <StepTools data={data} onChange={updateData} />}
        {step === 3 && <StepTriggers data={data} onChange={updateData} />}
      </div>

      {/* Bottom navigation */}
      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="outline" onClick={handleBack} disabled={step === 0}>
          Back
        </Button>

        {step < STEPS.length - 1 ? (
          <Button onClick={handleNext}>Next</Button>
        ) : (
          <Button onClick={handleCreate}>Create Agent</Button>
        )}
      </div>
    </div>
  );
}
