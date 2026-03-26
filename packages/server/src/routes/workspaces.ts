import { Hono } from "hono";
import {
  eq,
  and,
  sql,
  workspaces,
  workspaceMembers,
  workspaceInvites,
  agents,
  connectors,
  plans,
  usageRecords,
  type Database,
} from "@gnana/db";
import { requireRole } from "../middleware/rbac.js";
import { randomBytes } from "node:crypto";
import {
  createWorkspaceSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
} from "../validation/schemas.js";
import { errorResponse } from "../utils/errors.js";

export function workspaceRoutes(db: Database) {
  const app = new Hono();

  // List workspaces the current user belongs to
  app.get("/", async (c) => {
    const userId = c.get("userId");

    // Run independent queries in parallel
    const [memberships, ownedWorkspaces] = await Promise.all([
      db
        .select({
          workspace: workspaces,
          role: workspaceMembers.role,
        })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(eq(workspaceMembers.userId, userId)),
      db.select().from(workspaces).where(eq(workspaces.ownerId, userId)),
    ]);

    const membershipIds = new Set(memberships.map((m) => m.workspace.id));
    const combined = [
      ...memberships.map((m) => ({ ...m.workspace, role: m.role })),
      ...ownedWorkspaces
        .filter((w) => !membershipIds.has(w.id))
        .map((w) => ({ ...w, role: "owner" })),
    ];

    return c.json(combined);
  });

  // Create a new team workspace
  app.post("/", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json();
    const parsed = createWorkspaceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
          },
        },
        400,
      );
    }
    const data = parsed.data;

    const slug = data.slug ?? data.name.toLowerCase().replace(/\s+/g, "-");

    // Wrap workspace + membership creation in a transaction
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

      return ws;
    });

    return c.json(workspace, 201);
  });

  // List members of the current workspace
  app.get("/:id/members", requireRole("viewer"), async (c) => {
    const paramId = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    if (paramId !== workspaceId) {
      return errorResponse(c, 403, "FORBIDDEN", "Workspace mismatch");
    }
    const result = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    return c.json(result);
  });

  // Invite a member to the workspace
  app.post("/:id/members", requireRole("admin"), async (c) => {
    const paramId = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    if (paramId !== workspaceId) {
      return errorResponse(c, 403, "FORBIDDEN", "Workspace mismatch");
    }
    const userId = c.get("userId");
    const body = await c.req.json();
    const parsed = inviteMemberSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
          },
        },
        400,
      );
    }
    const data = parsed.data;

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const result = await db
      .insert(workspaceInvites)
      .values({
        workspaceId,
        email: data.email,
        role: data.role ?? "viewer",
        invitedBy: userId,
        token,
        expiresAt,
      })
      .returning();

    return c.json(result[0], 201);
  });

  // Update member role
  app.patch("/:id/members/:memberId", requireRole("admin"), async (c) => {
    const paramId = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    if (paramId !== workspaceId) {
      return errorResponse(c, 403, "FORBIDDEN", "Workspace mismatch");
    }
    const memberId = c.req.param("memberId");
    const body = await c.req.json();
    const parsed = updateMemberRoleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
          },
        },
        400,
      );
    }
    const data = parsed.data;

    const result = await db
      .update(workspaceMembers)
      .set({ role: data.role })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)),
      )
      .returning();

    if (result.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Member not found");
    }

    return c.json(result[0]);
  });

  // Remove a member from workspace
  app.delete("/:id/members/:memberId", requireRole("admin"), async (c) => {
    const paramId = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    if (paramId !== workspaceId) {
      return errorResponse(c, 403, "FORBIDDEN", "Workspace mismatch");
    }
    const memberId = c.req.param("memberId");

    const result = await db
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)),
      )
      .returning();

    if (result.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Member not found");
    }

    return c.json({ ok: true });
  });

  // Usage dashboard — get current plan, limits, and usage counts
  app.get("/:id/usage", requireRole("viewer"), async (c) => {
    const workspaceId = c.get("workspaceId");

    // Load workspace plan
    const ws = await db
      .select({ planId: workspaces.planId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    let plan = { name: "Free", maxAgents: 3, maxConnectors: 2, maxMembers: 1, maxRunsMonth: 100 };
    if (ws[0]?.planId) {
      const planRows = await db.select().from(plans).where(eq(plans.id, ws[0].planId)).limit(1);
      if (planRows[0]) {
        plan = {
          name: planRows[0].name,
          maxAgents: planRows[0].maxAgents,
          maxConnectors: planRows[0].maxConnectors,
          maxMembers: planRows[0].maxMembers,
          maxRunsMonth: planRows[0].maxRunsMonth,
        };
      }
    }

    // Count resources
    const period = new Date().toISOString().slice(0, 7); // "2026-03"
    const [agentCount, connectorCount, memberCount, usageRows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(agents)
        .where(eq(agents.workspaceId, workspaceId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(connectors)
        .where(and(eq(connectors.workspaceId, workspaceId), eq(connectors.enabled, true))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId)),
      db
        .select()
        .from(usageRecords)
        .where(and(eq(usageRecords.workspaceId, workspaceId), eq(usageRecords.period, period)))
        .limit(1),
    ]);

    const usage = usageRows[0];

    return c.json({
      plan,
      usage: {
        agents: { current: agentCount[0]?.count ?? 0, limit: plan.maxAgents },
        connectors: { current: connectorCount[0]?.count ?? 0, limit: plan.maxConnectors },
        members: { current: memberCount[0]?.count ?? 0, limit: plan.maxMembers },
        runsThisMonth: { current: usage?.runsCount ?? 0, limit: plan.maxRunsMonth },
        tokensThisMonth: usage?.tokensUsed ?? 0,
      },
    });
  });

  return app;
}
