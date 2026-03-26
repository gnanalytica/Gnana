# SaaS Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce plan limits, track usage, add audit logging, and implement connector health checks for production SaaS readiness.

**Architecture:** Wire existing planLimit middleware to remaining routes. Add usage tracking in the run handler. Create audit_logs table with logging utility. Add health check endpoints for connectors. Build dashboard pages for usage and audit logs.

**Tech Stack:** Drizzle ORM (schema + migrations), Hono (middleware + routes), Next.js + shadcn/ui (dashboard pages)

**Spec:** `docs/superpowers/specs/2026-03-25-saas-hardening-design.md`

---

## Task 1: DB Schema Changes (audit_logs table, connector health columns, seed plans)

**Files:**

- Modify: `packages/db/src/schema.ts` (add `auditLogs` table, add health columns to `connectors`)
- Create: `packages/db/src/seed.ts` (seed default plans)
- Modify: `packages/db/package.json` (already has `db:seed` script -- verify it exists)
- Run: `pnpm --filter @gnana/db db:generate` to create migration

**Steps:**

- [ ] Add `auditLogs` table to `packages/db/src/schema.ts`. Add it after the `usageRecords` table at the end of the file:

  ```typescript
  // ---- Audit Logs ----

  export const auditLogs = pgTable(
    "audit_logs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id),
      userId: uuid("user_id").references(() => users.id),
      action: text("action").notNull(),
      resourceType: text("resource_type").notNull(),
      resourceId: text("resource_id"),
      changes: jsonb("changes"),
      ipAddress: text("ip_address"),
      userAgent: text("user_agent"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("audit_logs_workspace_id_idx").on(table.workspaceId),
      index("audit_logs_action_idx").on(table.action),
      index("audit_logs_created_at_idx").on(table.createdAt),
    ],
  );
  ```

- [ ] Add `lastHealthStatus` and `lastHealthCheckAt` columns to the existing `connectors` table in `packages/db/src/schema.ts`. Add these two columns after the `updatedAt` field inside the connectors table definition:

  ```typescript
  // In the connectors table, add after updatedAt:
  lastHealthStatus: text("last_health_status"),
  lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
  ```

  The full connectors table should look like:

  ```typescript
  export const connectors = pgTable(
    "connectors",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      workspaceId: uuid("workspace_id").references(() => workspaces.id),
      type: text("type").notNull(),
      name: text("name").notNull(),
      authType: text("auth_type").notNull(),
      credentials: jsonb("credentials"),
      config: jsonb("config").notNull().default("{}"),
      enabled: boolean("enabled").notNull().default(true),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
      lastHealthStatus: text("last_health_status"),
      lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
    },
    (table) => [index("connectors_workspace_id_idx").on(table.workspaceId)],
  );
  ```

- [ ] Create `packages/db/src/seed.ts` with the following content:

  ```typescript
  import { createDatabase } from "./index.js";
  import { plans, workspaces } from "./schema.js";
  import { eq, isNull } from "drizzle-orm";

  const DEFAULT_PLANS = [
    {
      name: "free",
      displayName: "Free",
      maxAgents: 3,
      maxConnectors: 2,
      maxMembers: 1,
      maxRunsMonth: 100,
      priceMonthly: 0,
      priceYearly: 0,
      features: {
        communitySupport: true,
        customConnectors: false,
        prioritySupport: false,
        dedicatedInfra: false,
      },
    },
    {
      name: "pro",
      displayName: "Pro",
      maxAgents: -1,
      maxConnectors: 10,
      maxMembers: 10,
      maxRunsMonth: 1000,
      priceMonthly: 2900,
      priceYearly: 29000,
      features: {
        communitySupport: true,
        customConnectors: true,
        prioritySupport: true,
        dedicatedInfra: false,
      },
    },
    {
      name: "enterprise",
      displayName: "Enterprise",
      maxAgents: -1,
      maxConnectors: -1,
      maxMembers: -1,
      maxRunsMonth: -1,
      priceMonthly: 0,
      priceYearly: 0,
      features: {
        communitySupport: true,
        customConnectors: true,
        prioritySupport: true,
        dedicatedInfra: true,
      },
    },
  ];

  export async function seed(connectionString: string) {
    const db = createDatabase(connectionString);

    // Upsert plans (idempotent by unique name)
    for (const plan of DEFAULT_PLANS) {
      const existing = await db.select().from(plans).where(eq(plans.name, plan.name)).limit(1);
      if (existing.length === 0) {
        await db.insert(plans).values(plan);
        console.log(`  Created plan: ${plan.displayName}`);
      } else {
        console.log(`  Plan already exists: ${plan.displayName}`);
      }
    }

    // Auto-assign Free plan to workspaces that have no plan
    const freePlan = await db.select().from(plans).where(eq(plans.name, "free")).limit(1);
    if (freePlan[0]) {
      const updated = await db
        .update(workspaces)
        .set({ planId: freePlan[0].id })
        .where(isNull(workspaces.planId))
        .returning({ id: workspaces.id });
      if (updated.length > 0) {
        console.log(`  Assigned Free plan to ${updated.length} workspace(s)`);
      }
    }

    console.log("Seed complete.");
  }

  // CLI entry point: pnpm --filter @gnana/db db:seed
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    seed(dbUrl).catch(console.error);
  } else {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  ```

- [ ] Verify `packages/db/package.json` already has `"db:seed": "tsx src/seed.ts"` in scripts (it does per existing file -- no changes needed).

- [ ] Generate the Drizzle migration: `pnpm --filter @gnana/db db:generate`

- [ ] Run typecheck and build: `pnpm --filter @gnana/db typecheck && pnpm --filter @gnana/db build`

- [ ] Commit: `feat(db): add audit_logs table, connector health columns, and seed script`

---

## Task 2: Plan Limits Wiring and Usage Tracking

**Files:**

- Modify: `packages/server/src/routes/workspaces.ts` (add planLimit to member invite, auto-assign Free plan on workspace create)
- Modify: `packages/server/src/index.ts` (add token usage aggregation in run:execute handler)

**Steps:**

- [ ] In `packages/server/src/routes/workspaces.ts`, add imports for `planLimit` and required DB tables. Add these imports at the top of the file:

  ```typescript
  import { planLimit } from "../middleware/plan-limits.js";
  import {
    eq,
    and,
    workspaces,
    workspaceMembers,
    workspaceInvites,
    plans,
    type Database,
  } from "@gnana/db";
  ```

  Replace the existing import line:

  ```typescript
  import {
    eq,
    and,
    workspaces,
    workspaceMembers,
    workspaceInvites,
    type Database,
  } from "@gnana/db";
  ```

- [ ] Wire `planLimit` middleware to the member invite route. In `packages/server/src/routes/workspaces.ts`, change line 107 from:

  ```typescript
  app.post("/:id/members", requireRole("admin"), async (c) => {
  ```

  to:

  ```typescript
  app.post("/:id/members", requireRole("admin"), planLimit(db, "maxMembers", workspaceMembers), async (c) => {
  ```

- [ ] Auto-assign Free plan to new workspaces. In `packages/server/src/routes/workspaces.ts`, inside the `POST /` handler's transaction (after `await tx.insert(workspaceMembers)` and before `return ws;`), add:

  ```typescript
  // Auto-assign Free plan
  const freePlan = await tx.select().from(plans).where(eq(plans.name, "free")).limit(1);
  if (freePlan[0]) {
    await tx.update(workspaces).set({ planId: freePlan[0].id }).where(eq(workspaces.id, ws.id));
  }
  ```

  The full transaction block should become:

  ```typescript
  const workspace = await db.transaction(async (tx) => {
    const result = await tx
      .insert(workspaces)
      .values({
        name: data.name,
        slug,
        type: "team",
        ownerId: userId,
      })
      .returning();

    const ws = result[0]!;

    // Add creator as owner member
    await tx.insert(workspaceMembers).values({
      workspaceId: ws.id,
      userId,
      role: "owner",
      acceptedAt: new Date(),
    });

    // Auto-assign Free plan
    const freePlan = await tx.select().from(plans).where(eq(plans.name, "free")).limit(1);
    if (freePlan[0]) {
      await tx.update(workspaces).set({ planId: freePlan[0].id }).where(eq(workspaces.id, ws.id));
    }

    return ws;
  });
  ```

- [ ] Add token usage aggregation in `packages/server/src/index.ts`. First, add `usageRecords` to the import from `@gnana/db`:

  ```typescript
  import { createDatabase, agents, runs, usageRecords, eq, sql, type Database } from "@gnana/db";
  ```

  Then, inside the `queue.register("run:execute", ...)` callback, after the line `await events.emit("run:completed", { runId });` and before `jobLog.info({ runId, agentId }, "run:execute completed");`, add:

  ```typescript
  // Aggregate token usage into usage_records
  const completedRun = await db
    .select({
      inputTokens: runs.inputTokens,
      outputTokens: runs.outputTokens,
      workspaceId: runs.workspaceId,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);

  if (completedRun[0] && completedRun[0].workspaceId) {
    const totalTokens = (completedRun[0].inputTokens ?? 0) + (completedRun[0].outputTokens ?? 0);
    if (totalTokens > 0) {
      const period = new Date().toISOString().slice(0, 7);
      await db
        .insert(usageRecords)
        .values({
          workspaceId: completedRun[0].workspaceId,
          period,
          runsCount: 0,
          tokensUsed: totalTokens,
        })
        .onConflictDoUpdate({
          target: [usageRecords.workspaceId, usageRecords.period],
          set: {
            tokensUsed: sql`${usageRecords.tokensUsed} + ${totalTokens}`,
            updatedAt: new Date(),
          },
        });
    }
  }
  ```

- [ ] Run typecheck and build: `pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/server build`

- [ ] Commit: `feat(server): wire plan limits to member invites and add token usage tracking`

---

## Task 3: Audit Log Utility and Middleware

**Files:**

- Create: `packages/server/src/middleware/audit-log.ts`
- Modify: `packages/server/src/routes/agents.ts` (add logAudit calls)
- Modify: `packages/server/src/routes/runs.ts` (add logAudit calls)
- Modify: `packages/server/src/routes/connectors.ts` (add logAudit calls)
- Modify: `packages/server/src/routes/workspaces.ts` (add logAudit calls)
- Modify: `packages/server/src/routes/providers.ts` (add logAudit calls)
- Modify: `packages/server/src/routes/api-keys.ts` (add logAudit calls)

**Steps:**

- [ ] Create `packages/server/src/middleware/audit-log.ts` with the following content:

  ```typescript
  import { type Database, auditLogs } from "@gnana/db";
  import { serverLog } from "../logger.js";

  export interface AuditEntry {
    workspaceId: string;
    userId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    changes?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }

  const SENSITIVE_FIELDS = new Set([
    "credentials",
    "apiKey",
    "api_key",
    "keyHash",
    "key_hash",
    "passwordHash",
    "password_hash",
    "accessToken",
    "access_token",
    "refreshToken",
    "refresh_token",
  ]);

  function redact(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_FIELDS.has(key)) {
        result[key] = "***REDACTED***";
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  function redactChanges(changes: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      if (key === "before" || key === "after") {
        result[key] =
          value && typeof value === "object" ? redact(value as Record<string, unknown>) : value;
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  export async function logAudit(db: Database, entry: AuditEntry): Promise<void> {
    const sanitizedChanges = entry.changes ? redactChanges(entry.changes) : undefined;

    await db.insert(auditLogs).values({
      workspaceId: entry.workspaceId,
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      changes: sanitizedChanges,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    });
  }

  /** Fire-and-forget wrapper: logs errors but does not throw */
  export function logAuditAsync(db: Database, entry: AuditEntry): void {
    logAudit(db, entry).catch((err) => {
      serverLog.error({ err }, "Audit log write failed");
    });
  }

  /** Extract client IP from request headers (handles proxies) */
  export function getClientIp(req: Request): string | undefined {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim();
    const realIp = req.headers.get("x-real-ip");
    if (realIp) return realIp;
    return undefined;
  }
  ```

- [ ] Add audit logging to `packages/server/src/routes/agents.ts`. Add the import at the top:

  ```typescript
  import { logAuditAsync, getClientIp } from "../middleware/audit-log.js";
  ```

  After the `return c.json(result[0], 201);` in the `POST /` handler (line 83), add audit logging just before the return. The handler's end should become:

  ```typescript
  const result = await db
    .insert(agents)
    .values({
      name: data.name,
      description: data.description ?? "",
      systemPrompt: data.systemPrompt,
      toolsConfig: data.toolsConfig ?? {},
      llmConfig: data.llmConfig,
      triggersConfig: data.triggersConfig ?? [],
      approval: data.approval ?? "required",
      maxToolRounds: data.maxToolRounds ?? 10,
      workspaceId,
    })
    .returning();

  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "agent.created",
    resourceType: "agent",
    resourceId: result[0]!.id,
    changes: { after: result[0] },
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json(result[0], 201);
  ```

  In the `PUT /:id` handler, after the existing `return c.json(result[0]);` on line 116, add audit logging just before that return:

  ```typescript
  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "agent.updated",
    resourceType: "agent",
    resourceId: id,
    changes: { after: data },
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json(result[0]);
  ```

  In the `DELETE /:id` handler, after the `db.update` call and before `return c.json({ ok: true });`:

  ```typescript
  await db
    .update(agents)
    .set({ enabled: false })
    .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)));

  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "agent.deleted",
    resourceType: "agent",
    resourceId: id,
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json({ ok: true });
  ```

- [ ] Add audit logging to `packages/server/src/routes/runs.ts`. Add the import:

  ```typescript
  import { logAuditAsync, getClientIp } from "../middleware/audit-log.js";
  ```

  In the `POST /` handler, after `const run = result[0]!;` and before the usage tracking block:

  ```typescript
  const run = result[0]!;

  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "run.started",
    resourceType: "run",
    resourceId: run.id,
    changes: { after: { agentId: data.agentId, triggerType: data.triggerType ?? "manual" } },
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });
  ```

  In the `POST /:id/approve` handler, after `await events.emit(...)` and before `return c.json(result[0]);`:

  ```typescript
  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "run.approved",
    resourceType: "run",
    resourceId: id,
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json(result[0]);
  ```

  In the `POST /:id/reject` handler, after `await events.emit(...)` and before `return c.json(result[0]);`:

  ```typescript
  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "run.rejected",
    resourceType: "run",
    resourceId: id,
    changes: { reason: body.reason },
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json(result[0]);
  ```

- [ ] Add audit logging to `packages/server/src/routes/connectors.ts`. Add the import:

  ```typescript
  import { logAuditAsync, getClientIp } from "../middleware/audit-log.js";
  ```

  In the `POST /` handler, before `return c.json({ ...result[0], credentials: "***" }, 201);`:

  ```typescript
  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "connector.created",
    resourceType: "connector",
    resourceId: result[0]!.id,
    changes: { after: { name: data.name, type: data.type, authType: data.authType } },
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json({ ...result[0], credentials: "***" }, 201);
  ```

  In the `DELETE /:id` handler, before `return c.json({ ok: true });`:

  ```typescript
  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "connector.deleted",
    resourceType: "connector",
    resourceId: id,
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json({ ok: true });
  ```

- [ ] Add audit logging to `packages/server/src/routes/workspaces.ts`. Add the import:

  ```typescript
  import { logAuditAsync, getClientIp } from "../middleware/audit-log.js";
  ```

  In the `POST /:id/members` handler, before `return c.json(result[0], 201);`:

  ```typescript
  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "member.invited",
    resourceType: "member",
    resourceId: result[0]!.id,
    changes: { after: { email: data.email, role: data.role ?? "viewer" } },
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json(result[0], 201);
  ```

  In the `PATCH /:id/members/:memberId` handler, before `return c.json(result[0]);`:

  ```typescript
  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "member.role_changed",
    resourceType: "member",
    resourceId: memberId,
    changes: { after: { role: data.role } },
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json(result[0]);
  ```

  In the `DELETE /:id/members/:memberId` handler, before `return c.json({ ok: true });`:

  ```typescript
  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "member.removed",
    resourceType: "member",
    resourceId: memberId,
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json({ ok: true });
  ```

- [ ] Add audit logging to `packages/server/src/routes/providers.ts`. Add the import:

  ```typescript
  import { logAuditAsync, getClientIp } from "../middleware/audit-log.js";
  ```

  In the `POST /` handler, before `return c.json({ ...result[0], apiKey: "***" }, 201);`:

  ```typescript
  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "provider.created",
    resourceType: "provider",
    resourceId: result[0]!.id,
    changes: { after: { name: data.name, type: data.type } },
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json({ ...result[0], apiKey: "***" }, 201);
  ```

  In the `DELETE /:id` handler, before `return c.json({ ok: true });`:

  ```typescript
  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "provider.deleted",
    resourceType: "provider",
    resourceId: id,
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json({ ok: true });
  ```

- [ ] Add audit logging to `packages/server/src/routes/api-keys.ts`. Add the import:

  ```typescript
  import { logAuditAsync, getClientIp } from "../middleware/audit-log.js";
  ```

  In the `POST /` handler, before the final `return c.json(...)`:

  ```typescript
  logAuditAsync(db, {
    workspaceId,
    userId,
    action: "api_key.created",
    resourceType: "api_key",
    resourceId: created.id,
    changes: { after: { name: body.name, prefix } },
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json(
    {
      id: created.id,
      name: created.name,
      key: fullKey,
      prefix: created.prefix,
      createdAt: created.createdAt,
    },
    201,
  );
  ```

  In the `DELETE /:id` handler, after the early return for not-found and before `return c.json({ ok: true });`:

  ```typescript
  logAuditAsync(db, {
    workspaceId,
    userId: c.get("userId"),
    action: "api_key.revoked",
    resourceType: "api_key",
    resourceId: id,
    ipAddress: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent"),
  });

  return c.json({ ok: true });
  ```

- [ ] Run typecheck and build: `pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/server build`

- [ ] Commit: `feat(server): add audit logging utility and wire to all mutation routes`

---

## Task 4: Audit Logs API Endpoint

**Files:**

- Create: `packages/server/src/routes/audit-logs.ts`
- Modify: `packages/server/src/index.ts` (mount the new route)

**Steps:**

- [ ] Create `packages/server/src/routes/audit-logs.ts` with the following content:

  ```typescript
  import { Hono } from "hono";
  import { eq, and, desc, sql, gte, lte, auditLogs, type Database } from "@gnana/db";
  import { requireRole } from "../middleware/rbac.js";

  export function auditLogRoutes(db: Database) {
    const app = new Hono();

    // List audit logs -- admin+ only
    app.get("/", requireRole("admin"), async (c) => {
      const workspaceId = c.get("workspaceId");
      const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
      const offset = Number(c.req.query("offset")) || 0;

      // Optional filters
      const actionFilter = c.req.query("action");
      const userFilter = c.req.query("userId");
      const fromDate = c.req.query("from");
      const toDate = c.req.query("to");

      const conditions = [eq(auditLogs.workspaceId, workspaceId)];

      if (actionFilter) {
        conditions.push(eq(auditLogs.action, actionFilter));
      }
      if (userFilter) {
        conditions.push(eq(auditLogs.userId, userFilter));
      }
      if (fromDate) {
        conditions.push(gte(auditLogs.createdAt, new Date(fromDate)));
      }
      if (toDate) {
        conditions.push(lte(auditLogs.createdAt, new Date(toDate)));
      }

      const whereClause = and(...conditions);

      const [result, countResult] = await Promise.all([
        db
          .select()
          .from(auditLogs)
          .where(whereClause)
          .orderBy(desc(auditLogs.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(auditLogs)
          .where(whereClause),
      ]);

      return c.json({
        data: result,
        total: countResult[0]?.count ?? 0,
        limit,
        offset,
      });
    });

    return app;
  }
  ```

- [ ] Mount the audit log routes in `packages/server/src/index.ts`. Add the import at the top with the other route imports:

  ```typescript
  import { auditLogRoutes } from "./routes/audit-logs.js";
  ```

  Add the route mount after the existing `api.route("/chat", chatRoutes(db));` line (around line 212):

  ```typescript
  api.route("/audit-logs", auditLogRoutes(db));
  ```

- [ ] Run typecheck and build: `pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/server build`

- [ ] Commit: `feat(server): add paginated audit logs API endpoint`

---

## Task 5: Connector Health Check Endpoint

**Files:**

- Modify: `packages/server/src/routes/connectors.ts` (add `POST /:id/health` endpoint)

**Steps:**

- [ ] Add the `POST /:id/health` endpoint to `packages/server/src/routes/connectors.ts`. Add it after the existing `POST /:id/test` endpoint (before `return app;`):

  ```typescript
  // POST /:id/health -- structured health check with persistent status
  app.post("/:id/health", requireRole("viewer"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");

    const result = await db
      .select()
      .from(connectors)
      .where(and(eq(connectors.id, id), eq(connectors.workspaceId, workspaceId)))
      .limit(1);

    const connector = result[0];
    if (!connector) return errorResponse(c, 404, "NOT_FOUND", "Connector not found");

    const startTime = Date.now();
    let status: "healthy" | "unhealthy" = "unhealthy";
    let error: string | undefined;

    try {
      const creds = decryptJson(connector.credentials) as Record<string, string> | null;
      const config = connector.config as Record<string, string>;

      switch (connector.type) {
        case "github": {
          const token = creds?.token;
          if (!token) throw new Error("No token configured");
          const res = await fetch("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${token}`, "User-Agent": "Gnana" },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
          status = "healthy";
          break;
        }
        case "slack": {
          const token = creds?.token;
          if (!token) throw new Error("No token configured");
          const res = await fetch("https://slack.com/api/auth.test", {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
          });
          const data = (await res.json()) as { ok: boolean; error?: string };
          if (!data.ok) throw new Error(`Slack error: ${data.error}`);
          status = "healthy";
          break;
        }
        case "http": {
          const baseUrl = config?.baseUrl || config?.healthEndpoint;
          if (!baseUrl) throw new Error("No base URL configured");
          const res = await fetch(baseUrl, {
            method: "GET",
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          status = "healthy";
          break;
        }
        default:
          // For unknown connector types, assume healthy (can't test)
          status = "healthy";
      }
    } catch (err) {
      status = "unhealthy";
      error = err instanceof Error ? err.message : "Unknown error";
    }

    const latencyMs = Date.now() - startTime;

    // Persist health status
    await db
      .update(connectors)
      .set({
        lastHealthStatus: status,
        lastHealthCheckAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, id));

    return c.json({ status, latencyMs, error });
  });
  ```

- [ ] Run typecheck and build: `pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/server build`

- [ ] Commit: `feat(server): add connector health check endpoint with persistent status`

---

## Task 6: Usage Dashboard Page

**Files:**

- Modify: `apps/dashboard/src/app/(dashboard)/settings/billing/page.tsx` (replace stub with live data)

**Steps:**

- [ ] Replace the entire contents of `apps/dashboard/src/app/(dashboard)/settings/billing/page.tsx` with:

  ```tsx
  "use client";

  import { useState, useEffect, useCallback } from "react";
  import { Check, Loader2 } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import { Badge } from "@/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import { Separator } from "@/components/ui/separator";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { api } from "@/lib/api";
  import { useWorkspaces } from "@/lib/hooks/use-workspaces";

  interface UsageData {
    plan: {
      id: string;
      name: string;
      displayName: string;
      maxAgents: number;
      maxConnectors: number;
      maxMembers: number;
      maxRunsMonth: number;
      priceMonthly: number;
    } | null;
    usage: {
      agents: { current: number; limit: number };
      connectors: { current: number; limit: number };
      members: { current: number; limit: number };
      runsThisMonth: { current: number; limit: number };
      tokensThisMonth: number;
    };
    history: Array<{ period: string; runs: number; tokens: number }>;
  }

  interface PlanFeature {
    text: string;
    included: boolean;
  }

  interface PlanCard {
    name: string;
    price: string;
    period: string;
    description: string;
    features: PlanFeature[];
    cta: string;
  }

  const planCards: PlanCard[] = [
    {
      name: "Free",
      price: "$0",
      period: "forever",
      description: "For individuals and small experiments.",
      cta: "Current Plan",
      features: [
        { text: "3 agents", included: true },
        { text: "100 runs / month", included: true },
        { text: "1 team member", included: true },
        { text: "Community support", included: true },
        { text: "Custom connectors", included: false },
        { text: "Priority support", included: false },
      ],
    },
    {
      name: "Pro",
      price: "$29",
      period: "per month",
      description: "For teams building production agents.",
      cta: "Upgrade to Pro",
      features: [
        { text: "Unlimited agents", included: true },
        { text: "1,000 runs / month", included: true },
        { text: "10 team members", included: true },
        { text: "Priority support", included: true },
        { text: "Custom connectors", included: true },
        { text: "Dedicated infrastructure", included: false },
      ],
    },
    {
      name: "Enterprise",
      price: "Custom",
      period: "contact us",
      description: "For organizations with advanced needs.",
      cta: "Contact Sales",
      features: [
        { text: "Unlimited agents", included: true },
        { text: "Unlimited runs", included: true },
        { text: "Unlimited team members", included: true },
        { text: "Dedicated support", included: true },
        { text: "Custom connectors", included: true },
        { text: "Dedicated infrastructure", included: true },
      ],
    },
  ];

  function UsageBar({ current, limit }: { current: number; limit: number }) {
    const isUnlimited = limit === -1;
    const pct = isUnlimited ? 100 : limit > 0 ? Math.min((current / limit) * 100, 100) : 0;

    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{current.toLocaleString()} used</span>
          <span>{isUnlimited ? "Unlimited" : `${limit.toLocaleString()} limit`}</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isUnlimited ? "bg-green-500" : "bg-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  export default function BillingPage() {
    const { current: workspace } = useWorkspaces();
    const [usageData, setUsageData] = useState<UsageData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchUsage = useCallback(async () => {
      if (!workspace) return;
      try {
        setIsLoading(true);
        const res = await api.fetch(`/api/workspaces/${workspace.id}/usage`);
        const data = (await res.json()) as UsageData;
        setUsageData(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load usage data");
      } finally {
        setIsLoading(false);
      }
    }, [workspace]);

    useEffect(() => {
      fetchUsage();
    }, [fetchUsage]);

    if (isLoading) {
      return (
        <div className="p-8 max-w-4xl flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (error || !usageData) {
      return (
        <div className="p-8 max-w-4xl space-y-8">
          <div>
            <h1 className="text-2xl font-bold">Billing & Plans</h1>
            <p className="text-muted-foreground mt-1">Manage your subscription and view usage.</p>
          </div>
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {error ?? "Failed to load usage data. Please try again."}
            </CardContent>
          </Card>
        </div>
      );
    }

    const currentPlanName = usageData.plan?.name?.toLowerCase() ?? "free";

    return (
      <div className="p-8 max-w-4xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold">Billing & Plans</h1>
          <p className="text-muted-foreground mt-1">Manage your subscription and view usage.</p>
        </div>

        <Separator />

        {/* Current Usage */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Current Usage</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Agents</CardTitle>
              </CardHeader>
              <CardContent>
                <UsageBar
                  current={usageData.usage.agents.current}
                  limit={usageData.usage.agents.limit}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Connectors
                </CardTitle>
              </CardHeader>
              <CardContent>
                <UsageBar
                  current={usageData.usage.connectors.current}
                  limit={usageData.usage.connectors.limit}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Team Members
                </CardTitle>
              </CardHeader>
              <CardContent>
                <UsageBar
                  current={usageData.usage.members.current}
                  limit={usageData.usage.members.limit}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Runs this month
                </CardTitle>
              </CardHeader>
              <CardContent>
                <UsageBar
                  current={usageData.usage.runsThisMonth.current}
                  limit={usageData.usage.runsThisMonth.limit}
                />
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Tokens used this month</span>
                <span className="text-sm font-semibold">
                  {usageData.usage.tokensThisMonth.toLocaleString()} tokens
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <Separator />

        {/* Plans */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Plans</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {planCards.map((plan) => {
              const isCurrent = plan.name.toLowerCase() === currentPlanName;
              return (
                <Card key={plan.name} className={isCurrent ? "border-primary shadow-sm" : ""}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      {isCurrent && (
                        <Badge variant="secondary" className="border-0">
                          Current
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2">
                      <span className="text-3xl font-bold">{plan.price}</span>
                      <span className="text-sm text-muted-foreground ml-1">/ {plan.period}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2">
                      {plan.features.map((feature) => (
                        <li key={feature.text} className="flex items-center gap-2 text-sm">
                          <Check
                            className={`h-4 w-4 shrink-0 ${
                              feature.included ? "text-primary" : "text-muted-foreground/30"
                            }`}
                          />
                          <span className={feature.included ? "" : "text-muted-foreground/50"}>
                            {feature.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      variant={isCurrent ? "outline" : "default"}
                      className="w-full"
                      disabled={isCurrent}
                      onClick={() => {
                        if (!isCurrent) {
                          window.location.href =
                            "mailto:sales@gnanalytica.com?subject=Plan Upgrade";
                        }
                      }}
                    >
                      {isCurrent ? "Current Plan" : plan.cta}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <Separator />

        {/* Usage History */}
        {usageData.history.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Usage History</h2>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Runs</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usageData.history.map((h) => (
                      <TableRow key={h.period}>
                        <TableCell className="font-medium">{h.period}</TableCell>
                        <TableCell className="text-right">{h.runs.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{h.tokens.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] Add the `GET /:id/usage` endpoint to `packages/server/src/routes/workspaces.ts`. Add additional imports at the top (merge with existing imports from `@gnana/db`):

  ```typescript
  import {
    eq,
    and,
    desc,
    gte,
    workspaces,
    workspaceMembers,
    workspaceInvites,
    plans,
    agents,
    connectors,
    usageRecords,
    type Database,
  } from "@gnana/db";
  import { sql } from "drizzle-orm";
  ```

  Note: The `sql` tag must be imported from `drizzle-orm` directly if not already re-exported. Check if `@gnana/db` re-exports `sql` (it does, per `packages/db/src/index.ts`). So the import should be:

  ```typescript
  import {
    eq,
    and,
    desc,
    gte,
    sql,
    workspaces,
    workspaceMembers,
    workspaceInvites,
    plans,
    agents,
    connectors,
    usageRecords,
    type Database,
  } from "@gnana/db";
  ```

  Add the endpoint before `return app;` at the end of `workspaceRoutes`:

  ```typescript
  // Get workspace usage and plan details
  app.get("/:id/usage", requireRole("viewer"), async (c) => {
    const paramId = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    if (paramId !== workspaceId) {
      return errorResponse(c, 403, "FORBIDDEN", "Workspace mismatch");
    }

    // Fetch plan
    const ws = await db
      .select({ planId: workspaces.planId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    let plan = null;
    if (ws[0]?.planId) {
      const planRows = await db.select().from(plans).where(eq(plans.id, ws[0].planId)).limit(1);
      plan = planRows[0] ?? null;
    }

    // Count current resources
    const [agentCount, connectorCount, memberCount] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(agents)
        .where(eq(agents.workspaceId, workspaceId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(connectors)
        .where(eq(connectors.workspaceId, workspaceId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId)),
    ]);

    // Current month usage
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const currentUsage = await db
      .select()
      .from(usageRecords)
      .where(and(eq(usageRecords.workspaceId, workspaceId), eq(usageRecords.period, currentPeriod)))
      .limit(1);

    // Last 6 months usage history
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const historyStart = sixMonthsAgo.toISOString().slice(0, 7);

    const usageHistory = await db
      .select()
      .from(usageRecords)
      .where(and(eq(usageRecords.workspaceId, workspaceId), gte(usageRecords.period, historyStart)))
      .orderBy(desc(usageRecords.period))
      .limit(6);

    return c.json({
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            displayName: plan.displayName,
            maxAgents: plan.maxAgents,
            maxConnectors: plan.maxConnectors,
            maxMembers: plan.maxMembers,
            maxRunsMonth: plan.maxRunsMonth,
            priceMonthly: plan.priceMonthly,
          }
        : null,
      usage: {
        agents: { current: agentCount[0]?.count ?? 0, limit: plan?.maxAgents ?? -1 },
        connectors: {
          current: connectorCount[0]?.count ?? 0,
          limit: plan?.maxConnectors ?? -1,
        },
        members: { current: memberCount[0]?.count ?? 0, limit: plan?.maxMembers ?? -1 },
        runsThisMonth: {
          current: currentUsage[0]?.runsCount ?? 0,
          limit: plan?.maxRunsMonth ?? -1,
        },
        tokensThisMonth: currentUsage[0]?.tokensUsed ?? 0,
      },
      history: usageHistory.map((u) => ({
        period: u.period,
        runs: u.runsCount,
        tokens: u.tokensUsed,
      })),
    });
  });
  ```

- [ ] Run typecheck and build: `pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/server build && pnpm --filter dashboard typecheck`

- [ ] Commit: `feat: add usage API endpoint and live billing dashboard page`

---

## Task 7: Audit Log Dashboard Page

**Files:**

- Create: `apps/dashboard/src/app/(dashboard)/settings/audit-log/page.tsx`
- Modify: `apps/dashboard/src/app/(dashboard)/settings/page.tsx` (add Audit Log quick-link)

**Steps:**

- [ ] Create `apps/dashboard/src/app/(dashboard)/settings/audit-log/page.tsx` with the following content:

  ```tsx
  "use client";

  import { useState, useEffect, useCallback } from "react";
  import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import { Badge } from "@/components/ui/badge";
  import { Card, CardContent } from "@/components/ui/card";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
  import { api } from "@/lib/api";
  import { useWorkspaces } from "@/lib/hooks/use-workspaces";

  interface AuditLogEntry {
    id: string;
    workspaceId: string;
    userId: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    changes: Record<string, unknown> | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
  }

  interface AuditLogResponse {
    data: AuditLogEntry[];
    total: number;
    limit: number;
    offset: number;
  }

  const AUDIT_ACTIONS = [
    "agent.created",
    "agent.updated",
    "agent.deleted",
    "run.started",
    "run.approved",
    "run.rejected",
    "connector.created",
    "connector.deleted",
    "member.invited",
    "member.removed",
    "member.role_changed",
    "provider.created",
    "provider.deleted",
    "api_key.created",
    "api_key.revoked",
  ];

  const PAGE_SIZE = 50;

  function actionBadgeVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
    if (action.includes("deleted") || action.includes("revoked") || action.includes("removed")) {
      return "destructive";
    }
    if (action.includes("created") || action.includes("started") || action.includes("invited")) {
      return "default";
    }
    return "secondary";
  }

  export default function AuditLogPage() {
    const { current: workspace } = useWorkspaces();
    const [logs, setLogs] = useState<AuditLogEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [actionFilter, setActionFilter] = useState<string>("all");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");

    // Detail dialog
    const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

    const fetchLogs = useCallback(async () => {
      if (!workspace) return;
      try {
        setIsLoading(true);
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(offset));
        if (actionFilter && actionFilter !== "all") {
          params.set("action", actionFilter);
        }
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);

        const res = await api.fetch(`/api/audit-logs?${params.toString()}`);
        const data = (await res.json()) as AuditLogResponse;
        setLogs(data.data);
        setTotal(data.total);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load audit logs");
      } finally {
        setIsLoading(false);
      }
    }, [workspace, offset, actionFilter, fromDate, toDate]);

    useEffect(() => {
      fetchLogs();
    }, [fetchLogs]);

    const handleFilterChange = () => {
      setOffset(0);
    };

    const totalPages = Math.ceil(total / PAGE_SIZE);
    const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

    return (
      <div className="p-8 max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-muted-foreground mt-1">View workspace activity history.</p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Action</Label>
                <Select
                  value={actionFilter}
                  onValueChange={(v) => {
                    setActionFilter(v);
                    handleFilterChange();
                  }}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="All actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actions</SelectItem>
                    {AUDIT_ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    handleFilterChange();
                  }}
                  className="w-40"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">To</Label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    handleFilterChange();
                  }}
                  className="w-40"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">{error}</CardContent>
          </Card>
        ) : logs.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No audit log entries found.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>Resource ID</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead className="text-right">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant={actionBadgeVariant(log.action)}>{log.action}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{log.resourceType}</TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {log.resourceId ? log.resourceId.slice(0, 8) + "..." : "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {log.ipAddress ?? "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {log.changes && (
                            <Button variant="ghost" size="sm" onClick={() => setSelectedLog(log)}>
                              View
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Pagination */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {offset + 1}--{Math.min(offset + PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Detail Dialog */}
        <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Audit Log Details</DialogTitle>
            </DialogHeader>
            {selectedLog && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Action:</span>{" "}
                    <Badge variant={actionBadgeVariant(selectedLog.action)}>
                      {selectedLog.action}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Resource:</span>{" "}
                    {selectedLog.resourceType}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Resource ID:</span>{" "}
                    <span className="font-mono text-xs">{selectedLog.resourceId ?? "-"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">User ID:</span>{" "}
                    <span className="font-mono text-xs">{selectedLog.userId ?? "-"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Timestamp:</span>{" "}
                    {new Date(selectedLog.createdAt).toLocaleString()}
                  </div>
                  <div>
                    <span className="text-muted-foreground">IP:</span>{" "}
                    {selectedLog.ipAddress ?? "-"}
                  </div>
                </div>
                {selectedLog.changes && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Changes:</p>
                    <pre className="bg-muted rounded-md p-4 text-xs overflow-auto max-h-80">
                      {JSON.stringify(selectedLog.changes, null, 2)}
                    </pre>
                  </div>
                )}
                {selectedLog.userAgent && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">User Agent:</p>
                    <p className="text-xs text-muted-foreground break-all">
                      {selectedLog.userAgent}
                    </p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }
  ```

- [ ] Add the Audit Log quick-link to `apps/dashboard/src/app/(dashboard)/settings/page.tsx`. Add `ScrollText` to the lucide-react import:

  ```typescript
  import { Users, CreditCard, ScrollText, ChevronRight } from "lucide-react";
  ```

  Then add a new `<Link>` card inside the `<div className="grid gap-3 sm:grid-cols-2">` element, after the Billing & Plans card:

  ```tsx
  <Link href="/settings/audit-log">
    <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
      <CardContent className="flex items-center gap-3 py-4">
        <div className="flex items-center justify-center h-9 w-9 rounded-md bg-primary/10 text-primary shrink-0">
          <ScrollText className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Audit Log</p>
          <p className="text-xs text-muted-foreground">View workspace activity history</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </CardContent>
    </Card>
  </Link>
  ```

  Update the grid to use 3 columns on larger screens since there are now 3 cards:

  ```tsx
  <div className="grid gap-3 sm:grid-cols-3">
  ```

- [ ] Run typecheck and build: `pnpm --filter dashboard typecheck && pnpm --filter dashboard build`

- [ ] Commit: `feat(dashboard): add audit log page and settings quick-link`

---

## Task 8: Connector Health Indicators

**Files:**

- Modify: `apps/dashboard/src/types/index.ts` (add health fields to Connector type)
- Modify: `apps/dashboard/src/components/connectors/connector-card.tsx` (add health dot indicator)

**Steps:**

- [ ] Add `lastHealthStatus` and `lastHealthCheckAt` to the `Connector` interface in `apps/dashboard/src/types/index.ts`. Add these two fields after the `updatedAt` field:

  ```typescript
  export interface Connector {
    id: string;
    workspaceId: string;
    type: string;
    name: string;
    authType: string;
    credentials: Record<string, unknown> | null;
    config: Record<string, unknown>;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
    lastHealthStatus: "healthy" | "unhealthy" | null;
    lastHealthCheckAt: string | null;
  }
  ```

- [ ] Add a health status indicator to `apps/dashboard/src/components/connectors/connector-card.tsx`. In the component JSX, inside the `<CardHeader>` section, add a health dot next to the status badge. Find the existing `<Badge>` that shows "Active"/"Disabled" and add the health indicator after it:

  Replace the block:

  ```tsx
  <Badge
    variant={status === "active" ? "default" : "destructive"}
    className={status === "active" ? "bg-green-600 hover:bg-green-600/80" : ""}
  >
    {status === "active" ? "Active" : "Disabled"}
  </Badge>
  ```

  With:

  ```tsx
  <div className="flex items-center gap-2">
    {connector.lastHealthStatus && (
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${
          connector.lastHealthStatus === "healthy" ? "bg-green-500" : "bg-red-500"
        }`}
        title={`Health: ${connector.lastHealthStatus}${
          connector.lastHealthCheckAt
            ? ` (checked ${new Date(connector.lastHealthCheckAt).toLocaleString()})`
            : ""
        }`}
      />
    )}
    <Badge
      variant={status === "active" ? "default" : "destructive"}
      className={status === "active" ? "bg-green-600 hover:bg-green-600/80" : ""}
    >
      {status === "active" ? "Active" : "Disabled"}
    </Badge>
  </div>
  ```

- [ ] Run typecheck and build: `pnpm --filter dashboard typecheck && pnpm --filter dashboard build`

- [ ] Commit: `feat(dashboard): add connector health status indicators`
