import { createMiddleware } from "hono/factory";
import { errorResponse } from "../utils/errors.js";

const ROLE_HIERARCHY = { owner: 4, admin: 3, editor: 2, viewer: 1 } as const;
type Role = keyof typeof ROLE_HIERARCHY;

export function requireRole(minRole: Role) {
  return createMiddleware(async (c, next) => {
    const userRole = c.get("workspaceRole") as Role;

    if (!userRole || ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[minRole]) {
      return errorResponse(
        c,
        403,
        "FORBIDDEN",
        `Insufficient permissions: requires ${minRole}, current role is ${userRole ?? "none"}`,
      );
    }

    await next();
  });
}
