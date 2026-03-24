import { createMiddleware } from "hono/factory";
import { eq, and, workspaces, workspaceMembers, type Database } from "@gnana/db";
import * as Sentry from "@sentry/node";

declare module "hono" {
  interface ContextVariableMap {
    workspaceId: string;
    workspaceRole: string;
  }
}

export function workspaceMiddleware(db: Database) {
  return createMiddleware(async (c, next) => {
    const userId = c.get("userId");
    const requestedWorkspaceId = c.req.header("X-Workspace-Id");

    if (requestedWorkspaceId) {
      // Verify user is a member of requested workspace
      const membership = await db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, requestedWorkspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .limit(1);

      if (!membership[0]) {
        return c.json({ error: "Not a member of this workspace" }, 403);
      }

      c.set("workspaceId", requestedWorkspaceId);
      c.set("workspaceRole", membership[0].role);
      Sentry.setTag("workspace.id", requestedWorkspaceId);
      Sentry.setTag("workspace.role", membership[0].role);
    } else {
      // Fall back to personal workspace
      const personalWs = await db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.ownerId, userId), eq(workspaces.type, "personal")))
        .limit(1);

      if (!personalWs[0]) {
        return c.json({ error: "No workspace found" }, 404);
      }

      c.set("workspaceId", personalWs[0].id);
      c.set("workspaceRole", "owner");
      Sentry.setTag("workspace.id", personalWs[0].id);
      Sentry.setTag("workspace.role", "owner");
    }

    await next();
  });
}
