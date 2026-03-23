"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { templates } from "@/components/agents/templates";
import type { WizardData } from "./wizard-shell";

interface StepIdentityProps {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
}

export function StepIdentity({ data, onChange }: StepIdentityProps) {
  const handleTemplateChange = (value: string) => {
    if (value === "custom") {
      onChange({
        template: "custom",
        name: "",
        description: "",
        systemPrompt: "",
      });
      return;
    }

    const template = templates.find((t) => t.name === value);
    if (template) {
      onChange({
        template: template.name,
        name: template.name,
        description: template.description,
        systemPrompt: template.systemPrompt,
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Template selector */}
      <div className="space-y-2">
        <Label htmlFor="template">Start from template</Label>
        <Select
          value={data.template || ""}
          onValueChange={handleTemplateChange}
        >
          <SelectTrigger id="template">
            <SelectValue placeholder="Choose a template..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="custom">Custom</SelectItem>
            {templates.map((t) => (
              <SelectItem key={t.name} value={t.name}>
                {t.name} — {t.description}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="name">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          placeholder="My Agent"
          value={data.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          placeholder="A brief description of what this agent does..."
          rows={2}
          value={data.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>

      {/* System Prompt */}
      <div className="space-y-2">
        <Label htmlFor="systemPrompt">
          System Prompt <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="systemPrompt"
          className="font-mono text-sm"
          placeholder="You are a helpful assistant. Analyze the provided data and generate insights..."
          rows={6}
          value={data.systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
        />
        <p className="text-xs text-muted-foreground text-right">
          {data.systemPrompt.length} characters
        </p>
      </div>
    </div>
  );
}
