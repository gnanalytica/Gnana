"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { RunStreamEvent } from "@/types";

export function useRunStream(runId: string | null) {
  const [events, setEvents] = useState<RunStreamEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (!runId) return;
    const baseUrl = (process.env.NEXT_PUBLIC_GNANA_API_URL ?? "http://localhost:4000").replace(
      /^http/,
      "ws",
    );
    const ws = new WebSocket(`${baseUrl}/ws/runs/${runId}`);

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as RunStreamEvent;
        setEvents((prev) => [...prev, data]);
      } catch {
        // ignore parse errors
      }
    };
    wsRef.current = ws;
  }, [runId]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const disconnect = () => {
    wsRef.current?.close();
  };

  return { events, isConnected, disconnect };
}
