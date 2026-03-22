# Gnana Agent Framework — Design Specification

## Context

Gnanalytica PM has a working in-app agent ("Gnana") that analyzes tickets, finds duplicates, creates plans, and waits for approval. The next step is to extract this into a **standalone, general-purpose agent framework** that:

1. Serves as Gnanalytica's internal AI infrastructure
2. Can be released as an open-source framework
3. Can be offered as a hosted SaaS product

The framework must be provider-agnostic (Anthropic, Google Gemini, OpenAI, OpenRouter, open-source), support both MCP and custom tools, and include a **no-code agent builder UI** for non-developers.

**Name:** Gnana (Sanskrit for knowledge/wisdom)

---

## Architecture Overview

```
gnana/                              (separate repo, pnpm monorepo)
├── packages/
│   ├── core/                       # Agent runtime, pipeline, tool system
│   ├── server/                     # HTTP + WebSocket server (Hono)
│   ├── client/                     # TypeScript SDK for consumers
│   ├── db/                         # Database schema + migrations (Drizzle ORM)
│   ├── providers/
│   │   ├── anthropic/              # Claude provider
│   │   ├── google/                 # Gemini provider
│   │   ├── openai/                 # OpenAI + OpenRouter provider
│   │   └── base/                   # Shared provider interface + helpers
│   ├── mcp/                        # MCP client adapter
│   └── connectors/                 # Pre-built integration connectors
│       ├── github/
│       ├── slack/
│       ├── notion/
│       ├── postgres/
│       └── http/                   # Generic REST API connector
└── apps/
    └── dashboard/                  # No-code agent builder (Next.js)
```

**Monorepo tooling:** pnpm workspaces + Turborepo for builds/caching.

### System Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        CONSUMERS                                  │
│  Gnanalytica PM    CRM App    Slack Bot    Dashboard UI           │
│       │               │           │             │                 │
│       └───────────────┴───────────┴─────────────┘                 │
│                           │                                       │
│                    @gnana/client SDK                               │
│                    (HTTP + WebSocket)                              │
└───────────────────────────┬──────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│                      GNANA SERVER                                 │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │  REST API    │  │  WebSocket   │  │  Dashboard (Next.js)    │ │
│  │  /api/*      │  │  /ws/*       │  │  Agent Builder UI       │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────────┘ │
│         │                 │                      │                │
│  ┌──────▼─────────────────▼──────────────────────▼──────────────┐│
│  │                    AGENT RUNTIME (@gnana/core)                ││
│  │                                                               ││
│  │  ┌────────────┐  ┌──────────────┐  ┌───────────────────────┐ ││
│  │  │ Pipeline    │  │ LLM Router   │  │ Tool Executor         │ ││
│  │  │ Engine      │  │              │  │                       │ ││
│  │  │ analyze →   │  │ Anthropic    │  │ MCP Client            │ ││
│  │  │ plan →      │  │ Gemini       │  │ Custom Handlers       │ ││
│  │  │ approve →   │  │ OpenAI       │  │ Connector Registry    │ ││
│  │  │ execute     │  │ OpenRouter   │  │                       │ ││
│  │  └────────────┘  └──────────────┘  └───────────────────────┘ ││
│  │                                                               ││
│  │  ┌────────────┐  ┌──────────────┐  ┌───────────────────────┐ ││
│  │  │ Hook System │  │ Run Store    │  │ Event Bus             │ ││
│  │  │ lifecycle   │  │ (Postgres)   │  │ (in-process pub/sub)  │ ││
│  │  │ callbacks   │  │ via Drizzle  │  │ + WebSocket push      │ ││
│  │  └────────────┘  └──────────────┘  └───────────────────────┘ ││
│  └───────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

---

## Package Details

### @gnana/core — Agent Runtime

The stateless orchestration engine. No server, no database — pure logic.

**Agent Definition:**
```typescript
interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;               // identity + instructions
  tools: ToolDefinition[];            // custom tool handlers
  mcpServers?: MCPServerConfig[];     // MCP connections
  llm: {
    analysis: ModelConfig;            // model for analysis phase
    planning: ModelConfig;            // model for planning phase
    execution?: ModelConfig;          // model for execution phase
  };
  triggers: TriggerConfig[];          // when to activate
  approval: "required" | "auto" | "conditional";
  hooks?: AgentHooks;                 // lifecycle callbacks
  maxToolRounds?: number;             // default: 10
}

interface ModelConfig {
  provider: string;                   // "anthropic" | "google" | "openai" | "openrouter"
  model: string;                      // "claude-sonnet-4-20250514" | "gemini-2.5-flash" etc.
  maxTokens?: number;
  temperature?: number;
}

interface TriggerConfig {
  type: "assignment" | "mention" | "webhook" | "cron" | "manual";
  config?: Record<string, unknown>;   // cron expression, webhook path, etc.
}
```

**Pipeline Engine:**

The pipeline processes runs through deterministic stages. Each stage is a function that receives context and returns the next state.

```typescript
type PipelineStage = "queued" | "analyzing" | "planning" | "awaiting_approval"
                   | "approved" | "executing" | "completed" | "failed" | "rejected";

interface RunContext {
  run: Run;
  agent: AgentDefinition;
  trigger: TriggerPayload;
  llm: LLMRouter;
  tools: ToolExecutor;
  store: RunStore;
  events: EventBus;
}

// Core pipeline function
async function executePipeline(ctx: RunContext): Promise<void> {
  await ctx.events.emit("run:started", ctx.run);

  // 1. Analysis — multi-turn tool calling
  await ctx.store.updateStatus(ctx.run.id, "analyzing");
  const analysis = await analyzePhase(ctx);
  await ctx.store.updateAnalysis(ctx.run.id, analysis);

  // 2. Planning — structured output
  await ctx.store.updateStatus(ctx.run.id, "planning");
  const plan = await planPhase(ctx, analysis);
  await ctx.store.updatePlan(ctx.run.id, plan);

  // 3. Approval gate
  if (ctx.agent.approval === "required") {
    await ctx.store.updateStatus(ctx.run.id, "awaiting_approval");
    await ctx.events.emit("run:awaiting_approval", ctx.run);
    return; // Pipeline pauses here — resumed by approve/reject API call
  }

  // 4. Auto-approve → execute
  await executePhase(ctx, plan);
}
```

**Tool System — MCP + Custom:**

```typescript
// Custom tool handler
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: (input: unknown, ctx: ToolContext) => Promise<string>;
}

// MCP server connection
interface MCPServerConfig {
  name: string;
  transport: "stdio" | "http";
  command?: string;          // for stdio: command to run
  url?: string;              // for http: server URL
  env?: Record<string, string>;
}

// Tool executor merges both sources into a unified interface
class ToolExecutor {
  private customTools: Map<string, ToolDefinition>;
  private mcpClients: Map<string, MCPClient>;

  async execute(toolName: string, input: unknown): Promise<string>;
  listTools(): LLMToolDef[];  // unified list for LLM
}
```

**Hook System:**

```typescript
interface AgentHooks {
  // Run lifecycle
  onRunStart?: (ctx: RunContext) => Promise<void>;
  onAnalysisComplete?: (ctx: RunContext, analysis: unknown) => Promise<void>;
  onPlanComplete?: (ctx: RunContext, plan: Plan) => Promise<void>;
  onApproval?: (ctx: RunContext) => Promise<void>;
  onRejection?: (ctx: RunContext, reason?: string) => Promise<void>;
  onExecutionComplete?: (ctx: RunContext, result: unknown) => Promise<void>;
  onError?: (ctx: RunContext, error: Error) => Promise<void>;

  // Tool lifecycle
  beforeToolCall?: (toolName: string, input: unknown) => Promise<unknown>;
  afterToolCall?: (toolName: string, input: unknown, result: string) => Promise<string>;
}
```

Hooks are how consumers customize behavior. Gnanalytica PM uses `onPlanComplete` to post a comment, `onApproval` to update ticket status, etc.

**Event Bus:**

In-process pub/sub for decoupled communication. The server layer subscribes to events and pushes them via WebSocket.

```typescript
interface EventBus {
  emit(event: string, data: unknown): Promise<void>;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
}

// Events emitted by the runtime:
// "run:started", "run:status_changed", "run:analysis_complete",
// "run:plan_complete", "run:awaiting_approval", "run:approved",
// "run:rejected", "run:executing", "run:completed", "run:failed",
// "run:tool_called", "run:tool_result"
```

---

### @gnana/providers/* — LLM Providers

**Shared interface (`@gnana/providers/base`):**

```typescript
interface LLMProvider {
  name: string;
  chat(params: ChatParams): Promise<ChatResponse>;
  chatWithTools(params: ToolChatParams): Promise<ChatResponse>;
  listModels(): ModelInfo[];
}

interface ChatParams {
  model: string;
  systemPrompt: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
}

interface ChatResponse {
  content: ResponseBlock[];          // text + tool_use blocks
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}
```

**Built-in providers:**

| Package | Provider | SDK | Notes |
|---------|----------|-----|-------|
| `@gnana/provider-anthropic` | Anthropic | `@anthropic-ai/sdk` | Claude Sonnet/Opus/Haiku. Native tool_use. |
| `@gnana/provider-google` | Google | `@google/genai` | Gemini 2.5 Pro/Flash. Function calling. |
| `@gnana/provider-openai` | OpenAI | `openai` | GPT-4.1, o3/o4-mini. Function calling. |
| `@gnana/provider-openrouter` | OpenRouter | `openai` (compat) | 200+ models. Same OpenAI SDK, different base URL. Covers Llama, Mistral, DeepSeek, Qwen, etc. |

Each provider normalizes its SDK's response format to the shared `ChatResponse` interface. Adding a new provider = implement `LLMProvider` interface (~100 lines).

**LLM Router:**

```typescript
interface RouteConfig {
  provider: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

interface RouterConfig {
  routes: Record<string, RouteConfig>;  // task → provider/model
  fallbackChain?: string[];             // provider names in priority order
  retries?: number;                     // default: 2
}

class LLMRouter {
  constructor(config: RouterConfig, providers: Map<string, LLMProvider>);

  // Route a request to the right provider
  async chat(taskType: string, params: Omit<ChatParams, "model">): Promise<ChatResponse>;
  async chatWithTools(taskType: string, params: Omit<ToolChatParams, "model">): Promise<ChatResponse>;
}
```

Fallback chain: if Anthropic fails (rate limit, outage), automatically try Google, then OpenAI. Configurable per deployment.

---

### @gnana/server — HTTP + WebSocket Server

Built on **Hono** (lightweight, fast, runs anywhere — Node.js, Bun, Deno, Edge).

**API Routes:**

```
# Agent management
POST   /api/agents                    Create agent definition
GET    /api/agents                    List agents
GET    /api/agents/:id                Get agent details
PUT    /api/agents/:id                Update agent
DELETE /api/agents/:id                Delete agent
POST   /api/agents/:id/test           Test agent with sample input

# Run management
POST   /api/runs                      Trigger a new run
GET    /api/runs                      List runs (paginated, filterable)
GET    /api/runs/:id                  Get run with analysis + plan
POST   /api/runs/:id/approve          Approve plan (with optional modifications)
POST   /api/runs/:id/reject           Reject plan (with optional reason)
POST   /api/runs/:id/cancel           Cancel active run
GET    /api/runs/:id/logs             Get execution logs

# Connector management
GET    /api/connectors                List available connector types
POST   /api/connectors                Register connector instance
GET    /api/connectors/:id            Get connector details
POST   /api/connectors/:id/auth       Authenticate (OAuth flow or API key)
GET    /api/connectors/:id/tools      List tools exposed by connector
DELETE /api/connectors/:id            Remove connector
POST   /api/connectors/:id/test       Test connection

# Provider management
GET    /api/providers                 List registered LLM providers
POST   /api/providers                 Register provider + API key
GET    /api/providers/:id/models      List available models
DELETE /api/providers/:id             Remove provider

# WebSocket
WS     /ws/runs/:id                   Subscribe to single run updates
WS     /ws/runs                       Subscribe to all run updates
WS     /ws/agents/:id/runs            Subscribe to agent's run updates
```

**Authentication:**
- API key based (simple `Authorization: Bearer <key>`)
- Keys scoped to workspaces (for multi-tenancy in SaaS mode)
- Dashboard uses session cookies (standard Next.js auth)

**Server startup:**

```typescript
import { createGnanaServer } from "@gnana/server";
import { AnthropicProvider } from "@gnana/provider-anthropic";
import { GoogleProvider } from "@gnana/provider-google";
import { OpenAIProvider } from "@gnana/provider-openai";

const server = createGnanaServer({
  port: 4000,
  database: process.env.DATABASE_URL,     // Postgres connection
  providers: {
    anthropic: new AnthropicProvider(process.env.ANTHROPIC_API_KEY),
    google: new GoogleProvider(process.env.GOOGLE_AI_KEY),
    openai: new OpenAIProvider(process.env.OPENAI_API_KEY),
    openrouter: new OpenAIProvider(process.env.OPENROUTER_API_KEY, {
      baseURL: "https://openrouter.ai/api/v1",
    }),
  },
  defaultRouter: {
    routes: {
      analysis: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      planning: { provider: "google", model: "gemini-2.5-flash" },
      execution: { provider: "openai", model: "gpt-4.1" },
    },
    fallbackChain: ["anthropic", "google", "openai", "openrouter"],
  },
});

server.start();
```

---

### @gnana/client — Consumer SDK

Lightweight TypeScript client for any app to interact with Gnana.

```typescript
import { GnanaClient } from "@gnana/client";

const gnana = new GnanaClient({
  url: "http://localhost:4000",
  apiKey: "gnana_key_xxx",
});

// Trigger a run
const run = await gnana.runs.trigger({
  agentId: "sales-analyst",
  payload: { context: "Generate Q1 sales report", data: { quarter: "Q1" } },
});

// Subscribe to real-time updates
const unsub = gnana.runs.subscribe(run.id, (update) => {
  console.log(update.status);   // "analyzing" → "planning" → "awaiting_approval"
  if (update.plan) renderPlan(update.plan);
});

// Approve/reject
await gnana.runs.approve(run.id);
await gnana.runs.reject(run.id, { reason: "Need more detail on step 3" });

// List agents
const agents = await gnana.agents.list();

// Manage connectors
const connectors = await gnana.connectors.list();
await gnana.connectors.create({ type: "github", config: { token: "xxx" } });
```

---

### @gnana/db — Database Schema

**Using Drizzle ORM** (TypeScript-first, zero-abstraction SQL, great migrations).

**Tables:**

```
agents              Agent definitions (name, prompt, tools config, model routes)
agent_tools         Agent ↔ tool many-to-many
runs                Agent run state (status, analysis, plan, result, tokens)
run_logs            Step-by-step execution log entries
connectors          Registered integration instances (type, auth, config)
connector_tools     Tools exposed by each connector
providers           Registered LLM providers (name, api_key encrypted)
api_keys            API keys for client authentication
workspaces          Multi-tenant workspace isolation (SaaS mode)
```

**Key design decisions:**
- `agents.tools_config` is JSONB — stores the full agent definition including tool list, model routes, triggers
- `runs.analysis` and `runs.plan` are JSONB — flexible structured data
- `connectors.credentials` is encrypted at rest — API keys, OAuth tokens
- All tables have `workspace_id` for multi-tenancy (nullable for self-hosted single-tenant)

---

### apps/dashboard — No-Code Agent Builder

A **Next.js** application served by the Gnana server (or deployed separately).

**Pages:**

```
/                           Dashboard — active runs, recent activity, stats
/agents                     Agent library — list, search, create
/agents/new                 Agent builder wizard
/agents/:id                 Agent detail — config, run history, analytics
/agents/:id/edit            Edit agent definition
/connectors                 Connector hub — available integrations
/connectors/:id             Connector detail — auth, tools, test
/runs                       Run explorer — filter, search, inspect
/runs/:id                   Run detail — analysis, plan, logs, artifacts
/settings                   Workspace settings, API keys, provider config
/settings/providers         LLM provider configuration
/settings/models            Model routing configuration
```

**Agent Builder Wizard (4 steps):**

**Step 1 — Identity:**
- Name, description, avatar
- System prompt (text area with template suggestions)
- "Use template" dropdown (PM Analyst, Code Reviewer, Report Generator, etc.)

**Step 2 — Models:**
- Select model for each phase (analysis, planning, execution)
- Dropdown populated from registered providers
- "Test" button to verify model access
- Advanced: temperature, max tokens per phase

**Step 3 — Tools:**
- Left panel: available tools from registered connectors + MCP servers
- Right panel: selected tools for this agent
- Drag-and-drop or checkbox to add/remove
- Each tool shows name, description, source (which connector)
- "Add Custom Tool" — name, description, JSON Schema input, webhook URL for handler
- "Connect MCP Server" — URL or command to start

**Step 4 — Triggers & Approval:**
- Checkboxes: assignment, mention, webhook, cron, manual
- Cron: expression builder UI (every day at 9am, every Monday, etc.)
- Webhook: auto-generated URL + secret
- Approval mode: required / auto-approve / conditional (rules)
- Test run button with sample payload

**Connector Hub UI:**

```
┌────────────────────────────────────────────────────────────────┐
│  Connectors                                    [+ Add New]     │
│                                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │  GitHub   │  │  Slack   │  │  Notion  │  │ Postgres │      │
│  │  ✓ Active │  │  ✓ Active│  │  Setup   │  │  ✓ Active│      │
│  │  12 tools │  │  8 tools │  │          │  │  3 tools │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│                                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Supabase │  │  Gmail   │  │ HTTP API │  │  Jira    │      │
│  │  Setup   │  │  Setup   │  │  ✓ Active│  │  Coming  │      │
│  │          │  │          │  │  Custom  │  │  Soon    │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│                                                                │
│  ┌──────────┐  ┌──────────┐                                   │
│  │ MCP      │  │ Custom   │                                   │
│  │ Server   │  │ Webhook  │                                   │
│  │  ✓ 2     │  │  ✓ 5     │                                   │
│  │ connected│  │ endpoints│                                   │
│  └──────────┘  └──────────┘                                   │
└────────────────────────────────────────────────────────────────┘
```

Each connector has:
- Auth setup (OAuth redirect or API key input)
- Auto-discovered tools list
- Test connection button
- Usage stats (how many runs used this connector)

**Run Explorer UI:**

```
┌────────────────────────────────────────────────────────────────┐
│  Runs                          [Filter ▾] [Search...]          │
│                                                                │
│  ● Analyzing  Sales Report Gen    2 min ago    Claude Sonnet   │
│  ◉ Awaiting   Bug Triage Agent    5 min ago    Gemini Flash    │
│  ✓ Completed  Code Reviewer       12 min ago   GPT-4.1         │
│  ✗ Failed     Data Pipeline       1 hr ago     Claude Sonnet   │
│  ✓ Completed  Weekly Digest       3 hrs ago    Gemini Flash    │
│                                                                │
│  Click any run → full detail with analysis, plan, logs,        │
│  approve/reject controls, token usage, cost estimate           │
└────────────────────────────────────────────────────────────────┘
```

---

## Connector System

Pre-built connectors expose tools automatically. Each connector implements:

```typescript
interface Connector {
  type: string;                          // "github", "slack", "postgres"
  name: string;
  icon: string;

  // Auth
  authType: "oauth" | "api_key" | "connection_string";
  authConfig?: OAuthConfig;

  // Connect and discover tools
  connect(credentials: unknown): Promise<ConnectorInstance>;
  discoverTools(instance: ConnectorInstance): Promise<ToolDefinition[]>;

  // Test
  testConnection(instance: ConnectorInstance): Promise<boolean>;
}
```

**Day-1 connectors:**

| Connector | Auth Type | Auto-discovered Tools |
|-----------|-----------|----------------------|
| GitHub | OAuth / Token | search_repos, get_issues, create_pr, list_commits, get_file |
| Slack | OAuth | send_message, search_messages, list_channels, get_thread |
| Postgres | Connection string | query, list_tables, describe_table |
| HTTP API | API key / Bearer | Custom endpoints defined by user (URL + method + schema) |
| MCP Server | N/A | Whatever the MCP server exposes |

**Generic HTTP connector** is critical — it lets users connect ANY REST API without writing code:
1. Enter base URL + auth header
2. Define endpoints (GET /users, POST /reports)
3. Gnana auto-generates tool definitions from the endpoint config
4. Agent can call any defined endpoint

---

## Data Flow Example

**Gnanalytica PM assigns a ticket to Gnana:**

```
1. PM frontend: user assigns ticket to "Gnana" in assignee picker
2. PM hook fires: POST gnana-server:4000/api/runs
   { agentId: "pm-analyst", payload: { ticketId: "abc", projectId: "xyz" } }
3. Gnana server creates run (status: queued)
4. Pipeline starts:
   a. Analysis phase: LLM (Claude Sonnet) calls tools:
      - search_tickets("similar login bug") → finds 3 matches
      - get_ticket_details("abc") → reads full context
      - find_similar_tickets("Login timeout error") → fuzzy match
   b. Planning phase: LLM (Gemini Flash) generates structured plan
   c. Status → awaiting_approval
5. WebSocket pushes update → PM frontend shows plan in Gnana AI section
6. User clicks "Approve" in PM → POST gnana-server:4000/api/runs/:id/approve
7. Pipeline resumes → execution phase
8. Gnana posts results back to PM via hook callback
```

---

## Implementation Phases

### Phase 1: Core Framework (Week 1-2)
- Repo setup (pnpm monorepo + Turborepo)
- `@gnana/core` — pipeline engine, tool executor, hook system, event bus
- `@gnana/provider-anthropic` — Claude provider
- `@gnana/provider-google` — Gemini provider
- `@gnana/provider-openai` — OpenAI + OpenRouter provider
- `@gnana/db` — Drizzle schema, migrations
- `@gnana/server` — Hono server with REST API (agents, runs, providers)
- `@gnana/client` — TypeScript SDK
- WebSocket for real-time run updates
- Extract + refactor existing `src/lib/agent/` code from Gnanalytica PM

### Phase 2: Connectors + Dashboard (Week 3-4)
- Pre-built connectors: GitHub, Slack, Postgres, HTTP API
- MCP client integration
- Dashboard app (Next.js): agent builder wizard, connector hub, run explorer
- Provider settings UI (register API keys, configure model routing)

### Phase 3: Gnanalytica PM Migration (Week 5)
- Replace `src/lib/agent/` with `@gnana/client` SDK
- PM triggers runs via Gnana server instead of in-process
- PM subscribes to WebSocket for real-time updates
- Remove duplicated agent code from PM codebase

### Phase 4: Advanced Features (Week 6+)
- Flow builder (visual node graph for multi-step workflows)
- Multi-agent orchestration (agents that delegate to other agents)
- Scheduled runs (cron trigger)
- Run templates and prompt library
- Usage analytics and cost dashboard
- Multi-tenancy for SaaS mode

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js 22+ / Bun | Long-running processes, WebSocket, no timeout limits |
| Server | Hono | Lightweight, fast, universal (Node/Bun/Deno) |
| Database | PostgreSQL + Drizzle ORM | Type-safe, zero-abstraction SQL, great migrations |
| Monorepo | pnpm + Turborepo | Fast installs, workspace protocol, parallel builds |
| Dashboard | Next.js 16 | Consistent with Gnanalytica PM, App Router, RSC |
| UI | shadcn/ui + Tailwind | Consistent design system, dark mode |
| WebSocket | Hono WebSocket / ws | Native support, efficient push |
| MCP | @modelcontextprotocol/sdk | Standard protocol for tool integration |

---

## Key Design Decisions

1. **Hono over Express/Fastify** — Lighter, faster, works across runtimes. If you later want to run at the edge, Hono supports it.

2. **Drizzle over Prisma** — No query engine binary, TypeScript-native, closer to raw SQL. Better for a framework others will self-host.

3. **Separate database from consumers** — Gnana owns its own Postgres. Consumers (PM, CRM) interact via API only. Clean boundary.

4. **OpenRouter as a provider** — One adapter gives access to 200+ models. Instead of writing providers for Llama, Mistral, DeepSeek individually, point OpenRouter at them.

5. **Connectors as tool factories** — A connector doesn't DO things — it produces tools. Connect GitHub → get 10 tools. This keeps the runtime generic.

6. **Hooks over inheritance** — Consumers customize behavior via hooks, not by subclassing agents. More composable, less coupling.

7. **Event bus for decoupling** — The runtime emits events, the server layer decides what to do (push WebSocket, call webhook, log). Runtime doesn't know about HTTP.

---

## Streaming Support

All LLM providers must implement streaming in addition to request/response:

```typescript
interface LLMProvider {
  // Request/response
  chat(params: ChatParams): Promise<ChatResponse>;
  chatWithTools(params: ToolChatParams): Promise<ChatResponse>;
  // Streaming
  chatStream(params: ChatParams): AsyncIterable<ChatResponseChunk>;
  chatWithToolsStream(params: ToolChatParams): AsyncIterable<ChatResponseChunk>;
  listModels(): ModelInfo[];
}

interface ChatResponseChunk {
  type: "text_delta" | "tool_use_start" | "tool_input_delta" | "tool_use_end" | "done";
  text?: string;
  toolUse?: { id: string; name: string; input?: Record<string, unknown> };
  usage?: { inputTokens: number; outputTokens: number };
}
```

**Event bus streaming events:**
- `run:token` — partial text output during analysis/planning (for real-time UI)
- `run:tool_started` — tool call initiated
- `run:tool_completed` — tool call finished with result

**WebSocket streaming:** `/ws/runs/:id` pushes both status changes AND token-level streaming. Consumers can choose to render partial output or wait for completion.

---

## Execution Phase Contract

When a run is approved, the execution phase receives the approved plan and processes each step:

```typescript
interface ExecutionContext {
  run: Run;
  plan: Plan;                          // the approved plan
  agent: AgentDefinition;
  tools: ToolExecutor;
  llm: LLMRouter;
  modifications?: string;             // user modifications from approval
}

interface ExecutionResult {
  status: "completed" | "partial" | "failed";
  stepResults: StepResult[];
  artifacts: Artifact[];
}

interface StepResult {
  stepOrder: number;
  status: "completed" | "skipped" | "failed";
  output: string;
  artifacts?: Artifact[];
}

interface Artifact {
  type: "code" | "document" | "report" | "image" | "link";
  title: string;
  content?: string;                    // text/markdown/code content
  url?: string;                        // external link (PR, branch, doc)
  mimeType?: string;
}
```

**Execution guardrails:**
- Each plan step is executed sequentially with LLM guidance
- Tool calls during execution are logged to `run_logs`
- Steps can be skipped if the LLM determines they are unnecessary
- If a step fails, the pipeline marks the run as `failed` with partial results preserved
- Consumers can set `maxExecutionTime` per agent (default: 5 minutes)
- Destructive tools (delete, deploy) can be flagged as requiring per-step confirmation via hooks

---

## Error Handling and Retry Strategy

**LLM call failures:**
- Rate limit (429): exponential backoff with `Retry-After` header respect, max 3 retries
- Server error (500/502/503): retry up to 2 times with 1s/2s/4s backoff
- Auth error (401/403): fail immediately, no retry
- Timeout: configurable per provider (default 60s), retry once
- After all retries exhausted: try next provider in fallback chain
- After all providers exhausted: mark run as `failed` with error details

**Tool call failures:**
- Tool timeout: configurable per tool (default 30s), retry once
- Tool error: log error, return error message to LLM for recovery
- MCP server crash: attempt reconnection once, then skip tool

**Run durability:**
- Each stage (analysis, planning, execution) checkpoints state to the database
- If the server restarts, runs in `analyzing`/`planning`/`executing` status are detected on startup
- Resumable runs restart from the last completed stage (not from scratch)
- Runs stuck for >10 minutes in an active status are marked `failed` by a cleanup sweep

**Concurrency control:**
- Configurable max concurrent runs per server (default: 10)
- Runs beyond the limit are queued in `queued` status
- A simple in-process semaphore manages concurrency (pg-boss or BullMQ for distributed setups)

---

## Deployment Model

**Gnana Server (`@gnana/server`)** and **Dashboard (`apps/dashboard`)** are **separate deployables:**

- `@gnana/server` — Hono on Node.js/Bun. Handles REST API + WebSocket. Long-running process.
- `apps/dashboard` — Next.js app. Consumes Gnana API via `@gnana/client`. Can be deployed on Vercel or served by any Node.js host.

This avoids the Hono/Next.js framework conflict. The dashboard is just another API consumer.

**Target runtimes:** Node.js 22+ and Bun. Edge runtimes are NOT supported for the agent runtime (execution time limits). The dashboard can run on Edge/Vercel.

---

## Phasing Adjustments

To keep Phase 1 focused, the following are deferred:

- **Conditional approval** → Phase 3 (define rule syntax when dashboard is built)
- **Multi-tenancy** → Phase 4 (single-workspace for Phase 1-3)
- **Provider management API** → Phase 2 (providers configured via code in Phase 1)
- **Cron trigger** → Phase 2 (requires scheduler infrastructure)
- **Flow builder** → Phase 4+ (separate product-level feature)
- **Multi-agent orchestration** → Phase 4+ (requires flow builder)
- **Notion connector** → on-demand (not pre-built)

Phase 1 `TriggerConfig.type` is limited to: `"assignment" | "mention" | "webhook" | "manual"`

---

## Naming Convention

The Gnana framework uses **camelCase** consistently for all TypeScript interfaces:
- `inputTokens`, `outputTokens` (not `input_tokens`)
- `stopReason` (not `stop_reason`)
- `inputSchema` (not `input_schema`)
- `maxTokens`, `apiKey`, `baseUrl`

The existing Gnanalytica PM code uses snake_case in some places (matching Supabase conventions). During Phase 3 migration, field mapping adapters will bridge the difference.
