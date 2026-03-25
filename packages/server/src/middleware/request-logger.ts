import { createMiddleware } from "hono/factory";
import { serverLog } from "../logger.js";

export const requestLogger = createMiddleware(async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.header("x-request-id", requestId);
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const status = c.res.status;
  const log =
    status >= 500
      ? serverLog.error.bind(serverLog)
      : status >= 400
        ? serverLog.warn.bind(serverLog)
        : serverLog.info.bind(serverLog);
  log(
    {
      requestId,
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
