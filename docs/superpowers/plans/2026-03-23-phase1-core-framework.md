# Phase 1: Core Framework Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Gnana agent framework foundation — monorepo, core runtime, 3 LLM providers, database schema, Hono REST API + WebSocket server, and TypeScript client SDK.

**Architecture:** pnpm monorepo with Turborepo. `@gnana/core` is the stateless pipeline engine. `@gnana/server` wraps it with Hono HTTP + WebSocket. `@gnana/client` is the consumer SDK. Providers implement a shared `LLMProvider` interface. Database is PostgreSQL via Drizzle ORM.

**Tech Stack:** TypeScript (strict), pnpm, Turborepo, tsup, Vitest, Hono, Drizzle ORM, PostgreSQL, @anthropic-ai/sdk, @google/genai, openai

---

## File Structure

```
gnana/
├── package.json                         # Root workspace config
├── pnpm-workspace.yaml                  # Workspace definition
├── turbo.json                           # Turborepo pipeline config
├── tsconfig.base.json                   # Shared TS strict config
├── .prettierrc                          # Formatting config
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                 # Public exports
│   │   │   ├── types.ts                 # AgentDefinition, RunContext, PipelineStage, etc.
│   │   │   ├── event-bus.ts             # In-process pub/sub
│   │   │   ├── hooks.ts                 # Hook runner (lifecycle callbacks)
│   │   │   ├── tool-executor.ts         # Unified MCP + custom tool executor
│   │   │   ├── llm-router.ts            # Route requests to providers with fallback
│   │   │   └── pipeline.ts              # 4-phase pipeline engine
│   │   └── src/__tests__/
│   │       ├── event-bus.test.ts
│   │       ├── hooks.test.ts
│   │       ├── tool-executor.test.ts
│   │       ├── llm-router.test.ts
│   │       └── pipeline.test.ts
│   ├── providers/
│   │   ├── base/
│   │   │   ├── package.json
│   │   │   ├── tsconfig.json
│   │   │   └── src/
│   │   │       └── index.ts             # LLMProvider interface, ChatParams, ChatResponse, etc.
│   │   ├── anthropic/
│   │   │   ├── package.json
│   │   │   ├── tsconfig.json
│   │   │   ├── src/index.ts             # AnthropicProvider implements LLMProvider
│   │   │   └── src/__tests__/
│   │   │       └── anthropic.test.ts
│   │   ├── google/
│   │   │   ├── package.json
│   │   │   ├── tsconfig.json
│   │   │   ├── src/index.ts             # GoogleProvider implements LLMProvider
│   │   │   └── src/__tests__/
│   │   │       └── google.test.ts
│   │   └── openai/
│   │       ├── package.json
│   │       ├── tsconfig.json
│   │       ├── src/index.ts             # OpenAIProvider implements LLMProvider (+ OpenRouter)
│   │       └── src/__tests__/
│   │           └── openai.test.ts
│   ├── db/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts
│   │   └── src/
│   │       ├── index.ts                 # Re-export schema + client factory
│   │       └── schema/
│   │           ├── index.ts             # Barrel export all tables
│   │           ├── workspaces.ts        # workspaces table
│   │           ├── agents.ts            # agents + agent_tools tables
│   │           ├── runs.ts              # runs + run_logs tables
│   │           ├── connectors.ts        # connectors + connector_tools tables
│   │           ├── providers.ts         # providers table
│   │           └── api-keys.ts          # api_keys table
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                 # createGnanaServer factory + start
│   │   │   ├── app.ts                   # Hono app with routes
│   │   │   ├── middleware/
│   │   │   │   └── auth.ts              # API key auth middleware
│   │   │   ├── routes/
│   │   │   │   ├── agents.ts            # CRUD + test agent
│   │   │   │   ├── runs.ts              # Trigger, list, approve, reject, cancel
│   │   │   │   └── providers.ts         # List providers + models
│   │   │   └── ws/
│   │   │       └── runs.ts              # WebSocket subscriptions
│   │   └── src/__tests__/
│   │       ├── routes/
│   │       │   ├── agents.test.ts
│   │       │   └── runs.test.ts
│   │       └── middleware/
│   │           └── auth.test.ts
│   └── client/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts                 # GnanaClient export
│       │   ├── client.ts                # GnanaClient class
│       │   └── resources/
│       │       ├── agents.ts            # AgentsResource (CRUD)
│       │       ├── runs.ts              # RunsResource (trigger, approve, subscribe)
│       │       └── connectors.ts        # ConnectorsResource (list, create)
│       └── src/__tests__/
│           ├── client.test.ts
│           └── resources/
│               ├── agents.test.ts
│               └── runs.test.ts
```

---

## Chunk 1: Monorepo Foundation

### Task 1: Root workspace configuration

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.prettierrc`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "gnana",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.4",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "test": "turbo test",
    "test:watch": "turbo test:watch",
    "typecheck": "turbo typecheck",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "clean": "turbo clean"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "prettier": "^3.4.0",
    "tsup": "^8.3.0",
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
  - "packages/providers/*"
  - "packages/connectors/*"
  - "apps/*"
```

- [ ] **Step 3: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "test:watch": {
      "cache": false,
      "persistent": true
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

- [ ] **Step 4: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 5: Create .prettierrc**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 6: Install dependencies**

Run: `pnpm install`
Expected: lockfile generated, all dev deps installed.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .prettierrc pnpm-lock.yaml
git commit -m "chore: monorepo foundation — pnpm, turborepo, typescript, prettier"
```

---

### Task 2: Scaffold @gnana/providers/base — shared types

**Files:**

- Create: `packages/providers/base/package.json`
- Create: `packages/providers/base/tsconfig.json`
- Create: `packages/providers/base/src/index.ts`

- [ ] **Step 1: Create package.json for providers/base**

```json
{
  "name": "@gnana/provider-base",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "dev": "tsup src/index.ts --format esm --dts --watch",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "tsup": "workspace:*",
    "typescript": "workspace:*"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write provider types**

`packages/providers/base/src/index.ts`:

```typescript
// ---- Message types ----

export type Role = "user" | "assistant";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: Role;
  content: string | ContentBlock[];
}

// ---- Tool types for LLM ----

export interface LLMToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

// ---- Chat params ----

export interface ChatParams {
  model: string;
  systemPrompt: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
}

export interface ToolChatParams extends ChatParams {
  tools: LLMToolDef[];
}

// ---- Chat response ----

export type StopReason = "end_turn" | "tool_use" | "max_tokens";

export interface ChatResponse {
  content: ContentBlock[];
  stopReason: StopReason;
  usage: TokenUsage;
  model: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// ---- Streaming ----

export type ChatResponseChunkType =
  | "text_delta"
  | "tool_use_start"
  | "tool_input_delta"
  | "tool_use_end"
  | "done";

export interface ChatResponseChunk {
  type: ChatResponseChunkType;
  text?: string;
  toolUse?: { id: string; name: string; input?: Record<string, unknown> };
  usage?: TokenUsage;
}

// ---- Provider interface ----

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface LLMProvider {
  name: string;
  chat(params: ChatParams): Promise<ChatResponse>;
  chatWithTools(params: ToolChatParams): Promise<ChatResponse>;
  chatStream(params: ChatParams): AsyncIterable<ChatResponseChunk>;
  chatWithToolsStream(params: ToolChatParams): AsyncIterable<ChatResponseChunk>;
  listModels(): ModelInfo[];
}
```

- [ ] **Step 4: Build and verify**

Run: `pnpm install && pnpm --filter @gnana/provider-base build`
Expected: `dist/index.js` and `dist/index.d.ts` generated.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/base/
git commit -m "feat: @gnana/provider-base — shared LLM provider types and interfaces"
```

---

### Task 3: Scaffold @gnana/core — types and event bus

**Files:**

- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/event-bus.ts`
- Create: `packages/core/src/__tests__/event-bus.test.ts`

- [ ] **Step 1: Create package.json for core**

```json
{
  "name": "@gnana/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "dev": "tsup src/index.ts --format esm --dts --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@gnana/provider-base": "workspace:*"
  },
  "devDependencies": {
    "tsup": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write core types**

`packages/core/src/types.ts` — all the core domain types:

```typescript
import type { LLMProvider, LLMToolDef, ChatResponse, ContentBlock } from "@gnana/provider-base";

// ---- Model config ----

export interface ModelConfig {
  provider: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

// ---- Trigger ----

export type TriggerType = "assignment" | "mention" | "webhook" | "manual";

export interface TriggerConfig {
  type: TriggerType;
  config?: Record<string, unknown>;
}

export interface TriggerPayload {
  type: TriggerType;
  data: Record<string, unknown>;
}

// ---- Tools ----

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  handler: (input: unknown, ctx: ToolContext) => Promise<string>;
}

export interface ToolContext {
  runId: string;
  agentId: string;
}

export interface MCPServerConfig {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  url?: string;
  env?: Record<string, string>;
}

// ---- Hooks ----

export interface AgentHooks {
  onRunStart?: (ctx: RunContext) => Promise<void>;
  onAnalysisComplete?: (ctx: RunContext, analysis: unknown) => Promise<void>;
  onPlanComplete?: (ctx: RunContext, plan: Plan) => Promise<void>;
  onApproval?: (ctx: RunContext) => Promise<void>;
  onRejection?: (ctx: RunContext, reason?: string) => Promise<void>;
  onExecutionComplete?: (ctx: RunContext, result: ExecutionResult) => Promise<void>;
  onError?: (ctx: RunContext, error: Error) => Promise<void>;
  beforeToolCall?: (toolName: string, input: unknown) => Promise<unknown>;
  afterToolCall?: (toolName: string, input: unknown, result: string) => Promise<string>;
}

// ---- Agent definition ----

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

// ---- Pipeline ----

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

// ---- Run ----

export interface Run {
  id: string;
  agentId: string;
  status: PipelineStage;
  analysis?: unknown;
  plan?: Plan;
  result?: ExecutionResult;
  error?: string;
  tokenUsage: { inputTokens: number; outputTokens: number };
  createdAt: Date;
  updatedAt: Date;
}

// ---- Plan ----

export interface PlanStep {
  order: number;
  title: string;
  description: string;
  toolCalls?: string[];
}

export interface Plan {
  summary: string;
  steps: PlanStep[];
  reasoning?: string;
}

// ---- Execution ----

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

export interface ExecutionResult {
  status: "completed" | "partial" | "failed";
  stepResults: StepResult[];
  artifacts: Artifact[];
}

// ---- Run context ----

export interface RunStore {
  getRun(id: string): Promise<Run>;
  updateStatus(id: string, status: PipelineStage): Promise<void>;
  updateAnalysis(id: string, analysis: unknown): Promise<void>;
  updatePlan(id: string, plan: Plan): Promise<void>;
  updateResult(id: string, result: ExecutionResult): Promise<void>;
  updateError(id: string, error: string): Promise<void>;
  addTokenUsage(id: string, usage: { inputTokens: number; outputTokens: number }): Promise<void>;
}

export interface EventBus {
  emit(event: string, data: unknown): Promise<void>;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
}

export interface LLMRouter {
  chat(
    taskType: string,
    params: {
      systemPrompt: string;
      messages: import("@gnana/provider-base").Message[];
      maxTokens?: number;
      temperature?: number;
    },
  ): Promise<ChatResponse>;
  chatWithTools(
    taskType: string,
    params: {
      systemPrompt: string;
      messages: import("@gnana/provider-base").Message[];
      tools: LLMToolDef[];
      maxTokens?: number;
      temperature?: number;
    },
  ): Promise<ChatResponse>;
}

export interface ToolExecutor {
  execute(toolName: string, input: unknown, ctx: ToolContext): Promise<string>;
  listTools(): LLMToolDef[];
}

export interface RunContext {
  run: Run;
  agent: AgentDefinition;
  trigger: TriggerPayload;
  llm: LLMRouter;
  tools: ToolExecutor;
  store: RunStore;
  events: EventBus;
}
```

- [ ] **Step 4: Write EventBus test**

`packages/core/src/__tests__/event-bus.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createEventBus } from "../event-bus.js";

describe("EventBus", () => {
  it("calls handler when event is emitted", async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on("test", handler);
    await bus.emit("test", { foo: "bar" });
    expect(handler).toHaveBeenCalledWith({ foo: "bar" });
  });

  it("supports multiple handlers for same event", async () => {
    const bus = createEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on("test", h1);
    bus.on("test", h2);
    await bus.emit("test", "data");
    expect(h1).toHaveBeenCalledWith("data");
    expect(h2).toHaveBeenCalledWith("data");
  });

  it("removes handler with off()", async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on("test", handler);
    bus.off("test", handler);
    await bus.emit("test", "data");
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not call handlers for different events", async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on("other", handler);
    await bus.emit("test", "data");
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not throw when emitting with no handlers", async () => {
    const bus = createEventBus();
    await expect(bus.emit("test", "data")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm install && pnpm --filter @gnana/core test`
Expected: FAIL — `createEventBus` not found.

- [ ] **Step 6: Implement EventBus**

`packages/core/src/event-bus.ts`:

```typescript
import type { EventBus } from "./types.js";

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<(data: unknown) => void>>();

  return {
    async emit(event: string, data: unknown): Promise<void> {
      const set = handlers.get(event);
      if (!set) return;
      for (const handler of set) {
        handler(data);
      }
    },

    on(event: string, handler: (data: unknown) => void): void {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
    },

    off(event: string, handler: (data: unknown) => void): void {
      const set = handlers.get(event);
      if (set) {
        set.delete(handler);
      }
    },
  };
}
```

- [ ] **Step 7: Create src/index.ts barrel export**

```typescript
export * from "./types.js";
export { createEventBus } from "./event-bus.js";
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @gnana/core test`
Expected: All 5 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/
git commit -m "feat: @gnana/core — types, event bus with tests"
```

---

## Chunk 2: Core — Hooks, Tool Executor, LLM Router

### Task 4: Hook system

**Files:**

- Create: `packages/core/src/hooks.ts`
- Create: `packages/core/src/__tests__/hooks.test.ts`

- [ ] **Step 1: Write hooks test**

`packages/core/src/__tests__/hooks.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runHook, runToolHook } from "../hooks.js";
import type { AgentHooks, RunContext } from "../types.js";

const mockCtx = {} as RunContext;

describe("runHook", () => {
  it("calls the hook if defined", async () => {
    const hooks: AgentHooks = { onRunStart: vi.fn() };
    await runHook(hooks, "onRunStart", mockCtx);
    expect(hooks.onRunStart).toHaveBeenCalledWith(mockCtx);
  });

  it("does nothing if hook is not defined", async () => {
    const hooks: AgentHooks = {};
    await expect(runHook(hooks, "onRunStart", mockCtx)).resolves.toBeUndefined();
  });

  it("passes extra args to hook", async () => {
    const hooks: AgentHooks = { onAnalysisComplete: vi.fn() };
    await runHook(hooks, "onAnalysisComplete", mockCtx, { data: "result" });
    expect(hooks.onAnalysisComplete).toHaveBeenCalledWith(mockCtx, { data: "result" });
  });
});

describe("runToolHook", () => {
  it("runs beforeToolCall and returns transformed input", async () => {
    const hooks: AgentHooks = {
      beforeToolCall: vi.fn().mockResolvedValue({ modified: true }),
    };
    const result = await runToolHook(hooks, "before", "myTool", { original: true });
    expect(result).toEqual({ modified: true });
  });

  it("runs afterToolCall and returns transformed result", async () => {
    const hooks: AgentHooks = {
      afterToolCall: vi.fn().mockResolvedValue("modified result"),
    };
    const result = await runToolHook(hooks, "after", "myTool", {}, "original result");
    expect(result).toBe("modified result");
  });

  it("returns input/result unchanged if hook not defined", async () => {
    const hooks: AgentHooks = {};
    const beforeResult = await runToolHook(hooks, "before", "myTool", { a: 1 });
    expect(beforeResult).toEqual({ a: 1 });

    const afterResult = await runToolHook(hooks, "after", "myTool", {}, "result");
    expect(afterResult).toBe("result");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gnana/core test`
Expected: FAIL — `runHook` and `runToolHook` not found.

- [ ] **Step 3: Implement hooks**

`packages/core/src/hooks.ts`:

```typescript
import type { AgentHooks, RunContext } from "./types.js";

type LifecycleHookName = keyof Omit<AgentHooks, "beforeToolCall" | "afterToolCall">;

export async function runHook(
  hooks: AgentHooks | undefined,
  name: LifecycleHookName,
  ctx: RunContext,
  ...args: unknown[]
): Promise<void> {
  if (!hooks) return;
  const hook = hooks[name];
  if (typeof hook === "function") {
    await (hook as (ctx: RunContext, ...args: unknown[]) => Promise<void>)(ctx, ...args);
  }
}

export async function runToolHook(
  hooks: AgentHooks | undefined,
  phase: "before" | "after",
  toolName: string,
  input: unknown,
  result?: string,
): Promise<unknown> {
  if (!hooks) return phase === "after" ? result : input;

  if (phase === "before" && hooks.beforeToolCall) {
    return hooks.beforeToolCall(toolName, input);
  }
  if (phase === "after" && hooks.afterToolCall) {
    return hooks.afterToolCall(toolName, input, result!);
  }
  return phase === "after" ? result : input;
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/core/src/index.ts`:

```typescript
export { runHook, runToolHook } from "./hooks.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @gnana/core test`
Expected: All hook tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/hooks.ts packages/core/src/__tests__/hooks.test.ts packages/core/src/index.ts
git commit -m "feat: @gnana/core — hook system with lifecycle and tool hooks"
```

---

### Task 5: Tool executor

**Files:**

- Create: `packages/core/src/tool-executor.ts`
- Create: `packages/core/src/__tests__/tool-executor.test.ts`

- [ ] **Step 1: Write tool executor test**

`packages/core/src/__tests__/tool-executor.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createToolExecutor } from "../tool-executor.js";
import type { ToolDefinition, ToolContext } from "../types.js";

const ctx: ToolContext = { runId: "run-1", agentId: "agent-1" };

describe("ToolExecutor", () => {
  it("executes a registered custom tool", async () => {
    const tool: ToolDefinition = {
      name: "greet",
      description: "Says hello",
      inputSchema: { type: "object", properties: { name: { type: "string" } } },
      handler: vi.fn().mockResolvedValue("Hello, World!"),
    };
    const executor = createToolExecutor([tool]);
    const result = await executor.execute("greet", { name: "World" }, ctx);
    expect(result).toBe("Hello, World!");
    expect(tool.handler).toHaveBeenCalledWith({ name: "World" }, ctx);
  });

  it("throws on unknown tool", async () => {
    const executor = createToolExecutor([]);
    await expect(executor.execute("unknown", {}, ctx)).rejects.toThrow("Unknown tool: unknown");
  });

  it("lists tools in LLM format", () => {
    const tool: ToolDefinition = {
      name: "search",
      description: "Search things",
      inputSchema: { type: "object" },
      handler: vi.fn(),
    };
    const executor = createToolExecutor([tool]);
    const tools = executor.listTools();
    expect(tools).toEqual([
      { name: "search", description: "Search things", inputSchema: { type: "object" } },
    ]);
  });

  it("returns error string when tool handler throws", async () => {
    const tool: ToolDefinition = {
      name: "fail",
      description: "Always fails",
      inputSchema: { type: "object" },
      handler: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const executor = createToolExecutor([tool]);
    const result = await executor.execute("fail", {}, ctx);
    expect(result).toContain("Tool error: boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gnana/core test`
Expected: FAIL — `createToolExecutor` not found.

- [ ] **Step 3: Implement tool executor**

`packages/core/src/tool-executor.ts`:

```typescript
import type { LLMToolDef } from "@gnana/provider-base";
import type { ToolDefinition, ToolContext, ToolExecutor } from "./types.js";

export function createToolExecutor(tools: ToolDefinition[]): ToolExecutor {
  const toolMap = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  return {
    async execute(toolName: string, input: unknown, ctx: ToolContext): Promise<string> {
      const tool = toolMap.get(toolName);
      if (!tool) {
        throw new Error(`Unknown tool: ${toolName}`);
      }
      try {
        return await tool.handler(input, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Tool error: ${message}`;
      }
    },

    listTools(): LLMToolDef[] {
      return Array.from(toolMap.values()).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },
  };
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/core/src/index.ts`:

```typescript
export { createToolExecutor } from "./tool-executor.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @gnana/core test`
Expected: All tool executor tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tool-executor.ts packages/core/src/__tests__/tool-executor.test.ts packages/core/src/index.ts
git commit -m "feat: @gnana/core — tool executor with custom tool support"
```

---

### Task 6: LLM Router

**Files:**

- Create: `packages/core/src/llm-router.ts`
- Create: `packages/core/src/__tests__/llm-router.test.ts`

- [ ] **Step 1: Write LLM router test**

`packages/core/src/__tests__/llm-router.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createLLMRouter } from "../llm-router.js";
import type { LLMProvider, ChatParams, ChatResponse } from "@gnana/provider-base";

function mockProvider(name: string): LLMProvider {
  const response: ChatResponse = {
    content: [{ type: "text", text: `response from ${name}` }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    model: "test-model",
  };
  return {
    name,
    chat: vi.fn().mockResolvedValue(response),
    chatWithTools: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn(),
    chatWithToolsStream: vi.fn(),
    listModels: vi.fn().mockReturnValue([]),
  };
}

describe("LLMRouter", () => {
  it("routes to configured provider for task type", async () => {
    const anthropic = mockProvider("anthropic");
    const router = createLLMRouter(
      {
        routes: {
          analysis: { provider: "anthropic", model: "claude-sonnet" },
        },
      },
      new Map([["anthropic", anthropic]]),
    );

    const result = await router.chat("analysis", {
      systemPrompt: "test",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(anthropic.chat).toHaveBeenCalled();
    expect(result.content[0]).toEqual({ type: "text", text: "response from anthropic" });
  });

  it("throws if task type has no route", async () => {
    const router = createLLMRouter({ routes: {} }, new Map());
    await expect(router.chat("unknown", { systemPrompt: "t", messages: [] })).rejects.toThrow(
      "No route configured for task: unknown",
    );
  });

  it("throws if provider not registered", async () => {
    const router = createLLMRouter(
      { routes: { analysis: { provider: "missing", model: "x" } } },
      new Map(),
    );
    await expect(router.chat("analysis", { systemPrompt: "t", messages: [] })).rejects.toThrow(
      "Provider not found: missing",
    );
  });

  it("uses fallback chain when primary provider fails", async () => {
    const failing = mockProvider("anthropic");
    (failing.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("rate limited"));
    const fallback = mockProvider("google");

    const router = createLLMRouter(
      {
        routes: {
          analysis: { provider: "anthropic", model: "claude-sonnet" },
        },
        fallbackChain: ["anthropic", "google"],
      },
      new Map([
        ["anthropic", failing],
        ["google", fallback],
      ]),
    );

    const result = await router.chat("analysis", {
      systemPrompt: "test",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.content[0]).toEqual({ type: "text", text: "response from google" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gnana/core test`
Expected: FAIL — `createLLMRouter` not found.

- [ ] **Step 3: Implement LLM router**

`packages/core/src/llm-router.ts`:

```typescript
import type {
  LLMProvider,
  ChatParams,
  ToolChatParams,
  ChatResponse,
  LLMToolDef,
  Message,
} from "@gnana/provider-base";
import type { LLMRouter, ModelConfig } from "./types.js";

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

export function createLLMRouter(
  config: RouterConfig,
  providers: Map<string, LLMProvider>,
): LLMRouter {
  const retries = config.retries ?? 2;

  async function callWithFallback<T>(
    route: RouteConfig,
    fn: (provider: LLMProvider, model: string) => Promise<T>,
  ): Promise<T> {
    // Try primary provider
    const primary = providers.get(route.provider);
    if (!primary) {
      throw new Error(`Provider not found: ${route.provider}`);
    }

    try {
      return await fn(primary, route.model);
    } catch (error) {
      // Try fallback chain
      if (config.fallbackChain) {
        for (const providerName of config.fallbackChain) {
          if (providerName === route.provider) continue;
          const fallback = providers.get(providerName);
          if (!fallback) continue;
          try {
            // Use fallback provider's default model (first in list)
            const models = fallback.listModels();
            const model = models[0]?.id ?? route.model;
            return await fn(fallback, model);
          } catch {
            continue;
          }
        }
      }
      throw error;
    }
  }

  return {
    async chat(taskType, params) {
      const route = config.routes[taskType];
      if (!route) throw new Error(`No route configured for task: ${taskType}`);

      return callWithFallback(route, (provider, model) =>
        provider.chat({
          ...params,
          model,
          maxTokens: params.maxTokens ?? route.maxTokens,
          temperature: params.temperature ?? route.temperature,
        }),
      );
    },

    async chatWithTools(taskType, params) {
      const route = config.routes[taskType];
      if (!route) throw new Error(`No route configured for task: ${taskType}`);

      return callWithFallback(route, (provider, model) =>
        provider.chatWithTools({
          ...params,
          model,
          maxTokens: params.maxTokens ?? route.maxTokens,
          temperature: params.temperature ?? route.temperature,
        }),
      );
    },
  };
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/core/src/index.ts`:

```typescript
export { createLLMRouter, type RouterConfig, type RouteConfig } from "./llm-router.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @gnana/core test`
Expected: All LLM router tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/llm-router.ts packages/core/src/__tests__/llm-router.test.ts packages/core/src/index.ts
git commit -m "feat: @gnana/core — LLM router with fallback chain support"
```

---

## Chunk 3: Pipeline Engine

### Task 7: Pipeline engine

**Files:**

- Create: `packages/core/src/pipeline.ts`
- Create: `packages/core/src/__tests__/pipeline.test.ts`

- [ ] **Step 1: Write pipeline test**

`packages/core/src/__tests__/pipeline.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executePipeline } from "../pipeline.js";
import type { RunContext, Run, AgentDefinition, Plan, ExecutionResult } from "../types.js";
import type { ChatResponse } from "@gnana/provider-base";

function createMockContext(overrides: Partial<RunContext> = {}): RunContext {
  const analysisResponse: ChatResponse = {
    content: [{ type: "text", text: JSON.stringify({ findings: ["test finding"] }) }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    model: "test-model",
  };

  const planResponse: ChatResponse = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          summary: "Test plan",
          steps: [{ order: 1, title: "Step 1", description: "Do something" }],
        }),
      },
    ],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    model: "test-model",
  };

  const executeResponse: ChatResponse = {
    content: [{ type: "text", text: "Step completed successfully" }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    model: "test-model",
  };

  const run: Run = {
    id: "run-1",
    agentId: "agent-1",
    status: "queued",
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const agent: AgentDefinition = {
    id: "agent-1",
    name: "Test Agent",
    description: "A test agent",
    systemPrompt: "You are a test agent",
    tools: [],
    llm: {
      analysis: { provider: "test", model: "test-model" },
      planning: { provider: "test", model: "test-model" },
    },
    triggers: [],
    approval: "auto",
  };

  return {
    run,
    agent,
    trigger: { type: "manual", data: {} },
    llm: {
      chat: vi
        .fn()
        .mockResolvedValueOnce(analysisResponse)
        .mockResolvedValueOnce(planResponse)
        .mockResolvedValue(executeResponse),
      chatWithTools: vi
        .fn()
        .mockResolvedValueOnce(analysisResponse)
        .mockResolvedValueOnce(planResponse)
        .mockResolvedValue(executeResponse),
    },
    tools: {
      execute: vi.fn().mockResolvedValue("tool result"),
      listTools: vi.fn().mockReturnValue([]),
    },
    store: {
      getRun: vi.fn().mockResolvedValue(run),
      updateStatus: vi.fn(),
      updateAnalysis: vi.fn(),
      updatePlan: vi.fn(),
      updateResult: vi.fn(),
      updateError: vi.fn(),
      addTokenUsage: vi.fn(),
    },
    events: {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
    ...overrides,
  };
}

describe("executePipeline", () => {
  it("runs full pipeline with auto-approval", async () => {
    const ctx = createMockContext();
    await executePipeline(ctx);

    expect(ctx.store.updateStatus).toHaveBeenCalledWith("run-1", "analyzing");
    expect(ctx.store.updateStatus).toHaveBeenCalledWith("run-1", "planning");
    expect(ctx.store.updateStatus).toHaveBeenCalledWith("run-1", "executing");
    expect(ctx.store.updateStatus).toHaveBeenCalledWith("run-1", "completed");
    expect(ctx.events.emit).toHaveBeenCalledWith("run:started", ctx.run);
    expect(ctx.events.emit).toHaveBeenCalledWith("run:completed", expect.anything());
  });

  it("pauses at approval gate when approval is required", async () => {
    const ctx = createMockContext();
    ctx.agent.approval = "required";

    await executePipeline(ctx);

    expect(ctx.store.updateStatus).toHaveBeenCalledWith("run-1", "awaiting_approval");
    expect(ctx.events.emit).toHaveBeenCalledWith("run:awaiting_approval", ctx.run);
    // Should NOT proceed to executing
    expect(ctx.store.updateStatus).not.toHaveBeenCalledWith("run-1", "executing");
  });

  it("sets status to failed on error", async () => {
    const ctx = createMockContext();
    (ctx.llm.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM failed"));

    await executePipeline(ctx);

    expect(ctx.store.updateStatus).toHaveBeenCalledWith("run-1", "failed");
    expect(ctx.store.updateError).toHaveBeenCalledWith("run-1", "LLM failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gnana/core test`
Expected: FAIL — `executePipeline` not found.

- [ ] **Step 3: Implement pipeline**

`packages/core/src/pipeline.ts`:

````typescript
import type { RunContext, Plan, ExecutionResult, StepResult } from "./types.js";
import type { ContentBlock, ToolUseBlock, Message } from "@gnana/provider-base";
import { runHook } from "./hooks.js";

function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function tryParseJson<T>(text: string): T | null {
  // Try to extract JSON from markdown code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

async function analyzePhase(ctx: RunContext): Promise<unknown> {
  const messages: Message[] = [
    {
      role: "user",
      content: `Analyze this task and provide findings as JSON:\n\n${JSON.stringify(ctx.trigger.data)}`,
    },
  ];

  const tools = ctx.tools.listTools();
  let analysis: unknown;

  if (tools.length > 0) {
    // Multi-turn tool calling loop
    let rounds = 0;
    const maxRounds = ctx.agent.maxToolRounds ?? 10;

    while (rounds < maxRounds) {
      const response = await ctx.llm.chatWithTools("analysis", {
        systemPrompt: ctx.agent.systemPrompt,
        messages,
        tools,
      });
      await ctx.store.addTokenUsage(ctx.run.id, response.usage);

      if (response.stopReason === "end_turn") {
        analysis = tryParseJson(extractText(response.content)) ?? extractText(response.content);
        break;
      }

      // Handle tool calls
      const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      messages.push({ role: "assistant", content: response.content });

      const toolResults: ContentBlock[] = [];
      for (const toolUse of toolUses) {
        await ctx.events.emit("run:tool_called", { toolName: toolUse.name, input: toolUse.input });
        const result = await ctx.tools.execute(toolUse.name, toolUse.input, {
          runId: ctx.run.id,
          agentId: ctx.agent.id,
        });
        await ctx.events.emit("run:tool_result", { toolName: toolUse.name, result });
        toolResults.push({ type: "tool_result", toolUseId: toolUse.id, content: result });
      }
      messages.push({ role: "user", content: toolResults });
      rounds++;
    }
  } else {
    const response = await ctx.llm.chat("analysis", {
      systemPrompt: ctx.agent.systemPrompt,
      messages,
    });
    await ctx.store.addTokenUsage(ctx.run.id, response.usage);
    analysis = tryParseJson(extractText(response.content)) ?? extractText(response.content);
  }

  return analysis;
}

async function planPhase(ctx: RunContext, analysis: unknown): Promise<Plan> {
  const messages: Message[] = [
    {
      role: "user",
      content: `Based on this analysis, create an execution plan as JSON with shape { summary: string, steps: [{ order: number, title: string, description: string }], reasoning?: string }:\n\n${JSON.stringify(analysis)}`,
    },
  ];

  const response = await ctx.llm.chat("planning", {
    systemPrompt: ctx.agent.systemPrompt,
    messages,
  });
  await ctx.store.addTokenUsage(ctx.run.id, response.usage);

  const text = extractText(response.content);
  const plan = tryParseJson<Plan>(text);
  if (!plan) {
    return { summary: text, steps: [{ order: 1, title: "Execute", description: text }] };
  }
  return plan;
}

async function executePhase(ctx: RunContext, plan: Plan): Promise<ExecutionResult> {
  const stepResults: StepResult[] = [];

  for (const step of plan.steps) {
    const messages: Message[] = [
      {
        role: "user",
        content: `Execute this step: ${step.title}\n\n${step.description}`,
      },
    ];

    const taskType = ctx.agent.llm.execution ? "execution" : "analysis";
    const response = await ctx.llm.chat(taskType, {
      systemPrompt: ctx.agent.systemPrompt,
      messages,
    });
    await ctx.store.addTokenUsage(ctx.run.id, response.usage);

    stepResults.push({
      stepOrder: step.order,
      status: "completed",
      output: extractText(response.content),
    });
  }

  return {
    status: "completed",
    stepResults,
    artifacts: [],
  };
}

export async function executePipeline(ctx: RunContext): Promise<void> {
  try {
    await ctx.events.emit("run:started", ctx.run);
    await runHook(ctx.agent.hooks, "onRunStart", ctx);

    // 1. Analysis
    await ctx.store.updateStatus(ctx.run.id, "analyzing");
    await ctx.events.emit("run:status_changed", { runId: ctx.run.id, status: "analyzing" });
    const analysis = await analyzePhase(ctx);
    await ctx.store.updateAnalysis(ctx.run.id, analysis);
    await ctx.events.emit("run:analysis_complete", { runId: ctx.run.id, analysis });
    await runHook(ctx.agent.hooks, "onAnalysisComplete", ctx, analysis);

    // 2. Planning
    await ctx.store.updateStatus(ctx.run.id, "planning");
    await ctx.events.emit("run:status_changed", { runId: ctx.run.id, status: "planning" });
    const plan = await planPhase(ctx, analysis);
    await ctx.store.updatePlan(ctx.run.id, plan);
    await ctx.events.emit("run:plan_complete", { runId: ctx.run.id, plan });
    await runHook(ctx.agent.hooks, "onPlanComplete", ctx, plan);

    // 3. Approval gate
    if (ctx.agent.approval === "required") {
      await ctx.store.updateStatus(ctx.run.id, "awaiting_approval");
      await ctx.events.emit("run:awaiting_approval", ctx.run);
      return; // Pipeline pauses — resumed by approve/reject API call
    }

    // 4. Execute (auto-approved)
    await ctx.store.updateStatus(ctx.run.id, "executing");
    await ctx.events.emit("run:status_changed", { runId: ctx.run.id, status: "executing" });
    const result = await executePhase(ctx, plan);
    await ctx.store.updateResult(ctx.run.id, result);
    await ctx.store.updateStatus(ctx.run.id, "completed");
    await ctx.events.emit("run:completed", { runId: ctx.run.id, result });
    await runHook(ctx.agent.hooks, "onExecutionComplete", ctx, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.store.updateError(ctx.run.id, message);
    await ctx.store.updateStatus(ctx.run.id, "failed");
    await ctx.events.emit("run:failed", { runId: ctx.run.id, error: message });
    await runHook(
      ctx.agent.hooks,
      "onError",
      ctx,
      error instanceof Error ? error : new Error(message),
    );
  }
}

export async function resumePipeline(ctx: RunContext, plan: Plan): Promise<void> {
  try {
    await ctx.store.updateStatus(ctx.run.id, "executing");
    await ctx.events.emit("run:status_changed", { runId: ctx.run.id, status: "executing" });
    await runHook(ctx.agent.hooks, "onApproval", ctx);

    const result = await executePhase(ctx, plan);
    await ctx.store.updateResult(ctx.run.id, result);
    await ctx.store.updateStatus(ctx.run.id, "completed");
    await ctx.events.emit("run:completed", { runId: ctx.run.id, result });
    await runHook(ctx.agent.hooks, "onExecutionComplete", ctx, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.store.updateError(ctx.run.id, message);
    await ctx.store.updateStatus(ctx.run.id, "failed");
    await ctx.events.emit("run:failed", { runId: ctx.run.id, error: message });
    await runHook(
      ctx.agent.hooks,
      "onError",
      ctx,
      error instanceof Error ? error : new Error(message),
    );
  }
}
````

- [ ] **Step 4: Export from index.ts**

Add to `packages/core/src/index.ts`:

```typescript
export { executePipeline, resumePipeline } from "./pipeline.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @gnana/core test`
Expected: All pipeline tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline.ts packages/core/src/__tests__/pipeline.test.ts packages/core/src/index.ts
git commit -m "feat: @gnana/core — pipeline engine with analyze, plan, approve, execute phases"
```

---

## Chunk 4: LLM Providers

### Task 8: Anthropic provider

**Files:**

- Create: `packages/providers/anthropic/package.json`
- Create: `packages/providers/anthropic/tsconfig.json`
- Create: `packages/providers/anthropic/src/index.ts`
- Create: `packages/providers/anthropic/src/__tests__/anthropic.test.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@gnana/provider-anthropic",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "dev": "tsup src/index.ts --format esm --dts --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@gnana/provider-base": "workspace:*"
  },
  "devDependencies": {
    "tsup": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write test** (tests use mocked SDK — no API key needed)

`packages/providers/anthropic/src/__tests__/anthropic.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicProvider } from "../index.js";

// Mock the SDK
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "Hello from Claude" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
          model: "claude-sonnet-4-20250514",
        }),
      },
    })),
  };
});

describe("AnthropicProvider", () => {
  it("has correct name", () => {
    const provider = new AnthropicProvider("test-key");
    expect(provider.name).toBe("anthropic");
  });

  it("normalizes chat response", async () => {
    const provider = new AnthropicProvider("test-key");
    const result = await provider.chat({
      model: "claude-sonnet-4-20250514",
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(result.content).toEqual([{ type: "text", text: "Hello from Claude" }]);
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("lists known models", () => {
    const provider = new AnthropicProvider("test-key");
    const models = provider.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id.includes("claude"))).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm install && pnpm --filter @gnana/provider-anthropic test`
Expected: FAIL — `AnthropicProvider` not found.

- [ ] **Step 5: Implement provider**

`packages/providers/anthropic/src/index.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  ChatParams,
  ToolChatParams,
  ChatResponse,
  ChatResponseChunk,
  ContentBlock,
  ModelInfo,
  StopReason,
} from "@gnana/provider-base";

function normalizeStopReason(reason: string): StopReason {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  return "end_turn";
}

function normalizeContent(content: Anthropic.ContentBlock[]): ContentBlock[] {
  return content.map((block) => {
    if (block.type === "text") {
      return { type: "text" as const, text: block.text };
    }
    if (block.type === "tool_use") {
      return {
        type: "tool_use" as const,
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      };
    }
    return { type: "text" as const, text: JSON.stringify(block) };
  });
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const response = await this.client.messages.create({
      model: params.model,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature,
    });

    return {
      content: normalizeContent(response.content),
      stopReason: normalizeStopReason(response.stop_reason ?? "end_turn"),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
    };
  }

  async chatWithTools(params: ToolChatParams): Promise<ChatResponse> {
    const response = await this.client.messages.create({
      model: params.model,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({
        role: m.role,
        content:
          typeof m.content === "string"
            ? m.content
            : m.content.map((b) => {
                if (b.type === "tool_result") {
                  return {
                    type: "tool_result" as const,
                    tool_use_id: b.toolUseId,
                    content: b.content,
                  };
                }
                if (b.type === "tool_use") {
                  return { type: "tool_use" as const, id: b.id, name: b.name, input: b.input };
                }
                return { type: "text" as const, text: b.text };
              }),
      })),
      tools: params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      })),
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature,
    });

    return {
      content: normalizeContent(response.content),
      stopReason: normalizeStopReason(response.stop_reason ?? "end_turn"),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
    };
  }

  async *chatStream(params: ChatParams): AsyncIterable<ChatResponseChunk> {
    const stream = this.client.messages.stream({
      model: params.model,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text_delta", text: event.delta.text };
      }
    }

    const finalMessage = await stream.finalMessage();
    yield {
      type: "done",
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      },
    };
  }

  async *chatWithToolsStream(params: ToolChatParams): AsyncIterable<ChatResponseChunk> {
    // Delegate to chatStream for now — full tool streaming is complex
    yield* this.chatStream(params);
  }

  listModels(): ModelInfo[] {
    return [
      {
        id: "claude-opus-4-20250514",
        name: "Claude Opus 4",
        contextWindow: 200000,
        maxOutputTokens: 32000,
      },
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        contextWindow: 200000,
        maxOutputTokens: 16000,
      },
      {
        id: "claude-haiku-4-20250514",
        name: "Claude Haiku 4",
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
    ];
  }
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @gnana/provider-anthropic test`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/providers/anthropic/
git commit -m "feat: @gnana/provider-anthropic — Claude provider with tool support"
```

---

### Task 9: Google provider

**Files:**

- Create: `packages/providers/google/package.json`
- Create: `packages/providers/google/tsconfig.json`
- Create: `packages/providers/google/src/index.ts`
- Create: `packages/providers/google/src/__tests__/google.test.ts`

- [ ] **Step 1: Create package.json**

Same structure as anthropic, but with `"@google/genai": "^1.0.0"` dependency instead of `@anthropic-ai/sdk`.

- [ ] **Step 2: Create tsconfig.json** (same as anthropic)

- [ ] **Step 3: Write test** (mock @google/genai SDK)

`packages/providers/google/src/__tests__/google.test.ts` — same pattern as anthropic tests, mock the SDK, verify normalization.

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm install && pnpm --filter @gnana/provider-google test`

- [ ] **Step 5: Implement GoogleProvider**

`packages/providers/google/src/index.ts`:

- Import from `@google/genai`
- Implement `LLMProvider` interface
- Normalize `generateContent` responses to `ChatResponse`
- Map `functionCall` / `functionResponse` to our `ToolUseBlock` / `ToolResultBlock`
- List models: `gemini-2.5-pro`, `gemini-2.5-flash`

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Commit**

```bash
git add packages/providers/google/
git commit -m "feat: @gnana/provider-google — Gemini provider with function calling"
```

---

### Task 10: OpenAI provider (+ OpenRouter)

**Files:**

- Create: `packages/providers/openai/package.json`
- Create: `packages/providers/openai/tsconfig.json`
- Create: `packages/providers/openai/src/index.ts`
- Create: `packages/providers/openai/src/__tests__/openai.test.ts`

- [ ] **Step 1: Create package.json**

Same structure, with `"openai": "^4.77.0"` dependency.

- [ ] **Step 2: Create tsconfig.json** (same pattern)

- [ ] **Step 3: Write test** (mock openai SDK, test both OpenAI and OpenRouter modes)

`packages/providers/openai/src/__tests__/openai.test.ts`:

- Test normal OpenAI usage
- Test OpenRouter mode (different baseURL, same SDK)
- Verify function calling normalization

- [ ] **Step 4: Run test to verify it fails**

- [ ] **Step 5: Implement OpenAIProvider**

`packages/providers/openai/src/index.ts`:

- Constructor accepts `apiKey` and optional `options: { baseURL?: string }`
- OpenRouter uses `baseURL: "https://openrouter.ai/api/v1"`
- Normalize `chat.completions.create` responses
- Map `tool_calls` to `ToolUseBlock`
- List models: GPT-4.1, o3-mini (or empty for OpenRouter — too many)

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Commit**

```bash
git add packages/providers/openai/
git commit -m "feat: @gnana/provider-openai — OpenAI + OpenRouter provider"
```

---

## Chunk 5: Database Schema

### Task 11: @gnana/db — Drizzle schema

**Files:**

- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema/workspaces.ts`
- Create: `packages/db/src/schema/agents.ts`
- Create: `packages/db/src/schema/runs.ts`
- Create: `packages/db/src/schema/connectors.ts`
- Create: `packages/db/src/schema/providers.ts`
- Create: `packages/db/src/schema/api-keys.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@gnana/db",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "dev": "tsup src/index.ts --format esm --dts --watch",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "drizzle-orm": "^0.38.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.0",
    "tsup": "workspace:*",
    "typescript": "workspace:*"
  }
}
```

- [ ] **Step 2: Create tsconfig.json and drizzle.config.ts**

`packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src", "drizzle.config.ts"]
}
```

`packages/db/drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 3: Write workspaces schema**

`packages/db/src/schema/workspaces.ts`:

```typescript
import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Write agents schema**

`packages/db/src/schema/agents.ts`:

```typescript
import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").notNull().default(""),
    systemPrompt: text("system_prompt").notNull(),
    toolsConfig: jsonb("tools_config").notNull().default({}),
    llmConfig: jsonb("llm_config").notNull(),
    triggersConfig: jsonb("triggers_config").notNull().default([]),
    approval: varchar("approval", { length: 20 }).notNull().default("required"),
    hooksConfig: jsonb("hooks_config"),
    maxToolRounds: varchar("max_tool_rounds").$type<number>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agents_workspace_idx").on(table.workspaceId)],
);
```

- [ ] **Step 5: Write runs schema**

`packages/db/src/schema/runs.ts`:

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { workspaces } from "./workspaces.js";

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 30 }).notNull().default("queued"),
    triggerType: varchar("trigger_type", { length: 30 }).notNull(),
    triggerData: jsonb("trigger_data").notNull().default({}),
    analysis: jsonb("analysis"),
    plan: jsonb("plan"),
    result: jsonb("result"),
    error: text("error"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("runs_agent_idx").on(table.agentId),
    index("runs_status_idx").on(table.status),
    index("runs_workspace_idx").on(table.workspaceId),
  ],
);

export const runLogs = pgTable(
  "run_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 30 }).notNull(),
    type: varchar("type", { length: 30 }).notNull(), // "tool_call", "tool_result", "llm_call", "status_change"
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("run_logs_run_idx").on(table.runId)],
);
```

- [ ] **Step 6: Write connectors, providers, and api-keys schemas**

`packages/db/src/schema/connectors.ts` — connectors + connector_tools tables.
`packages/db/src/schema/providers.ts` — providers table (name, type, encrypted credentials).
`packages/db/src/schema/api-keys.ts` — api_keys table (key hash, workspace, scopes).

- [ ] **Step 7: Create barrel exports**

`packages/db/src/schema/index.ts`:

```typescript
export * from "./workspaces.js";
export * from "./agents.js";
export * from "./runs.js";
export * from "./connectors.js";
export * from "./providers.js";
export * from "./api-keys.js";
```

`packages/db/src/index.ts`:

```typescript
export * from "./schema/index.js";
```

- [ ] **Step 8: Build and verify**

Run: `pnpm install && pnpm --filter @gnana/db build`
Expected: Clean build.

- [ ] **Step 9: Commit**

```bash
git add packages/db/
git commit -m "feat: @gnana/db — Drizzle schema for agents, runs, connectors, providers, api keys"
```

---

## Chunk 6: Hono Server

### Task 12: Server scaffold and auth middleware

**Files:**

- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/index.ts`
- Create: `packages/server/src/middleware/auth.ts`
- Create: `packages/server/src/__tests__/middleware/auth.test.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@gnana/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "dev": "tsx watch src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@gnana/core": "workspace:*",
    "@gnana/db": "workspace:*",
    "@gnana/provider-base": "workspace:*",
    "drizzle-orm": "^0.38.0",
    "hono": "^4.6.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "tsup": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

- [ ] **Step 2: Create tsconfig.json** (extends ../../tsconfig.base.json)

- [ ] **Step 3: Write auth middleware test**

`packages/server/src/__tests__/middleware/auth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { apiKeyAuth } from "../../middleware/auth.js";

describe("apiKeyAuth", () => {
  it("returns 401 without Authorization header", async () => {
    const app = new Hono();
    app.use("/*", apiKeyAuth("test-secret"));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong key", async () => {
    const app = new Hono();
    app.use("/*", apiKeyAuth("test-secret"));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { Authorization: "Bearer wrong-key" },
    });
    expect(res.status).toBe(401);
  });

  it("allows request with correct key", async () => {
    const app = new Hono();
    app.use("/*", apiKeyAuth("test-secret"));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

- [ ] **Step 5: Implement auth middleware**

`packages/server/src/middleware/auth.ts`:

```typescript
import type { MiddlewareHandler } from "hono";

export function apiKeyAuth(secret: string): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== secret) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  };
}
```

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Commit**

```bash
git add packages/server/
git commit -m "feat: @gnana/server — Hono scaffold with API key auth middleware"
```

---

### Task 13: Agent CRUD routes

**Files:**

- Create: `packages/server/src/routes/agents.ts`
- Create: `packages/server/src/__tests__/routes/agents.test.ts`

- [ ] **Step 1: Write agent routes test**

Tests for: POST /api/agents, GET /api/agents, GET /api/agents/:id, PUT /api/agents/:id, DELETE /api/agents/:id.
Use Hono's `app.request()` for in-memory testing (no real server needed).
Mock the database layer.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement agent routes**

Standard CRUD using Drizzle queries. Validate input with Hono's built-in validators or manual checks.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/agents.ts packages/server/src/__tests__/routes/agents.test.ts
git commit -m "feat: @gnana/server — agent CRUD API routes"
```

---

### Task 14: Run management routes

**Files:**

- Create: `packages/server/src/routes/runs.ts`
- Create: `packages/server/src/__tests__/routes/runs.test.ts`

- [ ] **Step 1: Write run routes test**

Tests for: POST /api/runs (trigger), GET /api/runs, GET /api/runs/:id, POST /api/runs/:id/approve, POST /api/runs/:id/reject, POST /api/runs/:id/cancel.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement run routes**

POST /api/runs creates a run record, then kicks off `executePipeline` from `@gnana/core` asynchronously.
Approve/reject update status and resume/reject the pipeline.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/runs.ts packages/server/src/__tests__/routes/runs.test.ts
git commit -m "feat: @gnana/server — run management routes with pipeline integration"
```

---

### Task 15: WebSocket subscriptions

**Files:**

- Create: `packages/server/src/ws/runs.ts`

- [ ] **Step 1: Implement WebSocket handler**

`packages/server/src/ws/runs.ts`:

- Use Hono's `upgradeWebSocket` helper
- Subscribe to EventBus events for a specific run ID
- Push JSON messages to connected clients on status changes
- Handle cleanup on disconnect

- [ ] **Step 2: Wire into app.ts**

Create `packages/server/src/app.ts`:

- Mount agent routes at `/api/agents`
- Mount run routes at `/api/runs`
- Mount WebSocket at `/ws/runs/:id`
- Apply auth middleware to `/api/*`

- [ ] **Step 3: Create server factory**

`packages/server/src/index.ts`:

```typescript
export { createGnanaServer } from "./app.js";
```

The `createGnanaServer` function accepts config (port, database URL, providers, router config) and returns a start-able server.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/ws/ packages/server/src/app.ts packages/server/src/index.ts
git commit -m "feat: @gnana/server — WebSocket subscriptions and server factory"
```

---

## Chunk 7: Client SDK

### Task 16: @gnana/client — TypeScript SDK

**Files:**

- Create: `packages/client/package.json`
- Create: `packages/client/tsconfig.json`
- Create: `packages/client/src/client.ts`
- Create: `packages/client/src/resources/agents.ts`
- Create: `packages/client/src/resources/runs.ts`
- Create: `packages/client/src/resources/connectors.ts`
- Create: `packages/client/src/index.ts`
- Create: `packages/client/src/__tests__/client.test.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@gnana/client",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "dev": "tsup src/index.ts --format esm --dts --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "tsup": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

- [ ] **Step 2: Create tsconfig.json** (extends ../../tsconfig.base.json)

- [ ] **Step 3: Write client test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GnanaClient } from "../client.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("GnanaClient", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("creates client with url and apiKey", () => {
    const client = new GnanaClient({ url: "http://localhost:4000", apiKey: "test" });
    expect(client.agents).toBeDefined();
    expect(client.runs).toBeDefined();
  });

  it("agents.list() calls GET /api/agents", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const client = new GnanaClient({ url: "http://localhost:4000", apiKey: "test" });
    await client.agents.list();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:4000/api/agents",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test" }),
      }),
    );
  });

  it("runs.trigger() calls POST /api/runs", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ id: "run-1", status: "queued" }), { status: 201 }),
    );
    const client = new GnanaClient({ url: "http://localhost:4000", apiKey: "test" });
    const run = await client.runs.trigger({ agentId: "agent-1", payload: { data: "test" } });
    expect(run.id).toBe("run-1");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

- [ ] **Step 5: Implement client**

`packages/client/src/client.ts`:

```typescript
import { AgentsResource } from "./resources/agents.js";
import { RunsResource } from "./resources/runs.js";
import { ConnectorsResource } from "./resources/connectors.js";

export interface GnanaClientConfig {
  url: string;
  apiKey: string;
}

export class GnanaClient {
  readonly agents: AgentsResource;
  readonly runs: RunsResource;
  readonly connectors: ConnectorsResource;
  private baseUrl: string;
  private apiKey: string;

  constructor(config: GnanaClientConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    const fetcher = this.fetch.bind(this);
    this.agents = new AgentsResource(fetcher);
    this.runs = new RunsResource(fetcher, this.baseUrl, this.apiKey);
    this.connectors = new ConnectorsResource(fetcher);
  }

  async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    return fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...options.headers,
      },
    });
  }
}
```

Implement `AgentsResource`, `RunsResource`, `ConnectorsResource` as thin wrappers over fetch calls to the respective API endpoints. `RunsResource` includes a `subscribe(runId, callback)` method that opens a WebSocket connection.

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Commit**

```bash
git add packages/client/
git commit -m "feat: @gnana/client — TypeScript SDK with agents, runs, connectors resources"
```

---

## Chunk 8: Integration and Verification

### Task 17: Full build and integration verification

**Files:**

- Modify: `packages/core/src/index.ts` (ensure all exports)

- [ ] **Step 1: Run full monorepo build**

Run: `pnpm build`
Expected: All packages build successfully with Turborepo.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests pass across all packages.

- [ ] **Step 3: Run type checking**

Run: `pnpm typecheck`
Expected: No TypeScript errors.

- [ ] **Step 4: Run formatter**

Run: `pnpm format:check`
Expected: All files formatted (or run `pnpm format` to fix).

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "chore: Phase 1 complete — full build, tests, and typecheck passing"
```

---

## Summary

| Chunk                  | Tasks | What it delivers                                                                         |
| ---------------------- | ----- | ---------------------------------------------------------------------------------------- |
| 1: Monorepo Foundation | 1-3   | pnpm workspace, Turborepo, shared TS config, provider base types, core types + event bus |
| 2: Core Components     | 4-6   | Hook system, tool executor, LLM router — all with tests                                  |
| 3: Pipeline Engine     | 7     | 4-phase pipeline with tool calling, approval gate, error handling                        |
| 4: LLM Providers       | 8-10  | Anthropic, Google, OpenAI/OpenRouter providers — all with tests                          |
| 5: Database Schema     | 11    | Full Drizzle schema for agents, runs, connectors, providers, API keys                    |
| 6: Hono Server         | 12-15 | REST API (agents, runs), WebSocket, auth middleware — all with tests                     |
| 7: Client SDK          | 16    | TypeScript client with fetch + WebSocket subscription                                    |
| 8: Integration         | 17    | Full build, test, typecheck verification                                                 |
