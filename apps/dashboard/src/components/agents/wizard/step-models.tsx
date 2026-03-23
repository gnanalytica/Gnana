"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { WizardData } from "./wizard-shell";

const MODEL_OPTIONS = [
  {
    provider: "Anthropic",
    providerId: "anthropic",
    models: [
      { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-haiku-4-20250514", name: "Claude Haiku 4" },
    ],
  },
  {
    provider: "Google",
    providerId: "google",
    models: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    ],
  },
  {
    provider: "OpenAI",
    providerId: "openai",
    models: [
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 mini" },
      { id: "o3-mini", name: "o3-mini" },
    ],
  },
];

interface StepModelsProps {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
}

function ModelSelector({
  label,
  description,
  required,
  value,
  onValueChange,
}: {
  label: string;
  description: string;
  required?: boolean;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <p className="text-sm text-muted-foreground">{description}</p>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select a model..." />
        </SelectTrigger>
        <SelectContent>
          {MODEL_OPTIONS.map((group) => (
            <SelectGroup key={group.providerId}>
              <SelectLabel>{group.provider}</SelectLabel>
              {group.models.map((model) => (
                <SelectItem
                  key={`${group.providerId}:${model.id}`}
                  value={`${group.providerId}:${model.id}`}
                >
                  {model.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function parseModelValue(config: { provider: string; model: string }): string {
  if (!config.provider || !config.model) return "";
  return `${config.provider}:${config.model}`;
}

function splitModelValue(value: string): { provider: string; model: string } {
  const [provider = "", model = ""] = value.split(":");
  return { provider, model };
}

export function StepModels({ data, onChange }: StepModelsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const updatePhase = (
    phase: "analysis" | "planning" | "execution",
    value: string
  ) => {
    const { provider, model } = splitModelValue(value);
    const current = data.llmConfig[phase] || { provider: "", model: "" };
    onChange({
      llmConfig: {
        ...data.llmConfig,
        [phase]: { ...current, provider, model },
      },
    });
  };

  const updatePhaseAdvanced = (
    phase: "analysis" | "planning" | "execution",
    field: "temperature" | "maxTokens",
    value: number | undefined
  ) => {
    const current = data.llmConfig[phase] || {
      provider: "",
      model: "",
    };
    onChange({
      llmConfig: {
        ...data.llmConfig,
        [phase]: { ...current, [field]: value },
      },
    });
  };

  return (
    <div className="space-y-8">
      <ModelSelector
        label="Analysis Model"
        description="Which model should analyze the task?"
        required
        value={parseModelValue(data.llmConfig.analysis)}
        onValueChange={(v) => updatePhase("analysis", v)}
      />

      <ModelSelector
        label="Planning Model"
        description="Which model should create the plan?"
        required
        value={parseModelValue(data.llmConfig.planning)}
        onValueChange={(v) => updatePhase("planning", v)}
      />

      <ModelSelector
        label="Execution Model"
        description="Which model should execute? (defaults to analysis model)"
        value={
          data.llmConfig.execution
            ? parseModelValue(data.llmConfig.execution)
            : ""
        }
        onValueChange={(v) => updatePhase("execution", v)}
      />

      {/* Advanced section */}
      <div className="border rounded-lg">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          Advanced Settings
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              advancedOpen && "rotate-180"
            )}
          />
        </button>

        {advancedOpen && (
          <div className="px-4 pb-4 space-y-6 border-t pt-4">
            {(["analysis", "planning", "execution"] as const).map((phase) => {
              const config = data.llmConfig[phase];
              if (phase === "execution" && !config?.provider) return null;

              return (
                <div key={phase} className="space-y-3">
                  <p className="text-sm font-medium capitalize">{phase}</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs">
                        Temperature: {config?.temperature ?? 0.7}
                      </Label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={config?.temperature ?? 0.7}
                        onChange={(e) =>
                          updatePhaseAdvanced(
                            phase,
                            "temperature",
                            parseFloat(e.target.value)
                          )
                        }
                        className="w-full accent-primary"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>0</span>
                        <span>1</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Max Tokens</Label>
                      <Input
                        type="number"
                        placeholder="4096"
                        value={config?.maxTokens ?? ""}
                        onChange={(e) =>
                          updatePhaseAdvanced(
                            phase,
                            "maxTokens",
                            e.target.value
                              ? parseInt(e.target.value, 10)
                              : undefined
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
