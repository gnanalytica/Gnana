import * as Sentry from "@sentry/node";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { createDatabase, runLogs, sql, type Database } from "@gnana/db";
import { createEventBus, type EventBus, type LLMProvider } from "@gnana/core";
import type { RouterConfig } from "@gnana/core";
import { createRunHandler, createResumeHandler } from "./execution/run-handler.js";
import { agentRoutes } from "./routes/agents.js";
import { runRoutes } from "./routes/runs.js";
import { connectorRoutes } from "./routes/connectors.js";
import { providerRoutes } from "./routes/providers.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { publicInviteRoutes, protectedInviteRoutes } from "./routes/invites.js";
import { pipelineVersionRoutes } from "./routes/pipeline-versions.js";
import { chatRoutes } from "./routes/chat.js";
import { connectionManager } from "./ws.js";
import { authMiddleware } from "./middleware/auth.js";
import { workspaceMiddleware } from "./middleware/workspace.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { requestLogger } from "./middleware/request-logger.js";
import { serverLog, jobLog } from "./logger.js";
import { JobQueue } from "./job-queue.js";
import { errorResponse } from "./utils/errors.js";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 1.0,
    integrations: [Sentry.captureConsoleIntegration({ levels: ["warn", "error"] })],
  });
}

export interface GnanaServerConfig {
  port?: number;
  database: string;
  providers?: Record<string, LLMProvider>;
  defaultRouter?: RouterConfig;
}

export function createGnanaServer(config: GnanaServerConfig) {
  const db = createDatabase(config.database);
  const events = createEventBus();
  const queue = new JobQueue(db);
  const app = createApp(db, events, queue);

  // Bridge event bus to WebSocket connections
  const runEvents = [
    "run:started",
    "run:status_changed",
    "run:analysis_complete",
    "run:plan_complete",
    "run:awaiting_approval",
    "run:approved",
    "run:rejected",
    "run:tool_called",
    "run:tool_result",
    "run:completed",
    "run:failed",
    "run:queued",
    "run:log",
  ];

  for (const eventName of runEvents) {
    events.on(eventName, (data: unknown) => {
      const payload = data as Record<string, unknown>;
      if (payload?.runId && typeof payload.runId === "string") {
        connectionManager.broadcast(payload.runId, eventName, payload);
      }
    });
  }

  // Register job handlers for DAG execution
  const runHandler = createRunHandler({ db, events });
  const resumeHandler = createResumeHandler({ db, events });

  queue.register("run:execute", runHandler);
  queue.register("run:resume", resumeHandler);

  // Persist DAG events as run_logs for observability
  const dagLogEvents = [
    "run:node_started",
    "run:node_completed",
    "run:tool_called",
    "run:tool_result",
    "run:log",
    "run:awaiting_approval",
    "run:approved",
    "run:failed",
  ] as const;

  for (const eventName of dagLogEvents) {
    events.on(eventName, (data: unknown) => {
      const payload = data as Record<string, unknown>;
      const runId = payload?.runId as string | undefined;
      if (!runId) return;

      const nodeId = (payload?.nodeId as string) ?? "";
      const message = formatLogMessage(eventName, payload);

      // Fire-and-forget insert — don't block the event bus
      db.insert(runLogs)
        .values({
          runId,
          stage: nodeId || eventName,
          type: eventName.replace("run:", ""),
          message,
          data: payload as Record<string, unknown>,
        })
        .then(() => {})
        .catch((err) => {
          jobLog.error({ err, eventName, runId }, "Failed to persist run log");
        });
    });
  }

  return {
    app,
    db,
    events,
    queue,
    start() {
      const port = config.port ?? 4000;
      queue.start();
      const httpServer = serve({ fetch: app.fetch, port }, (info) => {
        serverLog.info(
          { port: info.port },
          `Gnana server running on http://localhost:${info.port}`,
        );
      });
      return httpServer;
    },
  };
}

/** Build a human-readable log message from a DAG event payload. */
function formatLogMessage(eventName: string, payload: Record<string, unknown>): string {
  const nodeId = (payload.nodeId as string) ?? "";
  switch (eventName) {
    case "run:node_started":
      return `Node ${nodeId} started (${payload.type ?? "unknown"})`;
    case "run:node_completed":
      return `Node ${nodeId} completed`;
    case "run:tool_called":
      return `Tool called: ${payload.tool ?? "unknown"} on node ${nodeId}`;
    case "run:tool_result":
      return `Tool result for ${payload.tool ?? "unknown"} on node ${nodeId}`;
    case "run:log":
      return `[${nodeId}] ${payload.type ?? "log"}: ${payload.content ?? payload.iteration ?? ""}`;
    case "run:awaiting_approval":
      return `Awaiting approval at node ${nodeId}`;
    case "run:approved":
      return "Run approved — resuming execution";
    case "run:failed":
      return `Run failed: ${payload.error ?? "unknown error"}`;
    default:
      return eventName;
  }
}

function createApp(db: Database, events: EventBus, queue: JobQueue) {
  const app = new Hono();

  // Middleware
  app.use(
    "*",
    cors({
      origin: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
        : "*",
      credentials: true,
    }),
  );
  app.use("*", requestLogger);

  // Public routes (no auth required)
  app.get("/", (c) =>
    c.json({
      name: "Gnana API",
      version: "0.0.1",
      status: "ok",
      docs: "/api",
    }),
  );

  app.get("/health", async (c) => {
    try {
      await db.execute(sql`SELECT 1`);
      return c.json({ status: "ok", db: "connected" });
    } catch {
      return c.json({ status: "degraded", db: "disconnected" }, 503);
    }
  });

  // Public invite routes — view invite details without auth
  app.route("/api/invites", publicInviteRoutes(db));

  // Auth-only routes (no workspace middleware) — accepting invites
  const authOnly = new Hono();
  authOnly.use("*", authMiddleware(db));
  authOnly.route("/invites", protectedInviteRoutes(db));
  app.route("/api/auth-actions", authOnly);

  // Error handler — log + report to Sentry with request context
  app.onError((err, c) => {
    const userId = c.get("userId" as never) as string | undefined;
    const workspaceId = c.get("workspaceId" as never) as string | undefined;
    serverLog.error(
      { err, method: c.req.method, path: c.req.path, userId, workspaceId },
      `Unhandled error: ${c.req.method} ${c.req.path}`,
    );
    Sentry.withScope((scope) => {
      scope.setContext("request", {
        method: c.req.method,
        url: c.req.url,
        path: c.req.path,
      });
      if (userId) scope.setTag("user.id", userId);
      if (workspaceId) scope.setTag("workspace.id", workspaceId);
      Sentry.captureException(err);
    });
    return errorResponse(c, 500, "INTERNAL_ERROR", "Internal server error");
  });

  // Protected API routes — auth + workspace resolution + rate limiting
  const api = new Hono();
  api.use("*", authMiddleware(db));
  api.use("*", workspaceMiddleware(db));
  api.use("*", rateLimit({ windowMs: 60_000, maxRequests: 100 }));

  // Mount route groups
  api.route("/agents", agentRoutes(db));
  api.route("/runs", runRoutes(db, events, queue));
  api.route("/connectors", connectorRoutes(db));
  api.route("/providers", providerRoutes(db));
  api.route("/workspaces", workspaceRoutes(db));
  api.route("/keys", apiKeyRoutes(db));
  api.route("/pipeline-versions", pipelineVersionRoutes(db));
  api.route("/chat", chatRoutes(db));

  app.route("/api", api);

  return app;
}

export { createEventBus } from "@gnana/core";
export { connectionManager } from "./ws.js";
export { JobQueue } from "./job-queue.js";
export { errorResponse } from "./utils/errors.js";
export type { ErrorCode } from "./utils/errors.js";
export type { GnanaServerConfig as ServerConfig };
