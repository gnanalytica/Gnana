import { Hono } from "hono";
import type { Context } from "hono";
import { createHmac, timingSafeEqual } from "crypto";
import { eq, agents, runs, type Database } from "@gnana/db";
import { type JobQueue } from "../job-queue.js";
import { serverLog } from "../logger.js";
import { errorResponse } from "../utils/errors.js";

interface WebhookTriggerConfig {
  type: "webhook";
  secret?: string;
}

export function webhookRoutes(db: Database, queue: JobQueue) {
  const app = new Hono();

  // POST /:agentId — trigger an agent run via webhook (no auth required)
  app.post("/:agentId", async (c) => {
    const agentId = c.req.param("agentId");

    // 1. Load agent by ID, check enabled
    const agentResult = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId));

    if (agentResult.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Agent not found");
    }

    const agent = agentResult[0]!;

    if (!agent.enabled) {
      return errorResponse(c, 404, "NOT_FOUND", "Agent not found");
    }

    // 2. Find webhook trigger in agent.triggersConfig
    const triggersConfig = (agent.triggersConfig ?? []) as WebhookTriggerConfig[];
    const webhookTrigger = triggersConfig.find((t) => t.type === "webhook");

    if (!webhookTrigger) {
      return errorResponse(c, 400, "VALIDATION_ERROR", "Agent has no webhook trigger configured");
    }

    // 3. If webhook has a secret, verify HMAC-SHA256 signature from x-gnana-signature header
    if (webhookTrigger.secret) {
      const signature = c.req.header("x-gnana-signature");
      if (!signature) {
        return errorResponse(c, 401, "UNAUTHORIZED", "Missing x-gnana-signature header");
      }

      const rawBody = await c.req.text();
      const expectedHmac = createHmac("sha256", webhookTrigger.secret)
        .update(rawBody)
        .digest("hex");
      const expected = `sha256=${expectedHmac}`;

      let valid = false;
      try {
        valid = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      } catch {
        valid = false;
      }

      if (!valid) {
        serverLog.warn({ agentId }, "Webhook signature verification failed");
        return errorResponse(c, 401, "UNAUTHORIZED", "Invalid webhook signature");
      }

      // 4. Parse request body (already read as text for HMAC verification)
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = { raw: rawBody };
      }

      return enqueueRun(c, db, queue, agent, body);
    }

    // 4. Parse request body (no signature check needed)
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    return enqueueRun(c, db, queue, agent, body);
  });

  return app;
}

async function enqueueRun(
  c: Context,
  db: Database,
  queue: JobQueue,
  agent: { id: string; workspaceId: string | null },
  body: unknown,
) {
  // 5. Create run with triggerType='webhook', triggerData=body
  const runResult = await db
    .insert(runs)
    .values({
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      status: "queued",
      triggerType: "webhook",
      triggerData: (body ?? {}) as Record<string, unknown>,
    })
    .returning({ id: runs.id });

  const runId = runResult[0]!.id;

  // 6. Enqueue run:execute job
  await queue.enqueue("run:execute", { runId });

  serverLog.info({ agentId: agent.id, runId }, "Webhook triggered run enqueued");

  // 7. Return 202 with runId
  return c.json({ runId }, 202);
}
