"use client";

import { Copy } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { WizardData } from "./wizard-shell";

interface StepTriggersProps {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
}

function hasTriggerType(
  triggers: WizardData["triggers"],
  type: string
): boolean {
  return triggers.some((t) => t.type === type);
}

export function StepTriggers({ data, onChange }: StepTriggersProps) {
  const toggleTrigger = (type: string) => {
    if (type === "manual") return; // Manual is always enabled
    if (hasTriggerType(data.triggers, type)) {
      onChange({
        triggers: data.triggers.filter((t) => t.type !== type),
      });
    } else {
      onChange({
        triggers: [...data.triggers, { type }],
      });
    }
  };

  const updateTriggerConfig = (
    type: string,
    config: Record<string, unknown>
  ) => {
    onChange({
      triggers: data.triggers.map((t) =>
        t.type === type ? { ...t, config } : t
      ),
    });
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(
      "https://gnana.example/api/webhook/[agent-id]"
    );
  };

  return (
    <div className="space-y-8">
      {/* Trigger Types */}
      <div className="space-y-4">
        <Label className="text-base">Trigger Types</Label>

        {/* Manual — always checked */}
        <label className="flex items-start gap-3 rounded-md border px-4 py-3 bg-muted/30">
          <input
            type="checkbox"
            checked
            disabled
            className="mt-0.5 accent-primary"
          />
          <div>
            <p className="text-sm font-medium">Manual</p>
            <p className="text-xs text-muted-foreground">
              Run this agent manually from the dashboard
            </p>
          </div>
        </label>

        {/* Webhook */}
        <div>
          <label className="flex items-start gap-3 rounded-md border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors">
            <input
              type="checkbox"
              checked={hasTriggerType(data.triggers, "webhook")}
              onChange={() => toggleTrigger("webhook")}
              className="mt-0.5 accent-primary"
            />
            <div>
              <p className="text-sm font-medium">Webhook</p>
              <p className="text-xs text-muted-foreground">
                Trigger via HTTP webhook endpoint
              </p>
            </div>
          </label>
          {hasTriggerType(data.triggers, "webhook") && (
            <div className="mt-2 ml-8 flex items-center gap-2">
              <Input
                readOnly
                value="https://gnana.example/api/webhook/[agent-id]"
                className="text-xs font-mono bg-muted"
              />
              <button
                type="button"
                onClick={copyWebhookUrl}
                className="shrink-0 rounded-md border p-2 hover:bg-muted transition-colors"
                title="Copy URL"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Assignment */}
        <div>
          <label className="flex items-start gap-3 rounded-md border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors">
            <input
              type="checkbox"
              checked={hasTriggerType(data.triggers, "assignment")}
              onChange={() => toggleTrigger("assignment")}
              className="mt-0.5 accent-primary"
            />
            <div>
              <p className="text-sm font-medium">Assignment</p>
              <p className="text-xs text-muted-foreground">
                Trigger when a ticket is assigned to this agent
              </p>
            </div>
          </label>
          {hasTriggerType(data.triggers, "assignment") && (
            <div className="mt-2 ml-8">
              <Input
                placeholder="Assignment field (e.g. assignee)"
                value={
                  (data.triggers.find((t) => t.type === "assignment")?.config
                    ?.field as string) || ""
                }
                onChange={(e) =>
                  updateTriggerConfig("assignment", {
                    field: e.target.value,
                  })
                }
              />
            </div>
          )}
        </div>

        {/* Mention */}
        <div>
          <label className="flex items-start gap-3 rounded-md border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors">
            <input
              type="checkbox"
              checked={hasTriggerType(data.triggers, "mention")}
              onChange={() => toggleTrigger("mention")}
              className="mt-0.5 accent-primary"
            />
            <div>
              <p className="text-sm font-medium">Mention</p>
              <p className="text-xs text-muted-foreground">
                Trigger when the agent is mentioned
              </p>
            </div>
          </label>
          {hasTriggerType(data.triggers, "mention") && (
            <div className="mt-2 ml-8">
              <Input
                placeholder="Mention pattern (e.g. @my-agent)"
                value={
                  (data.triggers.find((t) => t.type === "mention")?.config
                    ?.pattern as string) || ""
                }
                onChange={(e) =>
                  updateTriggerConfig("mention", {
                    pattern: e.target.value,
                  })
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Approval Mode */}
      <div className="space-y-4">
        <Label className="text-base">Approval Mode</Label>

        <label className="flex items-start gap-3 rounded-md border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors">
          <input
            type="radio"
            name="approval"
            checked={data.approval === "required"}
            onChange={() => onChange({ approval: "required" })}
            className="mt-0.5 accent-primary"
          />
          <div>
            <p className="text-sm font-medium">Required</p>
            <p className="text-xs text-muted-foreground">
              Human must approve every plan before execution
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3 rounded-md border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors">
          <input
            type="radio"
            name="approval"
            checked={data.approval === "auto"}
            onChange={() => onChange({ approval: "auto" })}
            className="mt-0.5 accent-primary"
          />
          <div>
            <p className="text-sm font-medium">Auto-approve</p>
            <p className="text-xs text-muted-foreground">
              Pipeline runs without stopping for approval
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3 rounded-md border px-4 py-3 opacity-60 cursor-not-allowed">
          <input
            type="radio"
            name="approval"
            disabled
            className="mt-0.5 accent-primary"
          />
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Conditional</p>
            <Badge variant="secondary" className="text-[10px]">
              Coming soon
            </Badge>
          </div>
        </label>
      </div>

      {/* Max Execution Time */}
      <div className="space-y-2">
        <Label htmlFor="maxToolRounds">
          Maximum execution time (minutes)
        </Label>
        <Input
          id="maxToolRounds"
          type="number"
          min={1}
          max={60}
          value={data.maxToolRounds}
          onChange={(e) =>
            onChange({
              maxToolRounds: parseInt(e.target.value, 10) || 5,
            })
          }
          className="max-w-[200px]"
        />
      </div>
    </div>
  );
}
