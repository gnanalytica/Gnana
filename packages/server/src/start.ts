import { createGnanaServer } from "./index.js";
import { WebSocketServer } from "ws";
import { connectionManager } from "./ws.js";
import { serverLog } from "./logger.js";

// Validate required environment variables before starting
const requiredEnv = ["DATABASE_URL", "AUTH_SECRET"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const server = createGnanaServer({
  port: Number(process.env.PORT ?? 4000),
  database: process.env.DATABASE_URL!,
});

const httpServer = server.start();

// WebSocket server for real-time run streaming
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "", `http://${request.headers.host}`);
  const match = url.pathname.match(/^\/ws\/runs\/([a-f0-9-]+)$/);

  if (!match) {
    socket.destroy();
    return;
  }

  const runId = match[1]!;

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
    connectionManager.add(runId, ws);

    ws.send(
      JSON.stringify({
        event: "connected",
        data: { runId },
        timestamp: new Date().toISOString(),
      }),
    );
  });
});

// Heartbeat to detect stale connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if ((ws as any).__isAlive === false) {
      ws.terminate();
      return;
    }
    (ws as any).__isAlive = false;
    ws.ping();
  });
}, 30_000);

wss.on("connection", (ws) => {
  (ws as any).__isAlive = true;
  ws.on("pong", () => {
    (ws as any).__isAlive = true;
  });
});

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

// Graceful shutdown
function shutdown(signal: string) {
  serverLog.info(`${signal} received, shutting down gracefully...`);
  clearInterval(heartbeatInterval);
  wss.close();
  httpServer.close(() => {
    serverLog.info("Server closed");
    process.exit(0);
  });
  setTimeout(() => {
    serverLog.error("Forced shutdown after 10s timeout");
    process.exit(1);
  }, 10_000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
