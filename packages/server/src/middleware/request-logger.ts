import { createMiddleware } from "hono/factory";
import { serverLog } from "../logger.js";

export const requestLogger = createMiddleware(async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const status = c.res.status;
  const log = status >= 500 ? serverLog.error : status >= 400 ? serverLog.warn : serverLog.info;
  log(
    {
      method: c.req.method,
      path: c.req.path,
      status,
      duration,
      userId: c.get("userId" as never) ?? undefined,
      workspaceId: c.get("workspaceId" as never) ?? undefined,
    },
    `${c.req.method} ${c.req.path} ${status} ${duration}ms`,
  );
});
