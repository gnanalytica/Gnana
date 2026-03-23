import type {
  LLMToolDef,
  ChatResponse,
  ChatParams,
  ToolChatParams,
  ChatResponseChunk,
  LLMProvider,
  TokenUsage,
  ModelInfo,
} from "@gnana/provider-base";

// Re-export provider types consumers need
export type {
  ChatResponse,
  ChatParams,
  ToolChatParams,
  ChatResponseChunk,
  LLMProvider,
  LLMToolDef,
  TokenUsage,
  ModelInfo,
};

// ---- JSON Schema placeholder ----
export type JSONSchema = Record<string, unknown>;

// ---- Agent Definition ----
export interface ModelConfig {
  provider: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface TriggerConfig {
  type: "assignment" | "mention" | "webhook" | "manual";
  config?: Record<string, unknown>;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  mcpServers?: MCPServerConfig[];
  llm: {
    analysis: ModelConfig;
    planning: ModelConfig;
    execution?: ModelConfig;
  };
  triggers: TriggerConfig[];
  approval: "required" | "auto" | "conditional";
  hooks?: AgentHooks;
  maxToolRounds?: number;
}

// ---- Tool System ----
export interface ToolContext {
  runId: string;
  agentId: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: (input: unknown, ctx: ToolContext) => Promise<string>;
}

export interface MCPServerConfig {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  url?: string;
  env?: Record<string, string>;
}

// ---- Hook System ----
export interface AgentHooks {
  onRunStart?: (ctx: RunContext) => Promise<void>;
  onAnalysisComplete?: (ctx: RunContext, analysis: unknown) => Promise<void>;
  onPlanComplete?: (ctx: RunContext, plan: Plan) => Promise<void>;
  onApproval?: (ctx: RunContext) => Promise<void>;
  onRejection?: (ctx: RunContext, reason?: string) => Promise<void>;
  onExecutionComplete?: (ctx: RunContext, result: unknown) => Promise<void>;
  onError?: (ctx: RunContext, error: Error) => Promise<void>;
  beforeToolCall?: (toolName: string, input: unknown) => Promise<unknown>;
  afterToolCall?: (toolName: string, input: unknown, result: string) => Promise<string>;
}

// ---- Pipeline Types ----
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

export interface Run {
  id: string;
  agentId: string;
  status: PipelineStage;
  analysis?: unknown;
  plan?: Plan;
  result?: ExecutionResult;
  createdAt: Date;
  updatedAt: Date;
}

export interface TriggerPayload {
  type: TriggerConfig["type"];
  data: Record<string, unknown>;
}

export interface Plan {
  summary: string;
  steps: PlanStep[];
}

export interface PlanStep {
  order: number;
  description: string;
  toolCalls?: string[];
}

// ---- Execution Types ----
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
  mimeType?: string;
}

// ---- Run Context ----
export interface RunStore {
  getRun(runId: string): Promise<Run>;
  updateStatus(runId: string, status: PipelineStage): Promise<void>;
  updateAnalysis(runId: string, analysis: unknown): Promise<void>;
  updatePlan(runId: string, plan: Plan): Promise<void>;
  updateResult(runId: string, result: ExecutionResult): Promise<void>;
  addLog(runId: string, entry: LogEntry): Promise<void>;
}

export interface LogEntry {
  timestamp: Date;
  stage: PipelineStage;
  type: "info" | "tool_call" | "tool_result" | "error";
  message: string;
  data?: unknown;
}

// ---- LLM Router Types ----
export interface RouteConfig {
  provider: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface RouterConfig {
  routes: Record<string, RouteConfig>;
  fallbackChain?: string[];
  retries?: number;
}

// ---- Event Bus ----
export type EventHandler = (data: unknown) => void;

export interface EventBus {
  emit(event: string, data: unknown): Promise<void>;
  on(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void;
}

// ---- RunContext (passed to pipeline) ----
export interface RunContext {
  run: Run;
  agent: AgentDefinition;
  trigger: TriggerPayload;
  llm: LLMRouter;
  tools: ToolExecutor;
  store: RunStore;
  events: EventBus;
}

// ---- Forward declarations for classes ----
export interface LLMRouter {
  chat(taskType: string, params: Omit<ChatParams, "model">): Promise<ChatResponse>;
  chatWithTools(taskType: string, params: Omit<ToolChatParams, "model">): Promise<ChatResponse>;
}

export interface ToolExecutor {
  execute(toolName: string, input: unknown): Promise<string>;
  listTools(): LLMToolDef[];
}
