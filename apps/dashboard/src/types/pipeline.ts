export type PipelineNodeType =
  | "trigger"
  | "llm"
  | "tool"
  | "humanGate"
  | "condition"
  | "loop"
  | "parallel"
  | "merge"
  | "transform"
  | "output"
  | "group";

export interface NodeSpec {
  id: string;
  type: PipelineNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  parentId?: string;
}

export interface EdgeSpec {
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
  dataType?: string;
}

export interface PipelineSpec {
  name: string;
  description: string;
  systemPrompt: string;
  nodes: NodeSpec[];
  edges: EdgeSpec[];
}

export interface PipelineConfig {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
}

/** Chat message in the onboarding / canvas chat panel */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** If the assistant generated/modified a pipeline, attach it */
  pipelineSpec?: PipelineSpec;
}

/** Template used in chat onboarding */
export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  prompt: string;
}
