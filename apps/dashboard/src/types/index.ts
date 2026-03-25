export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  toolsConfig: Record<string, unknown>;
  llmConfig: {
    analysis: { provider: string; model: string; maxTokens?: number; temperature?: number };
    planning: { provider: string; model: string; maxTokens?: number; temperature?: number };
    execution?: { provider: string; model: string; maxTokens?: number; temperature?: number };
  };
  pipelineConfig?: {
    nodes: import("./pipeline").NodeSpec[];
    edges: import("./pipeline").EdgeSpec[];
  };
  triggersConfig: Array<{ type: string; config?: Record<string, unknown> }>;
  approval: "required" | "auto" | "conditional";
  maxToolRounds?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  agentId: string;
  status: PipelineStage;
  triggerType: string;
  triggerData: Record<string, unknown>;
  analysis?: unknown;
  plan?: Plan;
  result?: ExecutionResult;
  error?: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  updatedAt: string;
}

export type PipelineStage =
  | "queued"
  | "analyzing"
  | "planning"
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "rejected";

export interface Plan {
  summary: string;
  steps: PlanStep[];
  reasoning?: string;
}

export interface PlanStep {
  order: number;
  title: string;
  description: string;
  toolCalls?: string[];
}

export interface ExecutionResult {
  status: "completed" | "partial" | "failed";
  stepResults: StepResult[];
  artifacts: Artifact[];
}

export interface StepResult {
  stepOrder: number;
  status: "completed" | "skipped" | "failed";
  output: string;
  artifacts?: Artifact[];
}

export interface Artifact {
  type: "code" | "document" | "report" | "image" | "link";
  title: string;
  content?: string;
  url?: string;
}

export interface Connector {
  id: string;
  workspaceId: string;
  type: string;
  name: string;
  authType: string;
  credentials: Record<string, unknown> | null;
  config: Record<string, unknown>;
  enabled: boolean;
  lastHealthStatus?: "healthy" | "unhealthy" | null;
  lastHealthCheckAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Provider {
  id: string;
  name: string;
  type: string;
  models: ModelInfo[];
  createdAt: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
}

export interface RunStreamEvent {
  type: string;
  data: unknown;
}
