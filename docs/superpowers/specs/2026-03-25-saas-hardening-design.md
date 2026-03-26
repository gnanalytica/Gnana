# SaaS Hardening Design Spec

**Date:** 2026-03-25
**Status:** Draft
**Scope:** Plan limits enforcement, usage dashboard, audit logs, connector health checks

---

## Overview

The Gnana platform has the foundation for multi-tenancy (workspaces, plans, usage records) but several pieces are either partially wired or missing entirely. This spec covers the remaining work to make the SaaS layer production-ready:

1. **Plan Limits Enforcement** -- finish wiring existing middleware to routes, seed default plans
2. **Usage Dashboard** -- replace stub billing page with live data from a new `/usage` API
3. **Audit Logs** -- new table, middleware, API, and dashboard page for compliance/debugging
4. **Connector Health Checks** -- structured health endpoint, persistent status, dashboard indicator

---

## 1. Plan Limits Enforcement

### Current State

- `plans` table exists with `maxAgents`, `maxConnectors`, `maxMembers`, `maxRunsMonth` columns
- `usage_records` table exists with `runsCount` and `tokensUsed`
- `planLimit()` middleware exists in `packages/server/src/middleware/plan-limits.ts` -- takes a `limitField` and a `table`, counts existing rows, compares against plan limit. Returns 403 if exceeded. Treats `-1` as unlimited.
- `planRunLimit()` middleware exists -- checks `usageRecords.runsCount` for the current `YYYY-MM` period against `maxRunsMonth`.
- `workspaces.planId` field links workspace to plan.

### Already Wired (no changes needed)

These routes already apply the plan limit middleware:

| Route              | Middleware                                   | File                                          |
| ------------------ | -------------------------------------------- | --------------------------------------------- |
| `POST /agents`     | `planLimit(db, "maxAgents", agents)`         | `packages/server/src/routes/agents.ts:52`     |
| `POST /connectors` | `planLimit(db, "maxConnectors", connectors)` | `packages/server/src/routes/connectors.ts:58` |
| `POST /runs`       | `planRunLimit(db)`                           | `packages/server/src/routes/runs.ts:59`       |

### Work Needed

#### 1a. Wire `planLimit` to member invites

The `POST /workspaces/:id/members` route in `packages/server/src/routes/workspaces.ts:107` creates invites but does not check `maxMembers`. Add the middleware:

```ts
// packages/server/src/routes/workspaces.ts
import { planLimit } from "../middleware/plan-limits.js";
import { workspaceMembers } from "@gnana/db";

// Invite a member to the workspace
app.post(
  "/:id/members",
  requireRole("admin"),
  planLimit(db, "maxMembers", workspaceMembers),
  async (c) => {
    /* existing handler */
  },
);
```

**Note:** `planLimit` counts rows where `table.workspaceId = workspaceId`. The `workspaceMembers` table has a `workspaceId` column, so this works directly. The count reflects accepted + pending members, which is the correct behavior -- you don't want to over-invite past your limit.

#### 1b. Increment `tokensUsed` on run completion

Currently, `runsCount` is incremented when a run is created (`packages/server/src/routes/runs.ts:91-105`). Token usage needs to be aggregated when a run completes.

Add to the `run:execute` job handler in `packages/server/src/index.ts`, after a run completes:

```ts
// packages/server/src/index.ts — inside queue.register("run:execute", ...)
// After the run completes, aggregate token usage into usage_records

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

This is placed in the job handler rather than the route because `inputTokens`/`outputTokens` are only populated after the LLM calls complete during execution.

#### 1c. Seed default plans

Create `packages/db/src/seed.ts`:

```ts
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
    maxAgents: -1, // unlimited
    maxConnectors: 10,
    maxMembers: 10,
    maxRunsMonth: 1000,
    priceMonthly: 2900, // $29.00 in cents
    priceYearly: 29000, // $290.00 in cents
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
    priceMonthly: 0, // custom pricing
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

Add script to `packages/db/package.json`:

```json
"scripts": {
  "db:seed": "tsx src/seed.ts"
}
```

#### 1d. Auto-assign Free plan to new workspaces

Modify `packages/server/src/routes/workspaces.ts` -- in the `POST /` handler, after creating the workspace, assign the Free plan:

```ts
// Inside the transaction, after inserting the workspace
const freePlan = await tx.select().from(plans).where(eq(plans.name, "free")).limit(1);
if (freePlan[0]) {
  await tx.update(workspaces).set({ planId: freePlan[0].id }).where(eq(workspaces.id, ws.id));
}
```

This adds one query inside the existing transaction. The `plans` table is small and read-only, so this is negligible overhead.

---

## 2. Usage Dashboard

### API: `GET /api/workspaces/:id/usage`

Add to `packages/server/src/routes/workspaces.ts`:

```ts
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
      connectors: { current: connectorCount[0]?.count ?? 0, limit: plan?.maxConnectors ?? -1 },
      members: { current: memberCount[0]?.count ?? 0, limit: plan?.maxMembers ?? -1 },
      runsThisMonth: { current: currentUsage[0]?.runsCount ?? 0, limit: plan?.maxRunsMonth ?? -1 },
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

**Required imports to add:** `plans`, `agents`, `connectors`, `usageRecords`, `gte`, `desc`.

### Response Shape

```json
{
  "plan": {
    "id": "uuid",
    "name": "free",
    "displayName": "Free",
    "maxAgents": 3,
    "maxConnectors": 2,
    "maxMembers": 1,
    "maxRunsMonth": 100,
    "priceMonthly": 0
  },
  "usage": {
    "agents": { "current": 1, "limit": 3 },
    "connectors": { "current": 0, "limit": 2 },
    "members": { "current": 1, "limit": 1 },
    "runsThisMonth": { "current": 42, "limit": 100 },
    "tokensThisMonth": 15340
  },
  "history": [
    { "period": "2026-03", "runs": 42, "tokens": 15340 },
    { "period": "2026-02", "runs": 87, "tokens": 31200 }
  ]
}
```

A limit of `-1` means unlimited -- the dashboard should render "Unlimited" instead of a progress bar.

### Dashboard: `apps/dashboard/src/app/(dashboard)/settings/billing/page.tsx`

Replace the current stub page. Key changes:

1. **Fetch live data** via `GET /api/workspaces/:id/usage` using an SWR-style hook or `useEffect`.
2. **Usage section** -- 4 usage bars (agents, connectors, members, runs this month). For unlimited limits (`-1`), show the current count with an "Unlimited" label and a full green bar.
3. **Token usage** -- show `tokensThisMonth` as a formatted number (e.g., "15,340 tokens"). No progress bar since there's no hard limit on tokens.
4. **Plan cards** -- keep the existing 3-plan card layout but highlight the actual current plan from the API response (not hardcoded `current: true` on Free).
5. **Usage history table** -- below the plan cards, a simple table showing last 6 months:

| Period  | Runs | Tokens |
| ------- | ---- | ------ |
| 2026-03 | 42   | 15,340 |
| 2026-02 | 87   | 31,200 |

6. **Upgrade CTA** -- non-current plan cards show "Upgrade" button. For now, this links to `mailto:sales@gnanalytica.com` or opens a Typeform/Cal.com link. No Stripe integration in this phase.

### Client SDK Addition

Add to `@gnana/client` (or use raw `api.fetch` in the dashboard):

```ts
// packages/client/src/index.ts — add to GnanaClient class
async getWorkspaceUsage(workspaceId: string) {
  const res = await this.fetch(`/api/workspaces/${workspaceId}/usage`);
  return res.json();
}
```

---

## 3. Audit Logs

### Schema: `audit_logs` table

Add to `packages/db/src/schema.ts`:

```ts
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

### Action Enum (Application-Level)

Not a Postgres enum -- use a TypeScript union type for flexibility. New actions can be added without a migration:

```ts
export type AuditAction =
  | "agent.created"
  | "agent.updated"
  | "agent.deleted"
  | "run.started"
  | "run.approved"
  | "run.rejected"
  | "connector.created"
  | "connector.deleted"
  | "member.invited"
  | "member.removed"
  | "member.role_changed"
  | "settings.updated"
  | "provider.created"
  | "provider.deleted"
  | "api_key.created"
  | "api_key.revoked";
```

### `changes` Column Structure

For create actions: `{ after: { ...newValues } }`
For update actions: `{ before: { ...oldValues }, after: { ...newValues } }`
For delete actions: `{ before: { ...deletedValues } }`

Sensitive fields (credentials, apiKey, passwordHash) must be redacted before storing. The middleware should strip these from the `changes` payload.

### Audit Logging Utility

Create `packages/server/src/middleware/audit-log.ts`:

```ts
import { type Database, auditLogs } from "@gnana/db";

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

/** Extract client IP from request headers (handles proxies) */
export function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;
  return undefined;
}
```

### Wiring Audit Logs to Routes

Rather than a global middleware (which would need complex response-body parsing), add explicit `logAudit()` calls at the point of successful mutation in each route handler. This is more predictable and lets us capture the exact resource ID and changes.

**Pattern:**

```ts
// In each POST/PUT/DELETE handler, after the DB mutation succeeds:
await logAudit(db, {
  workspaceId,
  userId: c.get("userId"),
  action: "agent.created",
  resourceType: "agent",
  resourceId: result[0].id,
  changes: { after: result[0] },
  ipAddress: getClientIp(c.req.raw),
  userAgent: c.req.header("user-agent"),
});
```

**Fire-and-forget:** Audit logging should not block the response. Use `.catch()` to swallow errors:

```ts
logAudit(db, { ... }).catch((err) => {
  serverLog.error({ err }, "Audit log write failed");
});
```

**Routes to instrument:**

| File                   | Route                           | Action                |
| ---------------------- | ------------------------------- | --------------------- |
| `routes/agents.ts`     | `POST /`                        | `agent.created`       |
| `routes/agents.ts`     | `PUT /:id`                      | `agent.updated`       |
| `routes/agents.ts`     | `DELETE /:id`                   | `agent.deleted`       |
| `routes/runs.ts`       | `POST /`                        | `run.started`         |
| `routes/runs.ts`       | `POST /:id/approve`             | `run.approved`        |
| `routes/runs.ts`       | `POST /:id/reject`              | `run.rejected`        |
| `routes/connectors.ts` | `POST /`                        | `connector.created`   |
| `routes/connectors.ts` | `DELETE /:id`                   | `connector.deleted`   |
| `routes/workspaces.ts` | `POST /:id/members`             | `member.invited`      |
| `routes/workspaces.ts` | `PATCH /:id/members/:memberId`  | `member.role_changed` |
| `routes/workspaces.ts` | `DELETE /:id/members/:memberId` | `member.removed`      |
| `routes/providers.ts`  | `POST /`                        | `provider.created`    |
| `routes/providers.ts`  | `DELETE /:id`                   | `provider.deleted`    |
| `routes/api-keys.ts`   | `POST /`                        | `api_key.created`     |
| `routes/api-keys.ts`   | `DELETE /:id`                   | `api_key.revoked`     |

### API: `GET /api/workspaces/:id/audit-logs`

Create `packages/server/src/routes/audit-logs.ts`:

```ts
import { Hono } from "hono";
import { eq, and, desc, sql, gte, lte, auditLogs, type Database } from "@gnana/db";
import { requireRole } from "../middleware/rbac.js";
import { errorResponse } from "../utils/errors.js";

export function auditLogRoutes(db: Database) {
  const app = new Hono();

  // List audit logs — admin+ only
  app.get("/", requireRole("admin"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
    const offset = Number(c.req.query("offset")) || 0;

    // Optional filters
    const actionFilter = c.req.query("action"); // e.g., "agent.created"
    const userFilter = c.req.query("userId");
    const fromDate = c.req.query("from"); // ISO date string
    const toDate = c.req.query("to"); // ISO date string

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

Mount in `packages/server/src/index.ts`:

```ts
import { auditLogRoutes } from "./routes/audit-logs.js";
// ...
api.route("/audit-logs", auditLogRoutes(db));
```

The route is scoped to the workspace via `workspaceMiddleware` (already applied to all `/api/*` routes). The `requireRole("admin")` ensures only admins can view audit logs.

### Dashboard: `apps/dashboard/src/app/(dashboard)/settings/audit-log/page.tsx`

New page with:

1. **Table columns:** Timestamp, User (name or email), Action (badge-styled), Resource Type, Resource ID, Details (expandable row or dialog).
2. **Filters:**
   - Action type dropdown (populated from the `AuditAction` union).
   - User dropdown (populated from workspace members).
   - Date range picker (from/to).
3. **Pagination:** 50 per page, standard offset-based with Next/Previous buttons.
4. **Expandable details:** Clicking a row shows the `changes` JSONB in a formatted code block (before/after diff).

**Navigation:** Add an "Audit Log" link to the settings page quick-links grid in `apps/dashboard/src/app/(dashboard)/settings/page.tsx`:

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

---

## 4. Connector Health Checks

### Schema Changes

Add two columns to the `connectors` table in `packages/db/src/schema.ts`:

```ts
export const connectors = pgTable(
  "connectors",
  {
    // ... existing columns ...
    lastHealthStatus: text("last_health_status"), // "healthy" | "unhealthy" | null
    lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
  },
  // ... existing indexes ...
);
```

### API: `POST /api/connectors/:id/health`

Modify `packages/server/src/routes/connectors.ts`. The existing `POST /:id/test` endpoint is very similar to what we need. Refactor it to also persist health status:

```ts
// POST /:id/health — structured health check (replaces or supplements /test)
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

**Response shape:**

```json
{ "status": "healthy", "latencyMs": 234 }
{ "status": "unhealthy", "latencyMs": 5002, "error": "GitHub API returned 401" }
```

All external calls have a 10-second timeout via `AbortSignal.timeout(10_000)`.

### Keep `POST /:id/test` Endpoint

Keep the existing `/test` endpoint as-is for backward compatibility. The new `/health` endpoint adds structured responses and persisted status. Over time, the dashboard can migrate from `/test` to `/health`.

### Include Health Status in List/Get Responses

The `GET /connectors` and `GET /connectors/:id` responses already return all columns. Since `lastHealthStatus` and `lastHealthCheckAt` are new columns on the table, they will automatically appear in query results. No route changes needed.

### Dashboard: Health Indicator on Connector Cards

Modify `apps/dashboard/src/components/connectors/connector-card.tsx` to show a health dot:

```tsx
// Add health status indicator near the connector name or status badge
{
  connector.lastHealthStatus && (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        connector.lastHealthStatus === "healthy" ? "bg-green-500" : "bg-red-500"
      }`}
      title={`Last check: ${connector.lastHealthCheckAt ? new Date(connector.lastHealthCheckAt).toLocaleString() : "never"}`}
    />
  );
}
```

Update the `Connector` type in `apps/dashboard/src/types/index.ts`:

```ts
export interface Connector {
  // ... existing fields ...
  lastHealthStatus: "healthy" | "unhealthy" | null;
  lastHealthCheckAt: string | null;
}
```

### Optional: Periodic Health Checks via Cron Job

Register a new job type in the job queue for periodic health checks. This is a future enhancement and not required for the initial implementation:

```ts
// packages/server/src/index.ts — register cron-style job
queue.register("connector:health-check-all", async (payload) => {
  const { workspaceId } = payload as { workspaceId: string };
  const allConnectors = await db
    .select({ id: connectors.id })
    .from(connectors)
    .where(and(eq(connectors.workspaceId, workspaceId), eq(connectors.enabled, true)));

  for (const conn of allConnectors) {
    // Enqueue individual health checks (reuse the health check logic)
    await queue.enqueue("connector:health-check", { connectorId: conn.id, workspaceId });
  }
});
```

For the initial release, health checks are on-demand only (user clicks "Test" / "Check Health" on the connector card). Cron-based checks can be added later when the job queue supports scheduled/recurring jobs.

---

## Migration

Generate a single migration for all schema changes:

```bash
pnpm --filter @gnana/db db:generate
```

This will produce a migration that:

1. Creates the `audit_logs` table with 3 indexes.
2. Adds `last_health_status` (text, nullable) and `last_health_check_at` (timestamptz, nullable) columns to `connectors`.

Both changes are additive (new table, new nullable columns) so the migration is non-breaking and can be applied without downtime.

---

## Files to Create

| File                                                             | Purpose                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/db/src/seed.ts`                                        | Seed default plans (Free, Pro, Enterprise), auto-assign Free to unassigned workspaces |
| `packages/server/src/routes/audit-logs.ts`                       | `GET /audit-logs` -- paginated, filtered audit log endpoint                           |
| `apps/dashboard/src/app/(dashboard)/settings/audit-log/page.tsx` | Audit log viewer with table, filters, pagination                                      |

## Files to Modify

| File                                                           | Changes                                                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/schema.ts`                                    | Add `auditLogs` table; add `lastHealthStatus` and `lastHealthCheckAt` to `connectors`                            |
| `packages/db/package.json`                                     | Add `db:seed` script                                                                                             |
| `packages/server/src/index.ts`                                 | Wire `auditLogRoutes`; add token usage aggregation in `run:execute` handler                                      |
| `packages/server/src/routes/workspaces.ts`                     | Add `planLimit` to member invite route; add `GET /:id/usage` endpoint; auto-assign Free plan on workspace create |
| `packages/server/src/routes/connectors.ts`                     | Add `POST /:id/health` endpoint                                                                                  |
| `packages/server/src/routes/agents.ts`                         | Add `logAudit()` calls to POST, PUT, DELETE handlers                                                             |
| `packages/server/src/routes/runs.ts`                           | Add `logAudit()` calls to POST, approve, reject handlers                                                         |
| `packages/server/src/routes/providers.ts`                      | Add `logAudit()` calls to POST, DELETE handlers                                                                  |
| `packages/server/src/routes/api-keys.ts`                       | Add `logAudit()` calls to POST, DELETE handlers                                                                  |
| `packages/server/src/middleware/audit-log.ts`                  | New file -- `logAudit()` utility, `getClientIp()`, sensitive field redaction                                     |
| `apps/dashboard/src/app/(dashboard)/settings/billing/page.tsx` | Replace stub with live usage data from API                                                                       |
| `apps/dashboard/src/app/(dashboard)/settings/page.tsx`         | Add Audit Log quick-link card                                                                                    |
| `apps/dashboard/src/app/(dashboard)/connectors/page.tsx`       | No changes needed (connector-card handles display)                                                               |
| `apps/dashboard/src/components/connectors/connector-card.tsx`  | Add health status dot indicator                                                                                  |
| `apps/dashboard/src/types/index.ts`                            | Add `lastHealthStatus` and `lastHealthCheckAt` to `Connector` type                                               |

---

## Implementation Order

Recommended sequence to minimize merge conflicts and allow incremental testing:

1. **Schema + migration** -- add `auditLogs` table and connector health columns, run `db:generate` and `db:push`
2. **Seed script** -- create `seed.ts`, run it against dev DB to populate plans
3. **Plan limits wiring** -- add `planLimit` to member invite route, auto-assign Free plan on workspace create
4. **Token usage tracking** -- add aggregation in `run:execute` job handler
5. **Usage API + dashboard** -- add `GET /usage` endpoint, update billing page to use live data
6. **Audit log utility** -- create `audit-log.ts` with `logAudit()` function
7. **Audit log routes** -- create `audit-logs.ts`, mount in `index.ts`
8. **Instrument routes** -- add `logAudit()` calls to all mutation routes (can be done incrementally per route file)
9. **Audit log dashboard** -- create the audit log page, add settings quick-link
10. **Connector health** -- add `/health` endpoint, update connector card with health dot

Each step is independently deployable.

---

## Testing

### Unit Tests

- `planLimit` middleware: mock DB to return different plan limits, verify 403 vs pass-through
- `logAudit()`: verify sensitive field redaction, verify insert is called with correct shape
- Seed script: run against test DB, verify plans are created idempotently

### Integration Tests

- Create workspace -> verify Free plan is auto-assigned
- Create agents up to limit -> verify next create returns 403
- Trigger run -> verify `runsCount` incremented -> verify `tokensUsed` incremented on completion
- Call `GET /usage` -> verify response shape matches spec
- Perform mutation -> call `GET /audit-logs` -> verify entry exists with correct action
- Call `POST /connectors/:id/health` -> verify response shape and DB update

### Manual Smoke Tests

- Visit `/settings/billing` -> verify usage bars reflect actual DB state
- Visit `/settings/audit-log` -> verify table populates after creating/editing resources
- Click "Test" on a connector card -> verify health dot appears green/red

---

## Open Questions / Future Work

1. **Stripe integration** -- the upgrade CTA is a placeholder. When ready, wire plan changes through Stripe Checkout and webhooks to update `workspaces.planId`.
2. **Audit log retention** -- no automatic cleanup. For high-volume workspaces, consider a retention policy (e.g., delete logs older than 90 days) or archive to cold storage.
3. **Periodic health checks** -- deferred to when the job queue supports cron/scheduled jobs. For now, health checks are manual.
4. **Token usage granularity** -- currently aggregated monthly. Consider per-run cost breakdown (model pricing \* tokens) for a future cost explorer feature.
5. **Audit log export** -- CSV/JSON export endpoint for compliance teams. Low priority, add when requested.
