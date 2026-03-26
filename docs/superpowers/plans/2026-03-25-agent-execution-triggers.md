# Agent Execution & Triggers Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the DAG executor to the job handler, implement cron/webhook triggers, and enable end-to-end agent execution from dashboard to results.

**Architecture:** Extract execution logic into focused modules (provider resolution, tool resolution, DAG run store, run handler). Add trigger infrastructure (cron manager, webhook route). All execution flows through the existing job queue with events bridged to WebSocket for real-time updates.

**Tech Stack:** @gnana/core (DAG executor), Hono (server), Drizzle ORM, node-cron, WebSocket

**Spec:** `docs/superpowers/specs/2026-03-25-agent-execution-triggers-design.md`

---

## Wave 1 — All Parallel (No Inter-dependencies)

### Task 1A: DrizzleDAGRunStore

**Files:**

- Create: `packages/server/src/execution/dag-run-store.ts`

**Steps:**

- [ ] Create directory `packages/server/src/execution/`

- [ ] Create `packages/server/src/execution/dag-run-store.ts` implementing the `DAGRunStore` interface from `@gnana/core`. This backs the store with Drizzle queries against the existing `runs` and `runLogs` tables. Node results are stored in `run_logs` with `stage` = nodeId and `type` = `"node_result"`:

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

- [ ] Verify: `pnpm --filter @gnana/server typecheck`

---

### Task 1B: resolve-providers

**Files:**

- Modify: `packages/server/package.json` (add provider workspace deps)
- Create: `packages/server/src/execution/resolve-providers.ts`

**Steps:**

- [ ] Add provider packages to `packages/server/package.json` dependencies:

  ```json
  "@gnana/provider-anthropic": "workspace:*",
  "@gnana/provider-google": "workspace:*",
  "@gnana/provider-openai": "workspace:*"
  ```

- [ ] Run `pnpm install` from the repo root to link workspace deps.

- [ ] Create `packages/server/src/execution/resolve-providers.ts`. This module loads workspace providers from the `providers` table, decrypts API keys using the existing `decrypt` utility, instantiates the correct provider class via a factory map, falls back to server-side env vars for any missing provider types, and returns an `LLMRouterImpl`:

  ```typescript
  import { eq, and, providers, type Database } from "@gnana/db";
  import { LLMRouterImpl, type LLMProvider, type RouterConfig } from "@gnana/core";
  import { AnthropicProvider } from "@gnana/provider-anthropic";
  import { GoogleProvider } from "@gnana/provider-google";
  import { OpenAIProvider } from "@gnana/provider-openai";
  import { decrypt } from "../utils/encryption.js";
  import { jobLog } from "../logger.js";

  /** Shape of agent.llmConfig JSONB stored in the DB */
  export interface LLMConfig {
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

    // 2. Instantiate from workspace providers (first match per type wins)
    for (const row of rows) {
      if (providerMap.has(row.type)) continue;
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

- [ ] Verify: `pnpm --filter @gnana/server typecheck`

---

### Task 1C: resolve-tools

**Files:**

- Modify: `packages/server/package.json` (add connector workspace deps)
- Create: `packages/server/src/execution/resolve-tools.ts`

**Steps:**

- [ ] Add connector packages to `packages/server/package.json` dependencies:

  ```json
  "@gnana/connector-github": "workspace:*",
  "@gnana/connector-slack": "workspace:*",
  "@gnana/connector-http": "workspace:*"
  ```

- [ ] Run `pnpm install` from the repo root to link workspace deps.

- [ ] Create `packages/server/src/execution/resolve-tools.ts`. This module loads connector records from the `connectors` table filtered by the agent's `toolsConfig.connectors[].connectorId` list, decrypts credentials using `decryptJson`, calls the appropriate connector factory, optionally filters to only requested tool names, and registers them all on a `ToolExecutorImpl`:

  ```typescript
  import { eq, and, inArray, connectors, type Database } from "@gnana/db";
  import { ToolExecutorImpl, type ToolDefinition } from "@gnana/core";
  import { createGitHubConnector } from "@gnana/connector-github";
  import { createSlackConnector } from "@gnana/connector-slack";
  import { createHttpConnector } from "@gnana/connector-http";
  import { decryptJson } from "../utils/encryption.js";
  import { jobLog } from "../logger.js";

  /** Shape of agent.toolsConfig JSONB stored in the DB */
  export interface ToolsConfig {
    connectors: Array<{
      connectorId: string;
      tools?: string[]; // optional filter; omit = all tools from that connector
    }>;
  }

  type ConnectorFactory = (
    creds: Record<string, unknown>,
    config: Record<string, unknown>,
  ) => ToolDefinition[];

  const CONNECTOR_FACTORIES: Record<string, ConnectorFactory> = {
    github: (creds) =>
      createGitHubConnector({
        token: creds.token as string,
        owner: creds.owner as string,
      }) as unknown as ToolDefinition[],
    slack: (creds) =>
      createSlackConnector({
        token: creds.token as string,
      }) as unknown as ToolDefinition[],
    http: (creds, config) =>
      createHttpConnector({
        baseUrl: (config.baseUrl as string) ?? "",
        auth: creds.auth as {
          type: "bearer" | "basic" | "api-key";
          token?: string;
          username?: string;
          password?: string;
          headerName?: string;
          apiKey?: string;
        },
        defaultHeaders: creds.defaultHeaders as Record<string, string>,
        endpoints:
          (config.endpoints as {
            name: string;
            description: string;
            method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
            path: string;
          }[]) ?? [],
      }) as unknown as ToolDefinition[],
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
      const allTools = factory(creds, config);

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

- [ ] Verify: `pnpm --filter @gnana/server typecheck`

---

## Wave 2 — Depends on Wave 1 (all three tasks)

### Task 2A: run-handler + wire into index.ts

**Files:**

- Create: `packages/server/src/execution/run-handler.ts`
- Modify: `packages/server/src/index.ts` (replace stub handler, add log persistence, add `run:resume` handler)

**Steps:**

- [ ] Create `packages/server/src/execution/run-handler.ts`. This is the core composition module that loads the agent and run from the DB, calls `resolveProviders` and `resolveTools` to build a `DAGContext`, and calls `executeDAG()`. It also exports a `createResumeHandler` that does the same but calls `resumeDAG()`:

  ```typescript
  import { executeDAG, resumeDAG, type DAGContext, type DAGPipeline } from "@gnana/core";
  import type { EventBus } from "@gnana/core";
  import type { Database } from "@gnana/db";
  import { agents, runs, eq } from "@gnana/db";
  import { jobLog } from "../logger.js";
  import { resolveProviders, type LLMConfig } from "./resolve-providers.js";
  import { resolveTools, type ToolsConfig } from "./resolve-tools.js";
  import { DrizzleDAGRunStore } from "./dag-run-store.js";

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

  export function createResumeHandler(deps: RunHandlerDeps) {
    const { db, events } = deps;

    return async (payload: Record<string, unknown>) => {
      const { runId, agentId, workspaceId } = payload as {
        runId: string;
        agentId: string;
        workspaceId: string;
      };
      jobLog.info({ runId, agentId }, "run:resume started");

      // 1. Load agent
      const agentRows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
      const agent = agentRows[0];
      if (!agent) {
        await markFailed(db, events, runId, "Agent not found");
        return;
      }

      // 2. Load run record
      const runRows = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      const run = runRows[0];
      if (!run) {
        await markFailed(db, events, runId, "Run not found");
        return;
      }

      try {
        const llmConfig = agent.llmConfig as LLMConfig;
        const llm = await resolveProviders(db, workspaceId, llmConfig);

        const toolsConfig = agent.toolsConfig as ToolsConfig;
        const tools = await resolveTools(db, workspaceId, toolsConfig);

        const pipeline = agent.pipelineConfig as DAGPipeline;
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

        await resumeDAG(ctx);

        jobLog.info({ runId, agentId }, "run:resume completed");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        await markFailed(db, events, runId, message);
      }
    };
  }

  async function markFailed(
    db: Database,
    events: EventBus,
    runId: string,
    error: string,
  ): Promise<void> {
    jobLog.warn({ runId, error }, "run handler failed");
    await db
      .update(runs)
      .set({ status: "failed", error, updatedAt: new Date() })
      .where(eq(runs.id, runId));
    await events.emit("run:failed", { runId, error });
  }
  ```

- [ ] Modify `packages/server/src/index.ts` -- replace the inline stub `run:execute` handler (lines 74-113) with the extracted handler. Also add the `run:resume` handler registration and event log persistence. The changes are:

  **Add new imports at the top:**

  ```typescript
  import { createRunHandler, createResumeHandler } from "./execution/run-handler.js";
  import { runLogs } from "@gnana/db";
  ```

  **Replace the entire `queue.register("run:execute", async (payload) => { ... })` block (lines 74-113) with:**

  ```typescript
  // Register job handlers
  const runHandler = createRunHandler({ db, events });
  queue.register("run:execute", runHandler);

  const resumeHandler = createResumeHandler({ db, events });
  queue.register("run:resume", resumeHandler);
  ```

  **Add event log persistence after the WebSocket bridge loop (after line 72). Insert this block between the WebSocket bridge and the `queue.register` calls:**

  ```typescript
  // Persist DAG execution events to run_logs for queryable history
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
  ```

  **Add the `formatLogMessage` helper function at the bottom of the file (outside `createGnanaServer`):**

  ```typescript
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

- [ ] Verify: `pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/server build`

---

## Wave 3 — All Parallel (Each depends on Wave 2 only)

### Task 3A: Resume Endpoint

**Files:**

- Modify: `packages/server/src/routes/runs.ts`

**Steps:**

- [ ] Add `POST /:id/resume` route to `packages/server/src/routes/runs.ts`. Modify the function signature to accept an optional `queue` parameter (already present) and use it to enqueue a `run:resume` job. Add this route after the existing `/:id/reject` route:

  ```typescript
  // Resume a paused run (human gate approved) — editor+
  app.post("/:id/resume", requireRole("editor"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");

    // 1. Validate run exists and is in awaiting_approval status
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
        "CONFLICT" as any,
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
  ```

  Note: The `errorResponse` function's `ErrorCode` type may need `"CONFLICT"` added. If the type does not include it, cast with `as any` for now -- this is a non-blocking issue. The pattern matches the existing `/approve` and `/reject` endpoints.

- [ ] Verify: `pnpm --filter @gnana/server typecheck`

---

### Task 3B: Webhook Route

**Files:**

- Create: `packages/server/src/triggers/webhook-route.ts`
- Modify: `packages/server/src/index.ts` (mount webhook route)

**Steps:**

- [ ] Create directory `packages/server/src/triggers/`

- [ ] Create `packages/server/src/triggers/webhook-route.ts`. This is a self-contained Hono route mounted outside auth middleware since webhooks are called by external services. It verifies HMAC signatures if a secret is configured, loads the agent, checks for a webhook trigger in `triggersConfig`, creates a run, and enqueues a `run:execute` job:

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

    // POST /api/webhooks/:agentId — no auth middleware (external callers)
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

        if (
          expectedBuf.length !== receivedBuf.length ||
          !timingSafeEqual(expectedBuf, receivedBuf)
        ) {
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

- [ ] Modify `packages/server/src/index.ts` -- add the webhook route mount. In the `createApp` function, add the import at the top of the file:

  ```typescript
  import { webhookRoutes } from "./triggers/webhook-route.js";
  ```

  And mount it inside `createApp()` after the public invite routes (around line 169) and before the auth-protected API routes. Webhooks are public routes (no auth middleware) but distinct from the invite routes:

  ```typescript
  // Webhook routes — no auth (external callers use HMAC signatures)
  app.route("/api/webhooks", webhookRoutes(db, queue));
  ```

- [ ] Verify: `pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/server build`

---

### Task 3C: Cron Manager

**Files:**

- Modify: `packages/server/package.json` (add `node-cron` dependency)
- Create: `packages/server/src/triggers/cron-manager.ts`
- Modify: `packages/server/src/index.ts` (instantiate and start CronManager)
- Modify: `packages/server/src/routes/agents.ts` (reload cron on agent update)

**Steps:**

- [ ] Add dependencies to `packages/server/package.json`:

  In `dependencies`:

  ```json
  "node-cron": "^3.0.3"
  ```

  In `devDependencies`:

  ```json
  "@types/node-cron": "^3.0.11"
  ```

- [ ] Run `pnpm install` from the repo root.

- [ ] Create `packages/server/src/triggers/cron-manager.ts`. This loads all enabled agents with cron triggers on startup, schedules them using `node-cron`, and provides a `reload(agentId)` method for when agent config changes. When a cron fires, it creates a run record and enqueues a `run:execute` job:

  ```typescript
  import * as cron from "node-cron";
  import { eq, and, agents, runs, type Database } from "@gnana/db";
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

- [ ] Modify `packages/server/src/index.ts` -- add CronManager instantiation and startup. Add import at top:

  ```typescript
  import { CronManager } from "./triggers/cron-manager.js";
  ```

  In `createGnanaServer()`, after `const queue = new JobQueue(db);`, add:

  ```typescript
  const cronManager = new CronManager(db, queue);
  ```

  Add `cronManager` to the return object, and call `cronManager.start()` inside the `start()` method:

  ```typescript
  return {
    app,
    db,
    events,
    queue,
    cronManager,
    start() {
      const port = config.port ?? 4000;
      queue.start();
      cronManager.start(); // non-blocking, logs on its own
      const httpServer = serve({ fetch: app.fetch, port }, (info) => {
        serverLog.info(
          { port: info.port },
          `Gnana server running on http://localhost:${info.port}`,
        );
      });
      return httpServer;
    },
  };
  ```

  Also update `createApp` to pass `cronManager` to `agentRoutes`:

  ```typescript
  function createApp(db: Database, events: EventBus, queue: JobQueue, cronManager: CronManager) {
  ```

  And the call to `agentRoutes`:

  ```typescript
  api.route("/agents", agentRoutes(db, cronManager));
  ```

  And the call to `createApp` in `createGnanaServer`:

  ```typescript
  const app = createApp(db, events, queue, cronManager);
  ```

- [ ] Modify `packages/server/src/routes/agents.ts` -- accept optional `CronManager` and call `reload` on agent update. Change the function signature and add the reload call:

  Update import and signature:

  ```typescript
  import type { CronManager } from "../triggers/cron-manager.js";

  export function agentRoutes(db: Database, cronManager?: CronManager) {
  ```

  In the `PUT /:id` handler, after the successful update returns a result (after line 112 `).returning();`), add:

  ```typescript
  // Reload cron schedule if triggers changed
  if (data.triggersConfig && cronManager) {
    await cronManager.reload(id);
  }
  ```

  This goes right after the `.returning()` call and before the `if (result.length === 0)` check.

- [ ] Verify: `pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/server build`

---

### Task 3D: Job Queue Retry Enhancement

**Files:**

- Modify: `packages/server/src/job-queue.ts`

**Steps:**

- [ ] Modify the catch block in `processNext()` in `packages/server/src/job-queue.ts` to support retry with backoff. Currently (lines 106-125), failed jobs are always marked as `"failed"`. Change the inner catch block so that jobs with remaining attempts are reset to `"pending"` instead:

  Replace the inner `catch (error)` block (lines 106-125) with:

  ```typescript
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        const attempt = (job.attempts ?? 0) + 1;
        jobLog.error(
          { err: error, jobId: job.id, jobType: job.type, attempt },
          "Job failed",
        );
        Sentry.withScope((scope) => {
          scope.setTag("job.type", job.type);
          scope.setContext("job", {
            id: job.id,
            type: job.type,
            attempt,
            payload: job.payload,
          });
          Sentry.captureException(error);
        });

        if (attempt < (job.maxAttempts ?? 3)) {
          // Reset to pending for retry on next poll cycle
          await this.db
            .update(jobs)
            .set({ status: "pending", error: message })
            .where(eq(jobs.id, job.id));
          jobLog.info(
            { jobId: job.id, attempt, maxAttempts: job.maxAttempts },
            "Job scheduled for retry",
          );
        } else {
          await this.db
            .update(jobs)
            .set({ status: "failed", error: message })
            .where(eq(jobs.id, job.id));
        }
      }
  ```

- [ ] Verify: `pnpm --filter @gnana/server typecheck`

---

## Final Verification

After all waves are complete:

- [ ] Run full typecheck: `pnpm typecheck`
- [ ] Run full build: `pnpm build`
- [ ] Verify the server starts without errors: `pnpm --filter @gnana/server build && node packages/server/dist/start.js` (requires DATABASE_URL and AUTH_SECRET env vars)

---

## Summary of All Files

| Wave | Task | Action | File                                                 | Description                                                         |
| ---- | ---- | ------ | ---------------------------------------------------- | ------------------------------------------------------------------- |
| 1    | 1A   | Create | `packages/server/src/execution/dag-run-store.ts`     | `DrizzleDAGRunStore` implementing `DAGRunStore` interface           |
| 1    | 1B   | Modify | `packages/server/package.json`                       | Add `@gnana/provider-*` workspace deps                              |
| 1    | 1B   | Create | `packages/server/src/execution/resolve-providers.ts` | Load providers, decrypt keys, build `LLMRouterImpl`                 |
| 1    | 1C   | Modify | `packages/server/package.json`                       | Add `@gnana/connector-*` workspace deps                             |
| 1    | 1C   | Create | `packages/server/src/execution/resolve-tools.ts`     | Load connectors, decrypt creds, build `ToolExecutorImpl`            |
| 2    | 2A   | Create | `packages/server/src/execution/run-handler.ts`       | `createRunHandler` + `createResumeHandler` composing Wave 1 modules |
| 2    | 2A   | Modify | `packages/server/src/index.ts`                       | Replace stub, register handlers, add log persistence                |
| 3    | 3A   | Modify | `packages/server/src/routes/runs.ts`                 | Add `POST /:id/resume` endpoint                                     |
| 3    | 3B   | Create | `packages/server/src/triggers/webhook-route.ts`      | `POST /api/webhooks/:agentId` Hono route                            |
| 3    | 3B   | Modify | `packages/server/src/index.ts`                       | Mount webhook route                                                 |
| 3    | 3C   | Modify | `packages/server/package.json`                       | Add `node-cron` + `@types/node-cron`                                |
| 3    | 3C   | Create | `packages/server/src/triggers/cron-manager.ts`       | `CronManager` class using `node-cron`                               |
| 3    | 3C   | Modify | `packages/server/src/index.ts`                       | Instantiate and start CronManager                                   |
| 3    | 3C   | Modify | `packages/server/src/routes/agents.ts`               | Accept `CronManager`, reload on update                              |
| 3    | 3D   | Modify | `packages/server/src/job-queue.ts`                   | Retry with backoff for failed jobs                                  |
