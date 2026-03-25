import type { PipelineSpec } from "@/types/pipeline";

/**
 * Fallback pipeline template for when no LLM provider is configured.
 * Used only as a last resort — normal flow goes through the backend SSE endpoint.
 */
export function generateTemplatePipeline(name: string): PipelineSpec {
  return {
    name,
    description: "Default pipeline template",
    systemPrompt: "You are a helpful AI assistant.",
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 0, y: 0 },
        data: { label: "Start", triggerType: "manual" },
      },
      {
        id: "llm-1",
        type: "llm",
        position: { x: 0, y: 150 },
        data: { label: "Analyze", model: "claude-sonnet-4-20250514", provider: "anthropic" },
      },
      {
        id: "llm-2",
        type: "llm",
        position: { x: 0, y: 300 },
        data: { label: "Plan", model: "claude-sonnet-4-20250514", provider: "anthropic" },
      },
      {
        id: "gate-1",
        type: "humanGate",
        position: { x: 0, y: 450 },
        data: { label: "Approve", approvalMode: "required" },
      },
      {
        id: "llm-3",
        type: "llm",
        position: { x: 0, y: 600 },
        data: { label: "Execute", model: "claude-sonnet-4-20250514", provider: "anthropic" },
      },
      {
        id: "output-1",
        type: "output",
        position: { x: 0, y: 750 },
        data: { label: "Result" },
      },
    ],
    edges: [
      { source: "trigger-1", target: "llm-1" },
      { source: "llm-1", target: "llm-2" },
      { source: "llm-2", target: "gate-1" },
      { source: "gate-1", target: "llm-3" },
      { source: "llm-3", target: "output-1" },
    ],
  };
}
