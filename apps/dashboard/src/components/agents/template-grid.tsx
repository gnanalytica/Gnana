"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  ClipboardList,
  Code2,
  FileBarChart,
  Headphones,
  Database,
  Sparkles,
} from "lucide-react";

const TEMPLATES = [
  {
    id: "pm-analyst",
    name: "PM Analyst",
    description: "Analyzes tickets, finds duplicates, and creates action plans",
    icon: ClipboardList,
    prompt:
      "Build an agent that analyzes project management tickets, identifies duplicates, and creates structured action plans with priorities.",
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description: "Reviews pull requests and provides actionable feedback",
    icon: Code2,
    prompt:
      "Build an agent that reviews GitHub pull requests for correctness, performance, and security, then posts actionable feedback.",
  },
  {
    id: "report-generator",
    name: "Report Generator",
    description: "Generates reports from data sources with analysis",
    icon: FileBarChart,
    prompt:
      "Build an agent that collects data from multiple sources, analyzes trends, and generates structured reports with insights.",
  },
  {
    id: "support-agent",
    name: "Support Agent",
    description: "Handles customer support inquiries with knowledge base lookup",
    icon: Headphones,
    prompt:
      "Build a customer support agent that answers inquiries using a knowledge base, escalates complex issues, and maintains a helpful tone.",
  },
  {
    id: "data-analyst",
    name: "Data Analyst",
    description: "Queries databases and generates insights from data",
    icon: Database,
    prompt:
      "Build an agent that queries databases, analyzes results, identifies patterns, and presents findings with supporting data.",
  },
  {
    id: "custom",
    name: "Custom",
    description: "Start from scratch and describe what you need",
    icon: Sparkles,
    prompt: "",
  },
] as const;

interface TemplateGridProps {
  onSelect: (prompt: string) => void;
}

export function TemplateGrid({ onSelect }: TemplateGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-lg">
      {TEMPLATES.map((t) => {
        const Icon = t.icon;
        return (
          <Card
            key={t.id}
            className="cursor-pointer transition-all hover:border-primary hover:shadow-md"
            onClick={() => onSelect(t.prompt)}
          >
            <CardContent className="flex flex-col items-center text-center gap-2 p-4">
              <Icon className="h-6 w-6 text-primary" />
              <span className="text-sm font-medium">{t.name}</span>
              <span className="text-xs text-muted-foreground line-clamp-2">{t.description}</span>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
