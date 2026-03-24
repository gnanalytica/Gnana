import { Hono } from "hono";
import {
  eq,
  and,
  workspaces,
  workspaceInvites,
  workspaceMembers,
  users,
  type Database,
} from "@gnana/db";
import { errorResponse } from "../utils/errors.js";

/**
 * Public invite routes — no auth required.
 * GET /invites/:token — view invite details
 */
export function publicInviteRoutes(db: Database) {
  const app = new Hono();

  // Get invite details by token — public
  app.get("/:token", async (c) => {
    const token = c.req.param("token");

    const result = await db
      .select({
        invite: workspaceInvites,
        workspace: workspaces,
      })
      .from(workspaceInvites)
      .innerJoin(workspaces, eq(workspaceInvites.workspaceId, workspaces.id))
      .where(eq(workspaceInvites.token, token))
      .limit(1);

    const row = result[0];
    if (!row) {
      return errorResponse(c, 404, "NOT_FOUND", "Invite not found or expired");
    }

    if (new Date(row.invite.expiresAt) < new Date()) {
      return errorResponse(c, 410, "NOT_FOUND", "Invite has expired");
    }

    // Look up inviter name
    let inviterName: string | null = null;
    if (row.invite.invitedBy) {
      const inviterResult = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, row.invite.invitedBy))
        .limit(1);
      const inviter = inviterResult[0];
      inviterName = inviter?.name ?? inviter?.email ?? null;
    }

    return c.json({
      id: row.invite.id,
      email: row.invite.email,
      role: row.invite.role,
      inviterName,
      workspace: {
        id: row.workspace.id,
        name: row.workspace.name,
        slug: row.workspace.slug,
      },
      expiresAt: row.invite.expiresAt,
      createdAt: row.invite.createdAt,
    });
  });

  return app;
}

/**
 * Protected invite routes — requires auth (userId set by authMiddleware).
 * POST /invites/:token/accept — accept an invite
 */
export function protectedInviteRoutes(db: Database) {
  const app = new Hono();

  // Accept invite — requires auth
  app.post("/:token/accept", async (c) => {
    const token = c.req.param("token");
    const userId = c.get("userId");

    if (!userId) {
      return errorResponse(c, 401, "UNAUTHORIZED", "Authentication required");
    }

    const result = await db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.token, token))
      .limit(1);

    const invite = result[0];
    if (!invite) {
      return errorResponse(c, 404, "NOT_FOUND", "Invite not found");
    }

    if (new Date(invite.expiresAt) < new Date()) {
      return errorResponse(c, 410, "NOT_FOUND", "Invite has expired");
    }

    // Verify the user exists
    const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    const user = userResult[0];
    if (!user) {
      return errorResponse(c, 404, "NOT_FOUND", "User not found");
    }

    // Check if user is already a member
    const existingMembership = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, invite.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);

    if (existingMembership[0]) {
      // Already a member — delete the invite and return success
      await db.delete(workspaceInvites).where(eq(workspaceInvites.id, invite.id));
      return c.json({ ok: true, message: "Already a member of this workspace" });
    }

    // Wrap membership creation + invite deletion in a transaction
    await db.transaction(async (tx) => {
      await tx.insert(workspaceMembers).values({
        workspaceId: invite.workspaceId,
        userId,
        role: invite.role,
        invitedBy: invite.invitedBy,
        acceptedAt: new Date(),
      });

      await tx.delete(workspaceInvites).where(eq(workspaceInvites.id, invite.id));
    });

    return c.json({ ok: true, workspaceId: invite.workspaceId });
  });

  return app;
}
