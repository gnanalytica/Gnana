import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eq, and, providers, connectors, type Database } from "@gnana/db";
import { rateLimit } from "../middleware/rate-limit.js";
import { decrypt } from "../utils/encryption.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface PipelineNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface PipelineEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

interface PipelineSpec {
  name?: string;
  description?: string;
  systemPrompt?: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

interface ChatRequestBody {
  message: string;
  pipeline?: PipelineSpec;
  history?: ChatMessage[];
  mode: "design" | "modify";
  focusedNodeId?: string;
  forceGenerate?: boolean;
}

// SSE event types streamed to the client
interface TextEvent {
  type: "text";
  content: string;
}

interface QuestionEvent {
  type: "question";
  content: string;
}

interface PipelineEvent {
  type: "pipeline";
  spec: PipelineSpec;
  message: string;
  suggestions: string[];
  changes: string[];
}

interface ErrorEvent {
  type: "error";
  message: string;
}

interface ThinkingEvent {
  type: "thinking";
  content: string;
}

interface ThinkingCompleteEvent {
  type: "thinking_complete";
  content: string;
}

interface DoneEvent {
  type: "done";
}

type SSEEvent = TextEvent | QuestionEvent | PipelineEvent | ErrorEvent | ThinkingEvent | ThinkingCompleteEvent | DoneEvent;

// Provider row type (from DB query)
interface ProviderRow {
  id: string;
  workspaceId: string | null;
  name: string;
  type: string;
  apiKey: string;
  baseUrl: string | null;
  config: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Connector row type (from DB query)
interface ConnectorRow {
  id: string;
  workspaceId: string | null;
  type: string;
  name: string;
  authType: string;
  credentials: unknown;
  config: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Node type schemas for system prompt
// ---------------------------------------------------------------------------

const NODE_TYPE_SCHEMAS = `
## Node Types and Config Schemas

1. **trigger** — Entry point for pipeline execution
   - triggerType: "manual" | "schedule" | "webhook" | "event"
   - label: string
   - schedule?: string (cron expression, for schedule type)
   - webhookPath?: string (for webhook type)

2. **llm** — Call a large language model
   - label: string
   - provider: "anthropic" | "openai" | "google"
   - model: string (e.g. "claude-sonnet-4-20250514", "gpt-4.1", "gemini-2.5-flash")
   - systemPrompt?: string
   - temperature?: number (0-1)
   - maxTokens?: number
   - inputMapping?: string (jq-like expression to extract input)
   - outputKey?: string (key to store result under)

3. **tool** — Execute an external tool/connector action
   - label: string
   - connectorId?: string
   - toolName: string
   - inputMapping?: Record<string, string>
   - timeout?: number (ms)

4. **humanGate** — Pause for human approval before continuing
   - label: string
   - approvalMode: "required" | "optional" | "timeout"
   - timeoutMs?: number
   - instructions?: string

5. **condition** — Branch based on a condition
   - label: string
   - expression: string (JavaScript expression evaluated against pipeline context)
   - trueLabel?: string
   - falseLabel?: string

6. **loop** — Iterate over items or repeat N times
   - label: string
   - loopType: "forEach" | "count" | "while"
   - itemsExpression?: string (for forEach — expression to get array)
   - count?: number (for count)
   - whileExpression?: string (for while)
   - maxIterations?: number (safety limit)

7. **parallel** — Fork execution into parallel branches
   - label: string
   - strategy: "all" | "race" | "allSettled"

8. **merge** — Join parallel branches back together
   - label: string
   - mergeStrategy: "concat" | "object" | "first"

9. **transform** — Transform data between nodes
   - label: string
   - expression: string (JavaScript expression or jq-like transform)
   - outputKey?: string

10. **output** — Terminal node that captures final result
    - label: string
    - format?: "json" | "text" | "markdown"

11. **group** — Visual grouping container for organizing nodes
    - label: string
    - color?: string
    - collapsed?: boolean
`;

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  mode: "design" | "modify",
  pipeline: PipelineSpec | undefined,
  focusedNodeId: string | undefined,
  forceGenerate: boolean,
  workspaceProviders: ProviderRow[],
  workspaceConnectors: ConnectorRow[],
): string {
  const providerList =
    workspaceProviders.length > 0
      ? workspaceProviders
          .map((p) => `- ${p.name} (${p.type})${p.enabled ? "" : " [disabled]"}`)
          .join("\n")
      : "No providers configured yet.";

  const connectorList =
    workspaceConnectors.length > 0
      ? workspaceConnectors
          .map((c) => `- ${c.name} (${c.type})${c.enabled ? "" : " [disabled]"}`)
          .join("\n")
      : "No connectors configured yet.";

  const focusedNodeContext =
    focusedNodeId && pipeline
      ? (() => {
          const node = pipeline.nodes.find((n) => n.id === focusedNodeId);
          if (!node) return "";
          return `\n## Focused Node\nThe user is currently focused on this node:\n\`\`\`json\n${JSON.stringify(node, null, 2)}\n\`\`\`\nPrioritize changes related to this node when the user's request is ambiguous.\n`;
        })()
      : "";

  const pipelineContext = pipeline
    ? `\`\`\`json\n${JSON.stringify(pipeline, null, 2)}\n\`\`\``
    : "Empty — no pipeline created yet.";

  const modeInstructions =
    mode === "design"
      ? `## Mode: Design
You are helping the user design a NEW pipeline from scratch.

${
  forceGenerate
    ? `IMPORTANT: The user has requested you generate a pipeline NOW. Do NOT ask any follow-up questions. Generate your best pipeline based on what you know.`
    : `If the user's request is clear enough to generate a pipeline, generate one immediately.
If the request is too vague or ambiguous, ask exactly ONE short follow-up question to clarify. Do not ask multiple questions.`
}

When generating a pipeline:
- Create a complete PipelineSpec with name, description, systemPrompt, nodes[], and edges[]
- Position nodes in a left-to-right flow layout (x increases by ~250 per column, y varies for parallel branches)
- Always start with a trigger node
- Always end with an output node
- Give each node a unique id in the format "type-N" (e.g. "llm-1", "tool-2")
- Give each edge a unique id in the format "edge-sourceId-targetId"
- Connect all nodes with edges so the graph is fully connected
`
      : `## Mode: Modify
You are helping the user modify an EXISTING pipeline.

When applying modifications:
- Return the FULL updated pipeline spec (all nodes and edges, not just changed ones)
- Preserve node IDs that haven't changed
- Preserve positions of unchanged nodes
- When adding new nodes, position them logically relative to existing nodes
- When removing nodes, also remove any edges connected to them
- Include a brief summary of what changed in your message
`;

  return `You are **Gnana**, an AI-powered agent pipeline builder. You help users create, understand, and modify multi-step AI agent pipelines through natural conversation.

${modeInstructions}

${NODE_TYPE_SCHEMAS}

## Workspace Context

### Available Providers
${providerList}

### Available Connectors
${connectorList}

## Current Pipeline State
${pipelineContext}
${focusedNodeContext}

## Response Format

You MUST respond in one of two ways:

### 1. Follow-up Question (when you need clarification)
Respond with a natural language question. Keep it short and specific. Ask only ONE question at a time.

### 2. Pipeline Generation/Modification
Respond with a brief natural language message explaining what you built or changed, followed by the pipeline specification in a JSON code block.

The JSON block MUST contain a complete PipelineSpec:
\`\`\`json
{
  "name": "Pipeline Name",
  "description": "What this pipeline does",
  "systemPrompt": "Default system prompt for LLM nodes",
  "nodes": [...],
  "edges": [...],
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"],
  "changes": ["Added trigger node", "Connected LLM to output"]
}
\`\`\`

The \`suggestions\` array should contain 2-4 short suggestions for what the user might want to do next.
The \`changes\` array should list the specific changes made (empty for new pipelines, populated for modifications).

## Guidelines
- Use the workspace's configured providers and connectors when creating LLM and tool nodes
- Default to Anthropic claude-sonnet-4-20250514 if available, otherwise use whatever provider is configured
- Create practical, well-structured pipelines — not overly complex ones
- Always include proper labels for nodes
- Keep explanations concise but helpful
`;
}

// ---------------------------------------------------------------------------
// Provider resolution: workspace providers > GNANA_BUILDER_API_KEY fallback
// ---------------------------------------------------------------------------

async function resolveProvider(
  db: Database,
  workspaceId: string,
): Promise<{ type: string; apiKey: string; baseUrl?: string | null } | null> {
  // Query all enabled providers for this workspace
  const providerList = await db
    .select()
    .from(providers)
    .where(and(eq(providers.workspaceId, workspaceId), eq(providers.enabled, true)));

  if (providerList.length > 0) {
    // Prefer Anthropic > Google > OpenAI
    const preferred = ["anthropic", "google", "openai"];
    for (const pref of preferred) {
      const match = providerList.find((p) => p.type === pref);
      if (match) {
        return {
          type: match.type,
          apiKey: decrypt(match.apiKey),
          baseUrl: match.baseUrl,
        };
      }
    }
    // Fallback to first available
    const first = providerList[0]!;
    return {
      type: first.type,
      apiKey: decrypt(first.apiKey),
      baseUrl: first.baseUrl,
    };
  }

  // Fallback to GNANA_BUILDER_API_KEY env var
  const builderKey = process.env.GNANA_BUILDER_API_KEY;
  if (builderKey) {
    return {
      type: "anthropic",
      apiKey: builderKey,
      baseUrl: null,
    };
  }

  // Fallback to individual provider env vars
  const envFallbacks: [string, string | undefined][] = [
    ["anthropic", process.env.ANTHROPIC_API_KEY],
    ["google", process.env.GOOGLE_AI_KEY],
    ["openai", process.env.OPENAI_API_KEY],
  ];
  for (const [type, key] of envFallbacks) {
    if (key) {
      return { type, apiKey: key, baseUrl: null };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Workspace data fetchers
// ---------------------------------------------------------------------------

async function fetchWorkspaceProviders(db: Database, workspaceId: string): Promise<ProviderRow[]> {
  return db.select().from(providers).where(eq(providers.workspaceId, workspaceId)) as Promise<
    ProviderRow[]
  >;
}

async function fetchWorkspaceConnectors(
  db: Database,
  workspaceId: string,
): Promise<ConnectorRow[]> {
  return db
    .select()
    .from(connectors)
    .where(and(eq(connectors.workspaceId, workspaceId), eq(connectors.enabled, true))) as Promise<
    ConnectorRow[]
  >;
}

// ---------------------------------------------------------------------------
// LLM API callers
// ---------------------------------------------------------------------------

interface LLMStreamCallbacks {
  onText: (text: string) => Promise<void>;
  onError: (error: string) => Promise<void>;
}

async function callAnthropicStreaming(
  apiKey: string,
  systemPrompt: string,
  message: string,
  history: ChatMessage[],
  callbacks: LLMStreamCallbacks,
): Promise<void> {
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: message },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      stream: true,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    await callbacks.onError(`Anthropic API error (${res.status}): ${errorBody}`);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    await callbacks.onError("No response body from Anthropic API");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last potentially incomplete line in buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const event = JSON.parse(data) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };

          if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta" &&
            event.delta.text
          ) {
            await callbacks.onText(event.delta.text);
          }
        } catch {
          // Skip unparseable SSE data lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function callOpenAINonStreaming(
  apiKey: string,
  systemPrompt: string,
  message: string,
  history: ChatMessage[],
  baseUrl?: string | null,
): Promise<string> {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: message },
  ];

  const url = baseUrl ?? "https://api.openai.com/v1";
  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages,
      max_tokens: 8192,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${errorBody}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "No response from AI.";
}

async function callGoogleStreaming(
  apiKey: string,
  systemPrompt: string,
  message: string,
  history: ChatMessage[],
  sendEvent: (data: string) => Promise<void>,
): Promise<string> {
  const contents = [
    ...history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts: [{ text: message }] },
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          thinkingConfig: { thinkingBudget: 2048 },
        },
      }),
    },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Google API error (${res.status}): ${errorBody}`);
  }

  let fullText = "";
  let thinkingText = "";
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;

      try {
        const chunk = JSON.parse(jsonStr) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string; thought?: boolean }>;
            };
          }>;
        };

        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (!part.text) continue;
          if (part.thought) {
            // Stream thinking tokens
            thinkingText += part.text;
            await sendEvent(sseData({ type: "thinking", content: part.text }));
          } else {
            // Stream response tokens
            fullText += part.text;
            await sendEvent(sseData({ type: "text", content: part.text }));
          }
        }
      } catch {
        // Skip malformed JSON chunks
      }
    }
  }

  if (thinkingText) {
    await sendEvent(sseData({ type: "thinking_complete", content: thinkingText }));
  }

  return fullText || "No response from AI.";
}

// ---------------------------------------------------------------------------
// Response parser: extract pipeline spec from LLM text response
// ---------------------------------------------------------------------------

interface ParsedResponse {
  textBeforeJson: string;
  pipeline: (PipelineSpec & { suggestions?: string[]; changes?: string[] }) | null;
}

function parseAIResponse(fullText: string): ParsedResponse {
  const jsonMatch = fullText.match(/```json\s*([\s\S]*?)\s*```/);

  if (!jsonMatch) {
    return { textBeforeJson: fullText.trim(), pipeline: null };
  }

  const textBeforeJson = fullText.slice(0, jsonMatch.index).trim();
  try {
    const parsed = JSON.parse(jsonMatch[1]!) as PipelineSpec & {
      suggestions?: string[];
      changes?: string[];
    };
    return { textBeforeJson, pipeline: parsed };
  } catch {
    return { textBeforeJson: fullText.replace(/```json[\s\S]*?```/g, "").trim(), pipeline: null };
  }
}

// ---------------------------------------------------------------------------
// SSE event helper
// ---------------------------------------------------------------------------

function sseData(event: SSEEvent): string {
  return JSON.stringify(event);
}

// ---------------------------------------------------------------------------
// Simulated word-by-word streaming for non-streaming providers
// ---------------------------------------------------------------------------

async function streamTextWordByWord(
  text: string,
  sendEvent: (data: string) => Promise<void>,
): Promise<void> {
  // Split into small chunks (~2-5 words each) for a smooth streaming feel
  const words = text.split(/(\s+)/);
  let chunk = "";
  let wordCount = 0;

  for (const word of words) {
    chunk += word;
    if (/\S/.test(word)) wordCount++;

    if (wordCount >= 3) {
      await sendEvent(sseData({ type: "text", content: chunk }));
      chunk = "";
      wordCount = 0;
    }
  }

  // Flush remaining
  if (chunk) {
    await sendEvent(sseData({ type: "text", content: chunk }));
  }
}

// ---------------------------------------------------------------------------
// Route definition
// ---------------------------------------------------------------------------

export function chatRoutes(db: Database) {
  const app = new Hono();

  // POST /api/chat/pipeline — AI-powered pipeline generation/modification via SSE
  app.post("/pipeline", rateLimit({ windowMs: 60_000, maxRequests: 20 }), async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const body = (await c.req.json()) as ChatRequestBody;
    const {
      message,
      pipeline,
      history = [],
      mode = "design",
      focusedNodeId,
      forceGenerate = false,
    } = body;

    // Resolve provider (with fallback chain)
    const resolvedProvider = await resolveProvider(db, workspaceId);

    if (!resolvedProvider) {
      // No provider available — return SSE error event
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          data: sseData({
            type: "error",
            message:
              "No LLM provider configured. Go to Settings > Providers to add one, or set GNANA_BUILDER_API_KEY environment variable.",
          }),
        });
        await stream.writeSSE({ data: sseData({ type: "done" }) });
      });
    }

    // Fetch workspace context in parallel
    const [workspaceProviders, workspaceConnectors] = await Promise.all([
      fetchWorkspaceProviders(db, workspaceId),
      fetchWorkspaceConnectors(db, workspaceId),
    ]);

    // Build the enhanced system prompt
    const systemPrompt = buildSystemPrompt(
      mode,
      pipeline,
      focusedNodeId,
      forceGenerate,
      workspaceProviders,
      workspaceConnectors,
    );

    // Stream SSE response
    return streamSSE(c, async (stream) => {
      const sendEvent = async (data: string) => {
        await stream.writeSSE({ data });
      };

      try {
        if (resolvedProvider.type === "anthropic") {
          // True streaming for Anthropic — stream text deltas in real time
          let fullText = "";
          let hadError = false;

          await callAnthropicStreaming(resolvedProvider.apiKey, systemPrompt, message, history, {
            onText: async (text) => {
              fullText += text;
              await sendEvent(sseData({ type: "text", content: text }));
            },
            onError: async (error) => {
              hadError = true;
              await sendEvent(sseData({ type: "error", message: error }));
            },
          });

          // After streaming completes, parse full response and emit structured events
          if (!hadError && fullText.trim()) {
            const parsed = parseAIResponse(fullText);
            if (parsed.pipeline) {
              const { suggestions = [], changes = [], ...specFields } = parsed.pipeline;
              const spec: PipelineSpec = {
                name: specFields.name,
                description: specFields.description,
                systemPrompt: specFields.systemPrompt,
                nodes: specFields.nodes ?? [],
                edges: specFields.edges ?? [],
              };
              await sendEvent(
                sseData({
                  type: "pipeline",
                  spec,
                  message: parsed.textBeforeJson || "Here's your pipeline.",
                  suggestions,
                  changes,
                }),
              );
            } else {
              // No pipeline in response — treat as a follow-up question
              await sendEvent(sseData({ type: "question", content: parsed.textBeforeJson }));
            }
          }
        } else if (resolvedProvider.type === "google") {
          // Google Gemini — true streaming with thinking support
          const fullText = await callGoogleStreaming(
            resolvedProvider.apiKey,
            systemPrompt,
            message,
            history,
            sendEvent,
          );

          // Parse the accumulated response for pipeline spec
          const parsed = parseAIResponse(fullText);

          if (parsed.pipeline) {
            const { suggestions = [], changes = [], ...specFields } = parsed.pipeline;
            const spec: PipelineSpec = {
              name: specFields.name,
              description: specFields.description,
              systemPrompt: specFields.systemPrompt,
              nodes: specFields.nodes ?? [],
              edges: specFields.edges ?? [],
            };

            await sendEvent(
              sseData({
                type: "pipeline",
                spec,
                message: parsed.textBeforeJson || "Here's your pipeline.",
                suggestions,
                changes,
              }),
            );
          } else if (parsed.textBeforeJson && !fullText.includes("```json")) {
            await sendEvent(sseData({ type: "question", content: parsed.textBeforeJson }));
          }
        } else {
          // Non-streaming providers (OpenAI) — call API then simulate streaming
          let fullText: string;

          if (resolvedProvider.type === "openai") {
            fullText = await callOpenAINonStreaming(
              resolvedProvider.apiKey,
              systemPrompt,
              message,
              history,
              resolvedProvider.baseUrl,
            );
          } else {
            await sendEvent(
              sseData({
                type: "error",
                message: `Unsupported provider type: ${resolvedProvider.type}`,
              }),
            );
            await sendEvent(sseData({ type: "done" }));
            return;
          }

          // Parse the response
          const parsed = parseAIResponse(fullText);

          // Stream the text portion word-by-word
          if (parsed.textBeforeJson) {
            await streamTextWordByWord(parsed.textBeforeJson, sendEvent);
          }

          // If a pipeline was generated, emit the pipeline event
          if (parsed.pipeline) {
            const { suggestions = [], changes = [], ...specFields } = parsed.pipeline;
            const spec: PipelineSpec = {
              name: specFields.name,
              description: specFields.description,
              systemPrompt: specFields.systemPrompt,
              nodes: specFields.nodes ?? [],
              edges: specFields.edges ?? [],
            };

            await sendEvent(
              sseData({
                type: "pipeline",
                spec,
                message: parsed.textBeforeJson || "Here's your pipeline.",
                suggestions,
                changes,
              }),
            );
          } else if (fullText.trim()) {
            // Text-only response — it's a follow-up question
            await sendEvent(sseData({ type: "question", content: parsed.textBeforeJson }));
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        await sendEvent(sseData({ type: "error", message: `Error calling AI: ${errorMsg}` }));
      }

      // Always send terminal done event
      await sendEvent(sseData({ type: "done" }));
    });
  });

  return app;
}
