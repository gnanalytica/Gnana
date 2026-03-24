"use client";
import { useState, useEffect, useCallback, useRef } from "react";

export interface LiveRunLog {
  nodeId: string;
  type: string;
  message: string;
  timestamp: string;
}

export interface LiveRunState {
  runId: string | null;
  executingNodeId: string | null;
  completedNodeIds: Set<string>;
  failedNodeIds: Set<string>;
  isRunning: boolean;
  logs: LiveRunLog[];
}

export function useLiveRun(runId: string | null) {
  const [state, setState] = useState<LiveRunState>({
    runId: null,
    executingNodeId: null,
    completedNodeIds: new Set(),
    failedNodeIds: new Set(),
    isRunning: false,
    logs: [],
  });
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback((id: string) => {
    const apiUrl = (process.env.NEXT_PUBLIC_GNANA_API_URL ?? "http://localhost:4000").replace(
      /^http/,
      "ws",
    );
    const ws = new WebSocket(`${apiUrl}/ws/runs/${id}`);

    ws.onopen = () => {
      setState((prev) => ({ ...prev, runId: id, isRunning: true }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        setState((prev) => {
          const newState = { ...prev };

          switch (msg.event) {
            case "run:node_started":
              newState.executingNodeId = msg.data.nodeId;
              break;
            case "run:node_completed": {
              const completed = new Set(prev.completedNodeIds);
              completed.add(msg.data.nodeId);
              newState.completedNodeIds = completed;
              if (newState.executingNodeId === msg.data.nodeId) {
                newState.executingNodeId = null;
              }
              break;
            }
            case "run:failed": {
              const failed = new Set(prev.failedNodeIds);
              if (msg.data.nodeId) failed.add(msg.data.nodeId);
              newState.failedNodeIds = failed;
              newState.isRunning = false;
              newState.executingNodeId = null;
              break;
            }
            case "run:completed":
              newState.isRunning = false;
              newState.executingNodeId = null;
              break;
            case "run:log":
              newState.logs = [
                ...prev.logs,
                {
                  nodeId: msg.data.nodeId ?? "",
                  type: msg.data.type ?? "info",
                  message:
                    typeof msg.data.content === "string"
                      ? msg.data.content
                      : JSON.stringify(msg.data),
                  timestamp: msg.timestamp,
                },
              ];
              break;
          }

          return newState;
        });
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, isRunning: false }));
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    if (runId) connect(runId);
    return () => {
      wsRef.current?.close();
    };
  }, [runId, connect]);

  const reset = useCallback(() => {
    wsRef.current?.close();
    setState({
      runId: null,
      executingNodeId: null,
      completedNodeIds: new Set(),
      failedNodeIds: new Set(),
      isRunning: false,
      logs: [],
    });
  }, []);

  return { ...state, reset };
}
