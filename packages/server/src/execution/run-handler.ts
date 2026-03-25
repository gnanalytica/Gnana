import { executeDAG, resumeDAG } from "@gnana/core";
import type { EventBus, DAGContext, DAGPipeline } from "@gnana/core";
import { agents, runs, eq, type Database } from "@gnana/db";
import { DrizzleDAGRunStore } from "./dag-run-store.js";
import { resolveProviders } from "./resolve-providers.js";
import { resolveTools } from "./resolve-tools.js";
import type { ToolsConfig } from "./resolve-tools.js";
import { jobLog } from "../logger.js";

interface RunHandlerDeps {
  db: Database;
  events: EventBus;
}

/**
 * Mark a run as failed in the DB and emit the run:failed event.
 */
async function markFailed(
  db: Database,
  events: EventBus,
  runId: string,
  error: string,
): Promise<void> {
  await db
    .update(runs)
    .set({ status: "failed", error, updatedAt: new Date() })
    .where(eq(runs.id, runId));
  await events.emit("run:failed", { runId, error });
}

/**
 * Creates a job handler for "run:execute" — loads agent + run from DB,
 * resolves providers & tools, builds a DAGContext, and calls executeDAG().
 */
export function createRunHandler(deps: RunHandlerDeps) {
  const { db, events } = deps;

  return async (payload: Record<string, unknown>): Promise<void> => {
    const runId = payload.runId as string;
    const agentId = payload.agentId as string;
    const log = jobLog.child({ fn: "runHandler", runId, agentId });

    // 1. Load agent from DB
    const agentRows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    const agent = agentRows[0];
    if (!agent) {
      log.warn("Agent not found");
      await markFailed(db, events, runId, "Agent not found");
      return;
    }

    // 2. Load run from DB (for triggerData)
    const runRows = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    const run = runRows[0];
    if (!run) {
      log.warn("Run not found");
      await markFailed(db, events, runId, "Run not found");
      return;
    }

    const workspaceId = agent.workspaceId;
    if (!workspaceId) {
      log.warn("Agent has no workspace");
      await markFailed(db, events, runId, "Agent has no workspace");
      return;
    }

    try {
      // 3. Resolve LLM providers for this workspace
      const llm = await resolveProviders(db, workspaceId);

      // 4. Resolve tools from agent's toolsConfig
      const toolsConfig = (agent.toolsConfig ?? {}) as ToolsConfig;
      const tools = await resolveTools(toolsConfig, workspaceId, db);

      // 5. Get pipeline from agent's pipelineConfig
      const pipeline = agent.pipelineConfig as DAGPipeline | null;
      if (!pipeline || !pipeline.nodes || pipeline.nodes.length === 0) {
        log.warn("Agent has no pipeline configured");
        await markFailed(db, events, runId, "Agent has no pipeline configured");
        return;
      }

      // 6. Create the DAG run store
      const store = new DrizzleDAGRunStore(db);

      // 7. Build DAGContext
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

      // 8. Update run status to "executing" and emit run:started
      await db
        .update(runs)
        .set({ status: "executing", updatedAt: new Date() })
        .where(eq(runs.id, runId));
      await events.emit("run:started", { runId, agentId });

      log.info("Starting DAG execution");

      // 9. Execute the DAG
      await executeDAG(ctx);

      log.info("DAG execution finished");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      log.error({ err: error }, "DAG execution failed");
      await markFailed(db, events, runId, message);
    }
  };
}

/**
 * Creates a job handler for "run:resume" — same setup as runHandler
 * but calls resumeDAG() to continue from a human gate.
 */
export function createResumeHandler(deps: RunHandlerDeps) {
  const { db, events } = deps;

  return async (payload: Record<string, unknown>): Promise<void> => {
    const runId = payload.runId as string;
    const agentId = payload.agentId as string;
    const log = jobLog.child({ fn: "resumeHandler", runId, agentId });

    // 1. Load agent from DB
    const agentRows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    const agent = agentRows[0];
    if (!agent) {
      log.warn("Agent not found");
      await markFailed(db, events, runId, "Agent not found");
      return;
    }

    // 2. Load run from DB
    const runRows = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    const run = runRows[0];
    if (!run) {
      log.warn("Run not found");
      await markFailed(db, events, runId, "Run not found");
      return;
    }

    const workspaceId = agent.workspaceId;
    if (!workspaceId) {
      log.warn("Agent has no workspace");
      await markFailed(db, events, runId, "Agent has no workspace");
      return;
    }

    try {
      // 3. Resolve LLM providers
      const llm = await resolveProviders(db, workspaceId);

      // 4. Resolve tools
      const toolsConfig = (agent.toolsConfig ?? {}) as ToolsConfig;
      const tools = await resolveTools(toolsConfig, workspaceId, db);

      // 5. Get pipeline
      const pipeline = agent.pipelineConfig as DAGPipeline | null;
      if (!pipeline || !pipeline.nodes || pipeline.nodes.length === 0) {
        log.warn("Agent has no pipeline configured");
        await markFailed(db, events, runId, "Agent has no pipeline configured");
        return;
      }

      // 6. Create the DAG run store
      const store = new DrizzleDAGRunStore(db);

      // 7. Build DAGContext
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

      log.info("Resuming DAG execution");

      // 8. Resume the DAG from the paused human gate
      await resumeDAG(ctx);

      log.info("DAG resume finished");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      log.error({ err: error }, "DAG resume failed");
      await markFailed(db, events, runId, message);
    }
  };
}
