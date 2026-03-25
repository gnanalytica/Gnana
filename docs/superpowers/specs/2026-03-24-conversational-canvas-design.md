# Conversational Canvas Builder — Design Spec

## Overview

Replace the current heuristic-based pipeline generation with a real LLM-powered conversational builder. Users describe agents in natural language, the LLM asks adaptive follow-up questions, then generates a visual pipeline on the canvas. Users edit via chat or drag-and-drop — both stay in sync.

## UX Flow

### Phase 1: Chat (full-screen)

User lands on agent creation. Full-screen chat with template grid.

1. User types a description or picks a template
2. LLM evaluates clarity:
   - **Clear enough**: generates pipeline immediately, transitions to Phase 2
   - **Too vague**: asks ONE follow-up question. Max 3 questions before generating best-effort pipeline.
3. After pipeline generation, chat shows a summary card with "Open in Canvas" button
4. Transition to Phase 2

### Phase 2: Split View (canvas + chat)

Left: ReactFlow canvas with generated pipeline. Right: Chat panel.

- User can edit via drag-and-drop on canvas OR natural language in chat
- Both modalities update the same state (single source of truth in SplitCanvas)
- Chat always has full pipeline context for accurate modifications
- AI assistant mode (toggleable): chat proactively reacts to canvas edits

## Backend: Enhanced Chat Endpoint

### Endpoint: `POST /api/chat/pipeline`

**Request body:**

```typescript
{
  message: string;            // User's message
  pipeline?: PipelineSpec;    // Current pipeline state (full node/edge specs)
  history?: ChatMessage[];    // Conversation history
  mode: "design" | "modify";  // Phase 1 = design, Phase 2 = modify
  focusedNodeId?: string;     // Selected node on canvas (for scoped edits)
  forceGenerate?: boolean;    // When true, LLM must generate pipeline (no more questions)
}
```

**Response (SSE stream):**

Design mode — LLM returns one of:

```typescript
// Follow-up question
{ type: "question", content: "What should trigger this agent?" }

// Pipeline generated
{ type: "pipeline", spec: PipelineSpec, message: "Here's your pipeline...", suggestions: ["Add retry on HTTP calls", "Consider approval before sending"] }
```

Modify mode:

```typescript
{ type: "pipeline", spec: PipelineSpec, message: "Added Slack notification after the analysis step", changes: ["Added Tool node: slack-notify", "Connected LLM-analyze → slack-notify"] }
```

### System Prompt Structure

````
You are Gnana, an AI agent pipeline builder.

## Behavior

MODE: {design|modify}

### Design Mode
- Understand what the user wants to build
- If the description is clear enough to build a working pipeline, generate it immediately
- If vague, ask ONE focused follow-up question (never multiple)
- If `forceGenerate` is true, generate the best pipeline you can with available info (no more questions)
- When generating, include 2-3 suggestions for improvements

### Modify Mode
- Apply the user's requested change to the current pipeline
- Return the full updated pipeline spec (not a diff)
- Describe what you changed in the `changes` array
- If a node is focused, scope your changes to that node unless the user's request is clearly about the whole pipeline

## Available Node Types

- trigger: {triggerType: "manual"|"webhook"|"cron"|"event", config: {...}}
- llm: {model: string, provider: string, systemPrompt: string, temperature: number, maxTokens: number}
- tool: {connector: string, name: string, description: string, outputVar: string}
- humanGate: {approvalMode: "required"|"auto", message: string, timeout: number}
- condition: {expression: string, trueLabel: string, falseLabel: string}
- loop: {maxIterations: number, untilCondition: string}
- parallel: {branches: number}
- merge: {inputs: number}
- transform: {expression: string}
- output: {label: string}
- group: {label: string} (visual grouping of related nodes)

## Available Connectors
{dynamically injected from workspace}

## Available Providers
{dynamically injected from workspace}

## Response Format
Return valid JSON wrapped in ```json code blocks.

Design mode:
- To ask a question: {"type": "question", "content": "your question"}
- To generate: {"type": "pipeline", "spec": {"name": "...", "description": "...", "systemPrompt": "...", "nodes": [...], "edges": [...]}, "message": "description", "suggestions": ["..."]}

Modify mode:
- {"type": "pipeline", "spec": {"name": "...", "description": "...", "systemPrompt": "...", "nodes": [...], "edges": [...]}, "message": "description", "changes": [{"action": "added"|"removed"|"modified", "nodeId": "...", "description": "..."}]}

Terminal event (always sent last):
- {"type": "done"}

IMPORTANT: The spec MUST include name, description, and systemPrompt fields. These are required by the PipelineSpec type.

## Current Pipeline State
{full PipelineSpec JSON or "Empty - new agent"}

## Focused Node
{node config JSON or "None"}
````

### Provider Fallback Chain

1. User's configured workspace provider (from `providers` table)
2. Gnana's server-side key (`GNANA_BUILDER_API_KEY` env var)
3. Return error: "Configure an LLM provider in Settings to use the AI builder"

Priority order for provider selection: Anthropic > Google > OpenAI (based on structured output reliability).

For the Gnana fallback key: use Anthropic (claude-sonnet-4-20250514) as the default model. Add `GNANA_BUILDER_API_KEY` to `.env.example` with description.

### Streaming

Switch from single POST response to SSE (Server-Sent Events):

- The Hono backend endpoint streams SSE directly
- The Next.js API route (`/api/chat/route.ts`) is converted to a streaming passthrough using `ReadableStream` — it pipes the Hono SSE response through to the browser without buffering
- Frontend consumes via `fetch()` with `response.body.getReader()` (not EventSource, since we need POST)
- Stream format: `data: {json}\n\n` for each event
- Terminal event `data: {"type": "done"}\n\n` signals stream completion
- If connection drops before `done` event, frontend shows retry button

## Frontend Changes

### 1. Replace `pipeline-ai.ts` (heuristic generation)

Gut the heuristic logic but keep `generateTemplatePipeline()` as a no-LLM fallback (for when no provider and no Gnana key are available). All other generation goes through the backend.

`pipeline-ai-stream.ts` becomes an SSE consumer:

```typescript
async function* streamPipelineResponse(
  message: string,
  pipeline?: PipelineSpec,
  mode: "design" | "modify",
  history?: ChatMessage[],
  focusedNodeId?: string,
  forceGenerate?: boolean,
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, pipeline, mode, history, focusedNodeId, forceGenerate }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE lines
    const lines = buffer.split("\n\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = JSON.parse(line.slice(6));
      if (data.type === "done") return;
      yield data; // {type: "text", content} or {type: "question", content} or {type: "pipeline", spec, ...}
    }
  }
}
```

### 2. Enhanced `CanvasChatPanel`

Current: sends "Current pipeline has X nodes, Y edges" as context.
New: sends full `PipelineSpec` (all nodes with configs, all edges) via the `pipeline` field.

Additional changes:

- Pass `mode: "modify"` to backend
- Pass `focusedNodeId` when a node is selected on canvas
- Show node focus indicator in chat UI
- Display `changes` array as a bullet list after modifications
- Display `suggestions` as clickable chips after initial generation

### 3. Enhanced `ChatOnboarding`

Current: calls heuristic `generatePipelineFromPrompt()`.
New: calls backend with `mode: "design"`.

Handle the `question` response type:

- Display as a normal chat message from the assistant
- User replies naturally, conversation continues
- Frontend tracks question count in component state
- After 2 questions, display subtle progress: "Almost there..."
- After 3 questions, pass `forceGenerate: true` to backend — LLM must generate a pipeline

Handle the `pipeline` response type:

- Display summary message + pipeline card (existing behavior)
- Show suggestions as clickable chips below the card
- "Open in Canvas" transitions to split view

Conversation history:

- Accumulate `ChatMessage[]` in component state
- Pass full history to `streamPipelineResponse()` on each call
- History enables multi-turn context for follow-up questions

### 4. Canvas → Chat Events

Add event emission in `SplitCanvas`:

```typescript
// When nodes/edges change on canvas
const handleCanvasChange = (newNodes, newEdges) => {
  // Update refs (existing)
  nodesRef.current = newNodes;
  edgesRef.current = newEdges;

  // Emit event for chat (new)
  if (aiAssistantMode) {
    const diff = computeCanvasDiff(prevNodes, newNodes, prevEdges, newEdges);
    if (diff.length > 0) {
      chatPanelRef.current?.onCanvasEvent(diff);
    }
  }
};
```

Canvas diff types:

```typescript
type CanvasEvent =
  | { type: "nodeAdded"; node: NodeSpec }
  | { type: "nodeRemoved"; nodeId: string; nodeType: string }
  | { type: "nodeUpdated"; nodeId: string; changes: Record<string, unknown> }
  | { type: "edgeAdded"; source: string; target: string }
  | { type: "edgeRemoved"; source: string; target: string };
```

Canvas diff rules — what counts as a "meaningful change":

- `type` or `data` field changes → meaningful (triggers diff event)
- `position` changes → ignored (just dragging nodes around)
- Node added/removed → always meaningful
- Edge added/removed → always meaningful

Implementation: store `prevNodes`/`prevEdges` as deep-cloned refs. Update them only after emitting a diff event. Compare by serializing `{type, data}` (ignoring position).

When AI assistant mode is ON and a canvas event fires:

- Debounce 1 second (avoid spam during drag operations)
- Rate limit: max 1 AI suggestion per 10 seconds (prevent cost runaway)
- Send a lightweight modify request: "The user just added a [Tool] node" or "The user removed the approval gate"
- Display LLM's contextual suggestion as a subtle chat bubble

### 5. AI Assistant Mode Toggle

Add a toggle button in the chat panel header:

- Default: OFF (silent mode)
- ON: chat reacts to canvas edits with suggestions
- Persisted in localStorage per user

### 6. Node Focus in Chat

When user clicks a node on canvas:

- Chat panel shows indicator: "Focused on: [node label]"
- Next chat message includes `focusedNodeId` in request
- LLM scopes response to that node
- Clicking canvas background or another node updates/clears focus

## State Management

Single source of truth: `SplitCanvas` component (no change from current architecture).

```
SplitCanvas state (nodes, edges)
  ├── PipelineCanvas reads/writes via props + callbacks
  ├── CanvasChatPanel reads via refs, writes via onPipelineUpdate callback
  ├── AutoSave reads via refs, debounced
  └── LiveRun reads via refs, overlays execution state
```

Both chat and canvas mutations flow through `handlePipelineUpdate()` which:

1. Applies dagre auto-layout (for AI-generated changes only)
2. Updates state
3. Triggers auto-save
4. Updates refs for next chat context

## Files to Create/Modify

### New Files

- `packages/server/src/routes/chat.ts` — rewrite (SSE streaming, enhanced prompt, provider fallback)
- `apps/dashboard/src/lib/pipeline-ai-stream.ts` — rewrite (SSE consumer)
- `apps/dashboard/src/lib/canvas/use-canvas-events.ts` — canvas diff computation

### Modified Files

- `apps/dashboard/src/lib/pipeline-ai.ts` — delete or gut (replace heuristic with backend call)
- `apps/dashboard/src/components/canvas/canvas-chat-panel.tsx` — full pipeline context, node focus, suggestions, assistant mode toggle
- `apps/dashboard/src/components/canvas/split-canvas.tsx` — canvas event emission, node focus state
- `apps/dashboard/src/components/agents/chat-onboarding.tsx` — handle question/pipeline response types
- `apps/dashboard/src/app/api/chat/route.ts` — pass through new fields (mode, focusedNodeId, full pipeline)

### Modified Files (continued)

- `apps/dashboard/src/components/canvas/pipeline-canvas.tsx` — add `onNodeSelect?: (nodeId: string | null) => void` prop. Fire it on node click (selected) and on canvas background click (null). Expose selected node ID to parent.

### Unchanged

- `config-drawer.tsx` — no changes needed
- `node-palette.tsx` — no changes needed
- All node components — no changes needed
- Auto-save, validation, execution preview, live run — no changes needed

## Error Handling

- **No provider configured + no Gnana key**: Show inline message in chat: "To use the AI builder, add an LLM provider in Settings → Providers" with a link
- **LLM returns invalid JSON**: Retry once with "Please return valid JSON". If still invalid, show error message in chat and keep current pipeline unchanged
- **LLM returns invalid pipeline** (missing trigger, orphan nodes): Apply what we can, run validation, show warnings on affected nodes
- **Network error during stream**: Show retry button in chat. Pipeline state is never corrupted (only applied on complete spec)
- **Rate limit hit**: Show "Slow down — try again in X seconds" in chat

## Testing Strategy

- **Unit tests**: System prompt builder, SSE parser, canvas diff computation
- **Integration tests**: Chat endpoint with mock LLM responses (question flow, pipeline generation, modification)
- **Manual testing**: End-to-end flow — describe agent → follow-ups → canvas → modify via chat → modify via drag-drop → verify sync
