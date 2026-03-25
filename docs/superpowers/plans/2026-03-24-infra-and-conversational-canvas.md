# Infrastructure + Conversational Canvas Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Fix all remaining infrastructure gaps and implement the conversational canvas builder feature.

**Architecture:** Two parallel workstreams — infrastructure fixes (DB, server, dashboard) and conversational canvas (backend SSE chat + frontend canvas integration). Infrastructure is 4 independent agents. Canvas is 1 backend agent (Wave 1) then 3 frontend agents (Wave 2).

**Tech Stack:** PostgreSQL/Drizzle (indexes, migrations), Hono (SSE streaming, middleware), Next.js (dashboard), React Flow (canvas), pino (logging)

**Spec:** `docs/superpowers/specs/2026-03-24-conversational-canvas-design.md`

---

## Wave 1 — All Parallel

### Task A1: DB Indexes + Connection Pool + Jobs WorkspaceId

**Files:**

- Modify: `packages/db/src/index.ts` (connection pool config)
- Modify: `packages/db/src/schema.ts` (add indexes, add workspaceId to jobs)
- Create: new migration via `pnpm --filter @gnana/db db:generate`

**Steps:**

- [ ] Add connection pool config to `createDatabase()`:

  ```typescript
  export function createDatabase(connectionString: string) {
    const client = postgres(connectionString, {
      max: 20,
      idle_timeout: 30,
      connect_timeout: 10,
    });
    return drizzle(client, { schema });
  }
  ```

- [ ] Add `workspaceId` to jobs table in schema.ts:

  ```typescript
  workspaceId: uuid("workspace_id").references(() => workspaces.id),
  ```

- [ ] Add indexes to schema.ts using Drizzle's index API. Add indexes for:
  - agents: workspaceId
  - runs: workspaceId, agentId
  - connectors: workspaceId
  - providers: workspaceId
  - apiKeys: workspaceId, keyHash
  - jobs: status, workspaceId
  - runLogs: runId
  - workspaceMembers: userId
  - usageRecords: workspaceId

- [ ] Generate migration: `pnpm --filter @gnana/db db:generate`
- [ ] Run: `pnpm --filter @gnana/db typecheck && pnpm --filter @gnana/db build`

---

### Task A2: Graceful Shutdown + Env Validation + Deep Health Check

**Files:**

- Modify: `packages/server/src/start.ts` (shutdown handlers, env validation)
- Modify: `packages/server/src/index.ts` (health check with DB ping)

**Steps:**

- [ ] Add env validation at top of start.ts before server creation:

  ```typescript
  const requiredEnv = ["DATABASE_URL", "AUTH_SECRET"];
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      console.error(`Missing required env var: ${key}`);
      process.exit(1);
    }
  }
  ```

- [ ] Add graceful shutdown handlers in start.ts:

  ```typescript
  function shutdown(signal: string) {
    console.log(`${signal} received, shutting down gracefully...`);
    clearInterval(heartbeatInterval);
    wss.close();
    httpServer.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  ```

- [ ] Enhance health check in index.ts to ping DB:

  ```typescript
  app.get("/health", async (c) => {
    try {
      await db.execute(sql`SELECT 1`);
      return c.json({ status: "ok", db: "connected" });
    } catch {
      return c.json({ status: "degraded", db: "disconnected" }, 503);
    }
  });
  ```

  Note: `db` must be passed into `createApp()` — it already is.

- [ ] Run: `pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/server build`

---

### Task A3: CORS Lockdown + Request Correlation IDs

**Files:**

- Modify: `packages/server/src/index.ts` (CORS config)
- Modify: `packages/server/src/middleware/request-logger.ts` (add requestId)

**Steps:**

- [ ] Configure CORS with allowed origins:

  ```typescript
  app.use(
    "*",
    cors({
      origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : "*",
      credentials: true,
    }),
  );
  ```

  Add `CORS_ORIGINS` to .env.example.

- [ ] Add request ID generation and logging in request-logger.ts:

  ```typescript
  export const requestLogger = createMiddleware(async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.header("x-request-id", requestId);
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    const status = c.res.status;
    const log =
      status >= 500
        ? serverLog.error.bind(serverLog)
        : status >= 400
          ? serverLog.warn.bind(serverLog)
          : serverLog.info.bind(serverLog);
    log(
      {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status,
        duration,
        userId: c.get("userId" as never) ?? undefined,
        workspaceId: c.get("workspaceId" as never) ?? undefined,
      },
      `${c.req.method} ${c.req.path} ${status} ${duration}ms`,
    );
  });
  ```

- [ ] Run: `pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/server build`

---

### Task A4: Wire useWorkspaces Hook to Real API

**Files:**

- Modify: `apps/dashboard/src/lib/hooks/use-workspaces.ts`

**Steps:**

- [ ] Replace mock data with real API call:

  ```typescript
  "use client";
  import { useState, useEffect, useCallback } from "react";
  import { api } from "@/lib/api";

  export interface Workspace {
    id: string;
    name: string;
    slug: string;
    type: "personal" | "team";
    role: string;
  }

  export function useWorkspaces() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [current, setCurrent] = useState<Workspace | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchWorkspaces = useCallback(async () => {
      try {
        setLoading(true);
        const data = await api.fetch("/api/workspaces");
        setWorkspaces(data as Workspace[]);
        const saved = localStorage.getItem("gnana-current-workspace");
        const match = (data as Workspace[]).find((w) => w.id === saved);
        setCurrent(match ?? (data as Workspace[])[0] ?? null);
      } catch {
        setWorkspaces([]);
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => {
      fetchWorkspaces();
    }, [fetchWorkspaces]);

    const switchWorkspace = useCallback((ws: Workspace) => {
      setCurrent(ws);
      localStorage.setItem("gnana-current-workspace", ws.id);
    }, []);

    return { workspaces, current, setCurrent: switchWorkspace, loading, refetch: fetchWorkspaces };
  }
  ```

- [ ] Run: `pnpm --filter @gnana/dashboard typecheck && pnpm --filter @gnana/dashboard build`

---

### Task B1: Backend Chat Endpoint — SSE Streaming + Enhanced Prompt

**Files:**

- Rewrite: `packages/server/src/routes/chat.ts`
- Modify: `packages/server/src/index.ts` (pass connectors to chat routes if needed)

**Steps:**

- [ ] Rewrite chat.ts with:
  - SSE streaming response (content-type: text/event-stream)
  - Enhanced system prompt from spec (all 11 node types, dynamic connectors/providers)
  - `mode` field: "design" (follow-up questions) vs "modify" (canvas edits)
  - `focusedNodeId` for node-scoped changes
  - `forceGenerate` flag to force pipeline generation
  - `history` for multi-turn context
  - Full pipeline state in system prompt context
  - Provider fallback chain: workspace provider → GNANA_BUILDER_API_KEY → error
  - Terminal `{type: "done"}` SSE event
  - Stream text tokens as `{type: "text", content: "..."}` events
  - Final spec as `{type: "pipeline", spec: {...}, message: "...", suggestions: [...]}` or `{type: "question", content: "..."}`

- [ ] Add `GNANA_BUILDER_API_KEY` to .env.example

- [ ] Run: `pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/server build`

---

## Wave 2 — After B1 Completes (B2, B3, B4 parallel)

### Task B2: Frontend SSE Consumer (pipeline-ai-stream.ts rewrite)

**Files:**

- Rewrite: `apps/dashboard/src/lib/pipeline-ai-stream.ts`
- Modify: `apps/dashboard/src/lib/pipeline-ai.ts` (keep as fallback only)
- Modify: `apps/dashboard/src/app/api/chat/route.ts` (streaming passthrough)

**Steps:**

- [ ] Rewrite pipeline-ai-stream.ts as SSE consumer per spec
- [ ] Convert Next.js API route to streaming passthrough (ReadableStream pipe)
- [ ] Keep generateTemplatePipeline() in pipeline-ai.ts as no-LLM fallback, remove heuristic generation
- [ ] Run: `pnpm --filter @gnana/dashboard typecheck && pnpm --filter @gnana/dashboard build`

---

### Task B3: Canvas Chat Panel + Split Canvas Enhancements

**Files:**

- Modify: `apps/dashboard/src/components/canvas/canvas-chat-panel.tsx`
- Modify: `apps/dashboard/src/components/canvas/split-canvas.tsx`
- Modify: `apps/dashboard/src/components/canvas/pipeline-canvas.tsx` (add onNodeSelect)
- Create: `apps/dashboard/src/lib/canvas/use-canvas-events.ts`

**Steps:**

- [ ] Add `onNodeSelect` prop to pipeline-canvas.tsx — fire on node click / background click
- [ ] Create use-canvas-events.ts — compute meaningful canvas diffs (ignore position-only changes)
- [ ] Update split-canvas.tsx:
  - Track focusedNodeId state from pipeline-canvas onNodeSelect
  - Emit canvas events when AI assistant mode is ON (debounced 1s, rate limited 10s)
  - Pass focusedNodeId to chat panel
- [ ] Update canvas-chat-panel.tsx:
  - Send full pipeline state (not summary) to backend
  - Pass mode: "modify" and focusedNodeId
  - Show node focus indicator
  - Display changes array as bullet list
  - Display suggestions as clickable chips
  - Add AI assistant mode toggle in header
  - Handle canvas events (show contextual suggestions)
- [ ] Run: `pnpm --filter @gnana/dashboard typecheck && pnpm --filter @gnana/dashboard build`

---

### Task B4: Chat Onboarding Enhancements

**Files:**

- Modify: `apps/dashboard/src/components/agents/chat-onboarding.tsx`

**Steps:**

- [ ] Switch from heuristic to real backend calls via streamPipelineResponse()
- [ ] Pass mode: "design" and history
- [ ] Handle question response type (display as assistant message, continue conversation)
- [ ] Track question count — after 3, pass forceGenerate: true
- [ ] Show progress indicator after 2+ questions
- [ ] Handle pipeline response type with suggestions chips
- [ ] Accumulate ChatMessage[] history in state for multi-turn context
- [ ] Run: `pnpm --filter @gnana/dashboard typecheck && pnpm --filter @gnana/dashboard build`

---

## Final Verification

- [ ] `pnpm install`
- [ ] `pnpm typecheck` (all 17 packages)
- [ ] `pnpm build` (all 13 packages)
- [ ] `pnpm --filter @gnana/db db:generate` (generate migration for indexes)
