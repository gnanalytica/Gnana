import cron, { type ScheduledTask } from "node-cron";
import { eq, and, agents, runs, type Database } from "@gnana/db";
import type { JobQueue } from "../job-queue.js";
import { jobLog } from "../logger.js";

export interface CronTrigger {
  type: "cron";
  schedule: string;
  timezone?: string;
}

export class CronManager {
  private db: Database;
  private queue: JobQueue;
  private tasks = new Map<string, ScheduledTask>();

  constructor(db: Database, queue: JobQueue) {
    this.db = db;
    this.queue = queue;
  }

  /** Load all enabled agents with cron triggers and schedule each. */
  async start() {
    jobLog.info("CronManager starting — loading cron triggers from DB");

    const allAgents = await this.db.select().from(agents).where(eq(agents.enabled, true));

    let scheduled = 0;
    for (const agent of allAgents) {
      const triggers = agent.triggersConfig as unknown[];
      if (!Array.isArray(triggers)) continue;

      for (const trigger of triggers) {
        const t = trigger as Record<string, unknown>;
        if (t.type === "cron" && typeof t.schedule === "string") {
          this.schedule(agent.id, agent.workspaceId, t as unknown as CronTrigger);
          scheduled++;
        }
      }
    }

    jobLog.info({ scheduled }, "CronManager started — cron triggers scheduled");
  }

  /** Stop existing cron for agent, reload config from DB, reschedule if still has cron trigger. */
  async reload(agentId: string) {
    // Stop existing task for this agent
    const existing = this.tasks.get(agentId);
    if (existing) {
      existing.stop();
      this.tasks.delete(agentId);
      jobLog.info({ agentId }, "Stopped existing cron task for agent");
    }

    // Reload agent from DB
    const result = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.enabled, true)));

    const agent = result[0];
    if (!agent) {
      jobLog.info({ agentId }, "Agent not found or disabled — cron not rescheduled");
      return;
    }

    const triggers = agent.triggersConfig as unknown[];
    if (!Array.isArray(triggers)) return;

    for (const trigger of triggers) {
      const t = trigger as Record<string, unknown>;
      if (t.type === "cron" && typeof t.schedule === "string") {
        this.schedule(agent.id, agent.workspaceId, t as unknown as CronTrigger);
        jobLog.info({ agentId, schedule: t.schedule }, "Rescheduled cron trigger for agent");
        return; // Only one cron trigger per agent
      }
    }

    jobLog.info({ agentId }, "No cron trigger found after reload — agent will not be scheduled");
  }

  /** Stop all cron tasks. */
  stop() {
    for (const [agentId, task] of this.tasks) {
      task.stop();
      jobLog.info({ agentId }, "Stopped cron task");
    }
    this.tasks.clear();
    jobLog.info("CronManager stopped — all cron tasks cleared");
  }

  /** Schedule a cron task for an agent. Creates a run and enqueues a job when cron fires. */
  private schedule(agentId: string, workspaceId: string | null, trigger: CronTrigger) {
    if (!cron.validate(trigger.schedule)) {
      jobLog.error({ agentId, schedule: trigger.schedule }, "Invalid cron schedule — skipping");
      return;
    }

    const task = cron.schedule(
      trigger.schedule,
      async () => {
        try {
          jobLog.info({ agentId, schedule: trigger.schedule }, "Cron trigger fired");

          // Create a new run for this scheduled execution
          const [run] = await this.db
            .insert(runs)
            .values({
              agentId,
              workspaceId,
              triggerType: "cron",
              triggerData: { schedule: trigger.schedule, timezone: trigger.timezone },
              status: "queued",
            })
            .returning();

          if (!run) {
            jobLog.error({ agentId }, "Failed to create run for cron trigger");
            return;
          }

          // Enqueue the run for execution
          await this.queue.enqueue("run:execute", {
            runId: run.id,
            agentId,
            workspaceId,
          });

          jobLog.info({ agentId, runId: run.id }, "Cron-triggered run enqueued");
        } catch (error) {
          jobLog.error(
            { err: error, agentId, schedule: trigger.schedule },
            "Error handling cron trigger",
          );
        }
      },
      {
        scheduled: true,
        timezone: trigger.timezone,
      },
    );

    this.tasks.set(agentId, task);
  }
}
