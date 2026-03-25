import type { DAGRunStore } from "@gnana/core";
import { runs, runLogs, eq, and, asc, type Database } from "@gnana/db";

export class DrizzleDAGRunStore implements DAGRunStore {
  constructor(private db: Database) {}

  async updateStatus(runId: string, status: string): Promise<void> {
    await this.db
      .update(runs)
      .set({ status, updatedAt: new Date() })
      .where(eq(runs.id, runId));
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
      .orderBy(asc(runLogs.createdAt))
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
    await this.db
      .update(runs)
      .set({ error, updatedAt: new Date() })
      .where(eq(runs.id, runId));
  }
}
