# Agent Execution Engine & Triggers

**Date:** 2026-03-25
**Status:** Draft
**Scope:** Wire DAG executor to server, add cron/webhook triggers, human gate resume

## Problem

The core execution primitives exist but are disconnected:

- `executeDAG()` in `@gnana/core` handles all node types but the server's `run:execute` job handler is a stub that just marks runs complete
- LLM providers (`AnthropicProvider`, `GoogleProvider`, `OpenAIProvider`) exist but are never instantiated at runtime
- Connector factories (`createGitHubConnector`, `createSlackConnector`, `createHttpConnector`) exist but tools are never loaded
- `resumeDAG()` exists but there is no API endpoint to call it
- `triggersConfig` is stored on agents but never acted upon

## Design

### 1. Wire DAG Executor to Job Handler

Replace the stub in `packages/server/src/index.ts` (lines 75-113) with a real handler that builds a `DAGContext` and calls `executeDAG()`.

Extract the handler to a dedicated module to keep `index.ts` lean.

**packages/server/src/execution/run-handler.ts**

```typescript
import { executeDAG, resumeDAG, type DAGContext, type DAGPipeline } from "@gnana/core";
import type { EventBus } from "@gnana/core";
import type { Database } from "@gnana/db";
import { agents, runs, eq } from "@gnana/db";
import { jobLog } from "../logger.js";
import { resolveProviders } from "./resolve-providers.js";
import { resolveTools } from "./resolve-tools.js";
import { DrizzleDAGRunStore } from "./dag-run-store.js";
import { LLMRouterImpl } from "@gnana/core";

export interface RunHandlerDeps {
  db: Database;
  events: EventBus;
}

export function createRunHandler(deps: RunHandlerDeps) {
  const { db, events } = deps;

  return async (payload: Record<string, unknown>) => {
    const { runId, agentId, workspaceId } = payload as {
      runId: string;
      agentId: string;
      workspaceId: string;
    };
    jobLog.info({ runId, agentId }, "run:execute started");

    // 1. Load agent
    const agentRows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    const agent = agentRows[0];
    if (!agent) {
      await markFailed(db, events, runId, "Agent not found");
      return;
    }

    // 2. Load run record (for triggerData)
    const runRows = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    const run = runRows[0];
    if (!run) {
      await markFailed(db, events, runId, "Run not found");
      return;
    }

    try {
      // 3. Resolve LLM providers -> LLMRouter
      const llmConfig = agent.llmConfig as LLMConfig;
      const llm = await resolveProviders(db, workspaceId, llmConfig);

      // 4. Resolve tools from connectors -> ToolExecutor
      const toolsConfig = agent.toolsConfig as ToolsConfig;
      const tools = await resolveTools(db, workspaceId, toolsConfig);

      // 5. Build pipeline from agent's pipelineConfig
      const pipeline = agent.pipelineConfig as DAGPipeline;
      if (!pipeline?.nodes?.length) {
        await markFailed(db, events, runId, "Agent has no pipeline configured");
        return;
      }

      // 6. Build DAGContext
      const store = new DrizzleDAGRunStore(db);
      const ctx: DAGContext = {
        runId,
        agentId,
        pipeline,
        llm,
        tools,
        events,
        store,
        triggerData: run.triggerData,
      };

      // 7. Execute
      await db
        .update(runs)
        .set({ status: "analyzing", updatedAt: new Date() })
        .where(eq(runs.id, runId));
      await events.emit("run:started", { runId, agentId });

      await executeDAG(ctx);

      jobLog.info({ runId, agentId }, "run:execute completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await markFailed(db, events, runId, message);
    }
  };
}

async function markFailed(db: Database, events: EventBus, runId: string, error: string) {
  jobLog.warn({ runId, error }, "run:execute failed");
  await db
    .update(runs)
    .set({ status: "failed", error, updatedAt: new Date() })
    .where(eq(runs.id, runId));
  await events.emit("run:failed", { runId, error });
}
```

**Types referenced by the handler** (these match the JSONB shapes stored in the DB):

```typescript
// Agent's llmConfig JSONB shape
interface LLMConfig {
  routes: Record<string, { provider: string; model: string }>;
  fallbackChain?: string[];
}

// Agent's toolsConfig JSONB shape
interface ToolsConfig {
  connectors: Array<{
    connectorId: string;
    tools?: string[]; // optional filter; omit = all tools from that connector
  }>;
}
```

**Modify `packages/server/src/index.ts`** -- replace the inline stub:

```typescript
// Before (lines 75-113): inline stub handler
// After:
import { createRunHandler } from "./execution/run-handler.js";

// Inside createGnanaServer():
const runHandler = createRunHandler({ db, events });
queue.register("run:execute", runHandler);
```

### 2. Resolve LLM Providers

**packages/server/src/execution/resolve-providers.ts**

Load workspace providers from DB, decrypt API keys, instantiate the correct provider class, and build an `LLMRouterImpl`.

```typescript
import { eq, and, providers, type Database } from "@gnana/db";
import { LLMRouterImpl, type LLMProvider, type RouterConfig } from "@gnana/core";
import { AnthropicProvider } from "@gnana/provider-anthropic";
import { GoogleProvider } from "@gnana/provider-google";
import { OpenAIProvider } from "@gnana/provider-openai";
import { decrypt } from "../utils/encryption.js";
import { jobLog } from "../logger.js";

interface LLMConfig {
  routes: Record<string, { provider: string; model: string }>;
  fallbackChain?: string[];
}

const PROVIDER_FACTORIES: Record<string, (apiKey: string, baseUrl?: string) => LLMProvider> = {
  anthropic: (key) => new AnthropicProvider(key),
  google: (key) => new GoogleProvider(key),
  openai: (key, baseUrl) => new OpenAIProvider(key, baseUrl ? { baseURL: baseUrl } : undefined),
  openrouter: (key) => new OpenAIProvider(key, { baseURL: "https://openrouter.ai/api/v1" }),
};

export async function resolveProviders(
  db: Database,
  workspaceId: string,
  llmConfig: LLMConfig,
): Promise<LLMRouterImpl> {
  // 1. Load enabled workspace providers
  const rows = await db
    .select()
    .from(providers)
    .where(and(eq(providers.workspaceId, workspaceId), eq(providers.enabled, true)));

  const providerMap = new Map<string, LLMProvider>();

  // 2. Instantiate from workspace providers
  for (const row of rows) {
    if (providerMap.has(row.type)) continue; // first match wins
    const apiKey = decrypt(row.apiKey);
    const factory = PROVIDER_FACTORIES[row.type];
    if (factory) {
      providerMap.set(row.type, factory(apiKey, row.baseUrl ?? undefined));
      jobLog.debug({ provider: row.type }, "Provider instantiated from workspace config");
    }
  }

  // 3. Fallback: server-side env vars for any missing providers
  const envFallbacks: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
  };

  for (const [type, envKey] of Object.entries(envFallbacks)) {
    if (!providerMap.has(type) && envKey) {
      const factory = PROVIDER_FACTORIES[type];
      if (factory) {
        providerMap.set(type, factory(envKey));
        jobLog.debug({ provider: type }, "Provider instantiated from env fallback");
      }
    }
  }

  if (providerMap.size === 0) {
    throw new Error("No LLM providers available. Configure workspace providers or set env vars.");
  }

  // 4. Build RouterConfig from agent's llmConfig
  const routerConfig: RouterConfig = {
    routes: llmConfig.routes ?? {},
    fallbackChain: llmConfig.fallbackChain,
    retries: 2,
  };

  return new LLMRouterImpl(routerConfig, providerMap);
}
```

**Fallback chain**: workspace providers take priority. If a workspace has an Anthropic key configured, that is used. If not, the server's `ANTHROPIC_API_KEY` env var is tried. This means self-hosted deployments can set a single key server-wide, while SaaS users bring their own.

### 3. Resolve Tools from Connectors

**packages/server/src/execution/resolve-tools.ts**

Load connector records, decrypt credentials, call connector factories, register tools with `ToolExecutorImpl`.

```typescript
import { eq, and, inArray, connectors, type Database } from "@gnana/db";
import { ToolExecutorImpl, type ToolDefinition } from "@gnana/core";
import { createGitHubConnector } from "@gnana/connector-github";
import { createSlackConnector } from "@gnana/connector-slack";
import { createHttpConnector } from "@gnana/connector-http";
import { decryptJson } from "../utils/encryption.js";
import { jobLog } from "../logger.js";

interface ToolsConfig {
  connectors: Array<{
    connectorId: string;
    tools?: string[];
  }>;
}

type ConnectorFactory = (
  creds: Record<string, unknown>,
  config: Record<string, unknown>,
) => ToolDefinition[];

const CONNECTOR_FACTORIES: Record<string, ConnectorFactory> = {
  github: (creds) =>
    createGitHubConnector({ token: creds.token as string, owner: creds.owner as string }),
  slack: (creds) => createSlackConnector({ token: creds.token as string }),
  http: (creds, config) =>
    createHttpConnector({
      baseUrl: (config.baseUrl as string) ?? "",
      auth: creds.auth as any,
      defaultHeaders: creds.defaultHeaders as Record<string, string>,
      endpoints: (config.endpoints as any[]) ?? [],
    }),
};

export async function resolveTools(
  db: Database,
  workspaceId: string,
  toolsConfig: ToolsConfig,
): Promise<ToolExecutorImpl> {
  const executor = new ToolExecutorImpl();

  if (!toolsConfig?.connectors?.length) {
    return executor; // agent has no tools configured -- that's valid
  }

  // 1. Load all referenced connectors in one query
  const connectorIds = toolsConfig.connectors.map((c) => c.connectorId);
  const rows = await db
    .select()
    .from(connectors)
    .where(
      and(
        inArray(connectors.id, connectorIds),
        eq(connectors.workspaceId, workspaceId),
        eq(connectors.enabled, true),
      ),
    );

  // Build lookup: connectorId -> { tools?: string[] }
  const configByConnector = new Map(toolsConfig.connectors.map((c) => [c.connectorId, c]));

  // 2. For each connector, instantiate tools
  for (const row of rows) {
    const factory = CONNECTOR_FACTORIES[row.type];
    if (!factory) {
      jobLog.warn({ connectorId: row.id, type: row.type }, "Unknown connector type, skipping");
      continue;
    }

    const creds = (decryptJson(row.credentials) as Record<string, unknown>) ?? {};
    const config = (row.config as Record<string, unknown>) ?? {};
    const allTools = factory(creds, config) as ToolDefinition[];

    // 3. Filter to only requested tools (if specified)
    const filterSpec = configByConnector.get(row.id);
    const filtered = filterSpec?.tools
      ? allTools.filter((t) => filterSpec.tools!.includes(t.name))
      : allTools;

    executor.registerTools(filtered);
    jobLog.debug(
      { connectorId: row.id, type: row.type, toolCount: filtered.length },
      "Connector tools registered",
    );
  }

  return executor;
}
```

### 4. DAGRunStore Implementation

**packages/server/src/execution/dag-run-store.ts**

Implements the `DAGRunStore` interface from `@gnana/core` backed by Drizzle.

```typescript
import type { DAGRunStore } from "@gnana/core";
import { runs, runLogs, eq, and, type Database } from "@gnana/db";

export class DrizzleDAGRunStore implements DAGRunStore {
  constructor(private db: Database) {}

  async updateStatus(runId: string, status: string): Promise<void> {
    await this.db.update(runs).set({ status, updatedAt: new Date() }).where(eq(runs.id, runId));
  }

  async updateNodeResult(runId: string, nodeId: string, result: unknown): Promise<void> {
    await this.db.insert(runLogs).values({
      runId,
      stage: nodeId,
      type: "node_result",
      message: `Node ${nodeId} completed`,
      data: result as Record<string, unknown>,
    });
  }

  async getNodeResult(runId: string, nodeId: string): Promise<unknown> {
    const rows = await this.db
      .select()
      .from(runLogs)
      .where(
        and(eq(runLogs.runId, runId), eq(runLogs.stage, nodeId), eq(runLogs.type, "node_result")),
      )
      .orderBy(runLogs.createdAt)
      .limit(1);
    return rows[0]?.data ?? null;
  }

  async updateResult(runId: string, result: unknown): Promise<void> {
    await this.db
      .update(runs)
      .set({ result: result as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(runs.id, runId));
  }

  async updateError(runId: string, error: string): Promise<void> {
    await this.db.update(runs).set({ error, updatedAt: new Date() }).where(eq(runs.id, runId));
  }
}
```

**Key decision**: Node results are stored in `run_logs` rather than a separate table. The `stage` column holds the node ID, and `type` = `"node_result"`. This reuses the existing schema and keeps all execution history in one place.

### 5. Human Gate Resume Endpoint

**Add `POST /api/runs/:id/resume` to `packages/server/src/routes/runs.ts`**

The existing `/approve` endpoint only sets `status = 'approved'` in the DB. The new `/resume` endpoint must also re-instantiate the DAG context and call `resumeDAG()`.

```typescript
// Add to runRoutes() -- new parameter: resumeRun callback
export function runRoutes(
  db: Database,
  events: EventBus,
  queue?: JobQueue,
  onResume?: (runId: string, workspaceId: string) => Promise<void>,
) {
  // ... existing routes ...

  // Resume a paused run (human gate approved) -- editor+
  app.post("/:id/resume", requireRole("editor"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");

    // 1. Validate run exists and is in awaiting_approval
    const runRows = await db
      .select()
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)));
    if (runRows.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Run not found");
    }
    const run = runRows[0]!;
    if (run.status !== "awaiting_approval") {
      return errorResponse(
        c,
        409,
        "CONFLICT",
        `Run is in '${run.status}' status, not 'awaiting_approval'`,
      );
    }

    // 2. Update status to approved
    await db.update(runs).set({ status: "approved", updatedAt: new Date() }).where(eq(runs.id, id));
    await events.emit("run:approved", { runId: id });

    // 3. Enqueue a resume job
    if (queue) {
      await queue.enqueue("run:resume", {
        runId: id,
        agentId: run.agentId,
        workspaceId,
      });
    }

    return c.json({ ok: true, runId: id, status: "approved" });
  });

  return app;
}
```

**Register `run:resume` job handler** in `index.ts`:

```typescript
queue.register("run:resume", async (payload) => {
  const { runId, agentId, workspaceId } = payload as {
    runId: string;
    agentId: string;
    workspaceId: string;
  };

  // Same resolution as run:execute, but call resumeDAG() instead of executeDAG()
  const agent = /* load agent */;
  const run = /* load run */;
  const llm = await resolveProviders(db, workspaceId, agent.llmConfig as LLMConfig);
  const tools = await resolveTools(db, workspaceId, agent.toolsConfig as ToolsConfig);
  const store = new DrizzleDAGRunStore(db);

  const ctx: DAGContext = {
    runId,
    agentId,
    pipeline: agent.pipelineConfig as DAGPipeline,
    llm,
    tools,
    events,
    store,
    triggerData: run.triggerData,
  };

  await resumeDAG(ctx);
});
```

**Why a job queue instead of in-memory `Map<runId, resolver>`**: The paused state is already persisted to `run_logs` by the DAG executor (`__paused_at` and `__partial_results`). The `resumeDAG()` function reads that state from the store and continues. This survives server restarts with zero extra work.

### 6. Cron Triggers

**packages/server/src/triggers/cron-manager.ts**

```typescript
import * as cron from "node-cron";
import { eq, and, agents, type Database } from "@gnana/db";
import type { JobQueue } from "../job-queue.js";
import { jobLog } from "../logger.js";

interface CronTrigger {
  type: "cron";
  schedule: string; // cron expression, e.g. "0 9 * * 1-5"
  timezone?: string;
}

export class CronManager {
  private tasks = new Map<string, cron.ScheduledTask>(); // agentId -> task
  private db: Database;
  private queue: JobQueue;

  constructor(db: Database, queue: JobQueue) {
    this.db = db;
    this.queue = queue;
  }

  /** Load all enabled agents with cron triggers and schedule them */
  async start(): Promise<void> {
    const agentRows = await this.db
      .select({
        id: agents.id,
        workspaceId: agents.workspaceId,
        triggersConfig: agents.triggersConfig,
      })
      .from(agents)
      .where(eq(agents.enabled, true));

    let scheduled = 0;
    for (const agent of agentRows) {
      const triggers = (agent.triggersConfig as unknown[]) ?? [];
      const cronTrigger = triggers.find(
        (t): t is CronTrigger =>
          typeof t === "object" && t !== null && (t as CronTrigger).type === "cron",
      );

      if (cronTrigger && cron.validate(cronTrigger.schedule)) {
        this.schedule(agent.id, agent.workspaceId!, cronTrigger);
        scheduled++;
      }
    }

    jobLog.info({ scheduled }, "CronManager started");
  }

  /** Reload cron for a specific agent (call after agent config changes) */
  async reload(agentId: string): Promise<void> {
    // Stop existing task
    this.tasks.get(agentId)?.stop();
    this.tasks.delete(agentId);

    // Load fresh config
    const rows = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.enabled, true)))
      .limit(1);

    const agent = rows[0];
    if (!agent) return;

    const triggers = (agent.triggersConfig as unknown[]) ?? [];
    const cronTrigger = triggers.find(
      (t): t is CronTrigger =>
        typeof t === "object" && t !== null && (t as CronTrigger).type === "cron",
    );

    if (cronTrigger && cron.validate(cronTrigger.schedule)) {
      this.schedule(agent.id, agent.workspaceId!, cronTrigger);
    }
  }

  /** Stop all cron tasks */
  stop(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
    jobLog.info("CronManager stopped");
  }

  private schedule(agentId: string, workspaceId: string, trigger: CronTrigger): void {
    const task = cron.schedule(
      trigger.schedule,
      async () => {
        jobLog.info({ agentId, schedule: trigger.schedule }, "Cron trigger fired");
        try {
          const { runs } = await import("@gnana/db");
          const result = await this.db
            .insert(runs)
            .values({
              agentId,
              workspaceId,
              status: "queued",
              triggerType: "cron",
              triggerData: {
                firedAt: new Date().toISOString(),
                schedule: trigger.schedule,
              },
            })
            .returning();

          const run = result[0]!;
          await this.queue.enqueue("run:execute", {
            runId: run.id,
            agentId,
            workspaceId,
          });
        } catch (err) {
          jobLog.error({ err, agentId }, "Cron trigger failed to create run");
        }
      },
      {
        timezone: trigger.timezone ?? "UTC",
        scheduled: true,
      },
    );

    this.tasks.set(agentId, task);
  }
}
```

**Wiring**:

In `packages/server/src/index.ts`, add `cronManager` to the return value:

```typescript
import { CronManager } from "./triggers/cron-manager.js";

export function createGnanaServer(config: GnanaServerConfig) {
  // ... existing code ...
  const cronManager = new CronManager(db, queue);

  return {
    app,
    db,
    events,
    queue,
    cronManager,
    start() {
      queue.start();
      cronManager.start(); // non-blocking, logs on its own
      // ... existing serve() code ...
    },
  };
}
```

In `packages/server/src/routes/agents.ts`, add reload hook on agent update:

```typescript
// agentRoutes now accepts optional cronManager
export function agentRoutes(db: Database, cronManager?: CronManager) {
  // ... in PUT /:id handler, after successful update:
  if (data.triggersConfig && cronManager) {
    await cronManager.reload(id);
  }
}
```

**Add dependency** to `packages/server/package.json`:

```json
"node-cron": "^3.0.3"
```

Dev dependency:

```json
"@types/node-cron": "^3.0.11"
```

### 7. Webhook Triggers

**packages/server/src/triggers/webhook-route.ts**

```typescript
import { Hono } from "hono";
import { eq, and, agents, runs, type Database } from "@gnana/db";
import type { JobQueue } from "../job-queue.js";
import { jobLog } from "../logger.js";
import { createHmac, timingSafeEqual } from "node:crypto";

interface WebhookTrigger {
  type: "webhook";
  secret?: string; // HMAC secret for signature verification
}

export function webhookRoutes(db: Database, queue: JobQueue) {
  const app = new Hono();

  // POST /api/webhooks/:agentId -- no auth middleware (external callers)
  app.post("/:agentId", async (c) => {
    const agentId = c.req.param("agentId");

    // 1. Load agent
    const rows = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.enabled, true)))
      .limit(1);

    const agent = rows[0];
    if (!agent) {
      return c.json({ error: "Agent not found or disabled" }, 404);
    }

    // 2. Check agent has webhook trigger
    const triggers = (agent.triggersConfig as unknown[]) ?? [];
    const webhookTrigger = triggers.find(
      (t): t is WebhookTrigger =>
        typeof t === "object" && t !== null && (t as WebhookTrigger).type === "webhook",
    );
    if (!webhookTrigger) {
      return c.json({ error: "Agent has no webhook trigger configured" }, 400);
    }

    // 3. Verify HMAC signature if secret is configured
    if (webhookTrigger.secret) {
      const signature = c.req.header("x-gnana-signature");
      if (!signature) {
        return c.json({ error: "Missing x-gnana-signature header" }, 401);
      }

      const rawBody = await c.req.text();
      const expected = createHmac("sha256", webhookTrigger.secret).update(rawBody).digest("hex");

      const expectedBuf = Buffer.from(`sha256=${expected}`, "utf8");
      const receivedBuf = Buffer.from(signature, "utf8");

      if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
        return c.json({ error: "Invalid signature" }, 401);
      }
    }

    // 4. Parse body
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    // 5. Create run
    const workspaceId = agent.workspaceId!;
    const result = await db
      .insert(runs)
      .values({
        agentId,
        workspaceId,
        status: "queued",
        triggerType: "webhook",
        triggerData: body,
      })
      .returning();

    const run = result[0]!;

    // 6. Enqueue
    await queue.enqueue("run:execute", {
      runId: run.id,
      agentId,
      workspaceId,
    });

    jobLog.info({ agentId, runId: run.id }, "Webhook trigger created run");

    return c.json({ runId: run.id }, 202);
  });

  return app;
}
```

**Mount in `index.ts`** (outside the auth-protected API routes since webhooks are externally called):

```typescript
import { webhookRoutes } from "./triggers/webhook-route.js";

// In createApp():
app.route("/api/webhooks", webhookRoutes(db, queue));
```

**HMAC verification format**: Callers send `x-gnana-signature: sha256=<hex>`. The server computes `HMAC-SHA256(secret, rawBody)` and compares using `timingSafeEqual`. This matches the pattern used by GitHub and Stripe webhooks.

### 8. Run Logs Enhancement

The DAG executor already emits events: `run:node_started`, `run:node_completed`, `run:tool_called`, `run:tool_result`, `run:log`. These are bridged to WebSocket in `index.ts` (lines 49-72). To persist them, add an event listener that writes to `run_logs`.

**Add to `packages/server/src/index.ts`** alongside the WebSocket bridge:

```typescript
import { runLogs } from "@gnana/db";

// Persist DAG events to run_logs
const persistableEvents = [
  "run:node_started",
  "run:node_completed",
  "run:tool_called",
  "run:tool_result",
  "run:log",
  "run:awaiting_approval",
  "run:approved",
  "run:failed",
];

for (const eventName of persistableEvents) {
  events.on(eventName, async (data: unknown) => {
    const payload = data as Record<string, unknown>;
    if (!payload?.runId || typeof payload.runId !== "string") return;

    try {
      await db.insert(runLogs).values({
        runId: payload.runId as string,
        stage: (payload.nodeId as string) ?? "system",
        type: eventName.replace("run:", ""),
        message: formatLogMessage(eventName, payload),
        data: payload,
      });
    } catch {
      // Don't break execution if log persistence fails
    }
  });
}

function formatLogMessage(event: string, payload: Record<string, unknown>): string {
  switch (event) {
    case "run:node_started":
      return `Node ${payload.nodeId} started (type: ${payload.type})`;
    case "run:node_completed":
      return `Node ${payload.nodeId} completed`;
    case "run:tool_called":
      return `Tool ${payload.tool} called`;
    case "run:tool_result":
      return `Tool ${payload.tool} returned result`;
    case "run:log":
      return (payload.message as string) ?? `Log: ${payload.type}`;
    case "run:awaiting_approval":
      return `Awaiting approval at node ${payload.nodeId}`;
    case "run:approved":
      return "Run approved";
    case "run:failed":
      return `Run failed: ${payload.error}`;
    default:
      return event;
  }
}
```

This means full execution history is queryable via the existing `GET /api/runs/:id/logs` endpoint even after WebSocket disconnects.

### 9. Error Handling & Retries

The job queue already has retry logic (max 3 attempts). The retry behavior needs exponential backoff delays. Currently the queue re-polls and picks up failed jobs immediately (status reverts to `pending` on failure).

**Modify `packages/server/src/job-queue.ts`** to support delayed retries:

```typescript
// In the catch block of processNext(), instead of setting status to "failed":
const attempt = (job.attempts ?? 0) + 1;
if (attempt < job.maxAttempts) {
  // Exponential backoff: 1s, 5s, 25s
  const delayMs = Math.pow(5, attempt - 1) * 1000;
  const retryAfter = new Date(Date.now() + delayMs);
  await this.db
    .update(jobs)
    .set({
      status: "pending",
      error: message,
      // Use scheduledAt if column exists, otherwise rely on createdAt ordering
    })
    .where(eq(jobs.id, job.id));
  jobLog.info({ jobId: job.id, attempt, retryAfter }, "Job scheduled for retry");
} else {
  await this.db.update(jobs).set({ status: "failed", error: message }).where(eq(jobs.id, job.id));
}
```

For the initial implementation, failed jobs reset to `pending` and the queue re-picks them after the next poll interval. True delayed retry (with a `scheduledAt` column) can be added later if needed.

## Files to Create/Modify

| Action | File                                                 | Description                                                              |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Create | `packages/server/src/execution/dag-run-store.ts`     | `DrizzleDAGRunStore` implementing `DAGRunStore`                          |
| Create | `packages/server/src/execution/resolve-providers.ts` | Load workspace providers, decrypt keys, build `LLMRouterImpl`            |
| Create | `packages/server/src/execution/resolve-tools.ts`     | Load connectors, decrypt creds, call factories, build `ToolExecutorImpl` |
| Create | `packages/server/src/execution/run-handler.ts`       | `createRunHandler()` that builds `DAGContext` and calls `executeDAG()`   |
| Create | `packages/server/src/triggers/cron-manager.ts`       | `CronManager` class using `node-cron`                                    |
| Create | `packages/server/src/triggers/webhook-route.ts`      | `POST /api/webhooks/:agentId` Hono route                                 |
| Modify | `packages/server/src/index.ts`                       | Replace stub handler, add cron/webhook/log persistence                   |
| Modify | `packages/server/src/routes/runs.ts`                 | Add `POST /:id/resume` endpoint                                          |
| Modify | `packages/server/src/routes/agents.ts`               | Call `cronManager.reload(agentId)` on update                             |
| Modify | `packages/server/src/start.ts`                       | No changes needed (cron starts inside `createGnanaServer.start()`)       |
| Modify | `packages/server/package.json`                       | Add `node-cron` + `@types/node-cron`                                     |

## Sequence Diagrams

### Manual Run Execution

```
Dashboard          API Server         Job Queue         DAG Executor
   |                   |                  |                  |
   |-- POST /runs ---->|                  |                  |
   |                   |-- insert run --->|                  |
   |                   |-- enqueue ------>|                  |
   |<-- 201 { runId }--|                  |                  |
   |                   |                  |                  |
   |    ws:connect     |                  |-- poll --------->|
   |<=================>|                  |                  |
   |                   |                  |  run:execute     |
   |                   |                  |----------------->|
   |                   |                  |  resolveProviders|
   |                   |                  |  resolveTools    |
   |                   |                  |  executeDAG()    |
   |                   |                  |                  |
   |<-- ws: node_started ------------------- emit ----------|
   |<-- ws: node_completed ----------------- emit ----------|
   |<-- ws: completed ---------------------- emit ----------|
```

### Human Gate Resume

```
Dashboard          API Server         Job Queue         DAG Executor
   |                   |                  |                  |
   |                   |                  |  executeDAG()    |
   |<-- ws: awaiting_approval ------------- emit -----------|
   |                   |                  |  (returns)       |
   |                   |                  |                  |
   | POST /runs/:id/resume                |                  |
   |------>|           |                  |                  |
   |       |-- validate status            |                  |
   |       |-- update status=approved     |                  |
   |       |-- enqueue run:resume ------->|                  |
   |<------| 200                          |                  |
   |                   |                  |-- poll --------->|
   |                   |                  |  run:resume      |
   |                   |                  |  resumeDAG() --->|
   |<-- ws: node_completed ----------------- emit ----------|
   |<-- ws: completed ---------------------- emit ----------|
```

### Webhook Trigger

```
External Service    API Server         Job Queue         DAG Executor
   |                   |                  |                  |
   | POST /api/webhooks/:agentId          |                  |
   |------>|           |                  |                  |
   |       |-- verify HMAC               |                  |
   |       |-- load agent                |                  |
   |       |-- insert run (triggerType=webhook)              |
   |       |-- enqueue run:execute ------>|                  |
   |<------| 202 { runId }               |                  |
   |                   |                  |-- poll --------->|
   |                   |                  |  (same as above) |
```

## Dependencies

New packages:

| Package            | Version   | Purpose                          |
| ------------------ | --------- | -------------------------------- |
| `node-cron`        | `^3.0.3`  | Cron scheduling                  |
| `@types/node-cron` | `^3.0.11` | TypeScript types (devDependency) |

Existing packages used (already in `@gnana/server`'s dependencies or workspace):

- `@gnana/core` (executeDAG, resumeDAG, LLMRouterImpl, ToolExecutorImpl, createEventBus)
- `@gnana/db` (runs, runLogs, agents, connectors, providers, jobs)
- `@gnana/provider-anthropic`, `@gnana/provider-google`, `@gnana/provider-openai`
- `@gnana/connector-github`, `@gnana/connector-slack`, `@gnana/connector-http`

The provider and connector packages need to be added to `@gnana/server`'s `package.json`:

```json
"@gnana/provider-anthropic": "workspace:*",
"@gnana/provider-google": "workspace:*",
"@gnana/provider-openai": "workspace:*",
"@gnana/connector-github": "workspace:*",
"@gnana/connector-slack": "workspace:*",
"@gnana/connector-http": "workspace:*"
```

## Implementation Order

1. **`dag-run-store.ts`** -- no dependencies, pure DB adapter
2. **`resolve-providers.ts`** -- needs provider packages in server deps
3. **`resolve-tools.ts`** -- needs connector packages in server deps
4. **`run-handler.ts`** -- composes the above three
5. **Wire into `index.ts`** -- replace stub, add log persistence
6. **Resume endpoint** -- add to `runs.ts`, register `run:resume` handler
7. **`webhook-route.ts`** -- self-contained, mount in `index.ts`
8. **`cron-manager.ts`** -- needs `node-cron` dep, wire into `index.ts` and `agents.ts`

Steps 1-5 can be done in a single PR. Steps 6-8 can follow independently.

## Testing Strategy

- **Unit tests** for `DrizzleDAGRunStore` -- mock Drizzle DB, verify correct SQL operations
- **Unit tests** for `resolveProviders` -- mock DB rows, verify correct provider instantiation and fallback to env vars
- **Unit tests** for `resolveTools` -- mock DB rows, verify correct factory calls and tool filtering
- **Integration test** for `run-handler` -- use test DB, create agent with simple pipeline (trigger -> output), verify run completes
- **Integration test** for resume -- create pipeline with humanGate, verify it pauses, hit resume, verify it completes
- **Integration test** for webhook route -- POST to endpoint, verify run is created and enqueued
- **CronManager** -- unit test `schedule`/`reload`/`stop` with mocked `node-cron`
