import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  ...(process.env.NODE_ENV !== "production" && {
    transport: { target: "pino/file", options: { destination: 1 } },
    formatters: { level: (label: string) => ({ level: label }) },
  }),
});

// Named child loggers for structured context
export const serverLog = logger.child({ module: "server" });
export const authLog = logger.child({ module: "auth" });
export const jobLog = logger.child({ module: "jobs" });
export const dbLog = logger.child({ module: "db" });
