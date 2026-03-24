import { Hono } from "hono";
import { eq, and, workspaces, workspaceMembers, workspaceInvites, type Database } from "@gnana/db";
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
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Validation failed", details: parsed.error.flatten().fieldErrors } }, 400);
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
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Validation failed", details: parsed.error.flatten().fieldErrors } }, 400);
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
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Validation failed", details: parsed.error.flatten().fieldErrors } }, 400);
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

  return app;
}
