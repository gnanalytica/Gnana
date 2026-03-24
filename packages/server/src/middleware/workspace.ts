import { createMiddleware } from "hono/factory";
import { eq, and, workspaces, workspaceMembers, type Database } from "@gnana/db";
import * as Sentry from "@sentry/node";
import { getCached, setCache } from "./cache.js";
import { errorResponse } from "../utils/errors.js";

declare module "hono" {
  interface ContextVariableMap {
    workspaceId: string;
    workspaceRole: string;
  }
}

interface MembershipCache {
  role: string;
}

interface PersonalWorkspaceCache {
  id: string;
}

const MEMBERSHIP_TTL = 300_000; // 5 minutes
const PERSONAL_WS_TTL = 300_000; // 5 minutes

export function workspaceMiddleware(db: Database) {
  return createMiddleware(async (c, next) => {
    const userId = c.get("userId");
    const requestedWorkspaceId = c.req.header("X-Workspace-Id");

    if (requestedWorkspaceId) {
      // Check cache first for membership lookup
      const cacheKey = `membership:${userId}:${requestedWorkspaceId}`;
      const cached = getCached<MembershipCache>(cacheKey);

      if (cached) {
        c.set("workspaceId", requestedWorkspaceId);
        c.set("workspaceRole", cached.role);
        Sentry.setTag("workspace.id", requestedWorkspaceId);
        Sentry.setTag("workspace.role", cached.role);
      } else {
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
          return errorResponse(c, 403, "FORBIDDEN", "Not a member of this workspace");
        }

        // Cache the membership result
        setCache(cacheKey, { role: membership[0].role }, MEMBERSHIP_TTL);

        c.set("workspaceId", requestedWorkspaceId);
        c.set("workspaceRole", membership[0].role);
        Sentry.setTag("workspace.id", requestedWorkspaceId);
        Sentry.setTag("workspace.role", membership[0].role);
      }
    } else {
      // Check cache for personal workspace
      const cacheKey = `personal:${userId}`;
      const cached = getCached<PersonalWorkspaceCache>(cacheKey);

      if (cached) {
        c.set("workspaceId", cached.id);
        c.set("workspaceRole", "owner");
        Sentry.setTag("workspace.id", cached.id);
        Sentry.setTag("workspace.role", "owner");
      } else {
        // Fall back to personal workspace
        const personalWs = await db
          .select()
          .from(workspaces)
          .where(and(eq(workspaces.ownerId, userId), eq(workspaces.type, "personal")))
          .limit(1);

        if (!personalWs[0]) {
          return errorResponse(c, 404, "NOT_FOUND", "No workspace found");
        }

        // Cache the personal workspace result
        setCache(cacheKey, { id: personalWs[0].id }, PERSONAL_WS_TTL);

        c.set("workspaceId", personalWs[0].id);
        c.set("workspaceRole", "owner");
        Sentry.setTag("workspace.id", personalWs[0].id);
        Sentry.setTag("workspace.role", "owner");
      }
    }

    await next();
  });
}
