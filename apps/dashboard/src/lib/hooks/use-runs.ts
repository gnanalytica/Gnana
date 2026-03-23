"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import type { Run, RunStreamEvent } from "@/types";

export function useRuns(options?: { limit?: number }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await api.runs.list(options);
      setRuns(data as Run[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch runs");
    } finally {
      setIsLoading(false);
    }
  }, [options?.limit]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const trigger = async (data: {
    agentId: string;
    payload?: Record<string, unknown>;
    triggerType?: string;
  }) => {
    const created = await api.runs.trigger(data);
    await fetchRuns();
    return created as Run;
  };

  const approve = async (id: string, modifications?: string) => {
    const updated = await api.runs.approve(id, modifications);
    await fetchRuns();
    return updated as Run;
  };

  const reject = async (id: string, reason?: string) => {
    const updated = await api.runs.reject(id, { reason });
    await fetchRuns();
    return updated as Run;
  };

  const cancel = async (id: string) => {
    const updated = await api.runs.cancel(id);
    await fetchRuns();
    return updated as Run;
  };

  return { runs, isLoading, error, refetch: fetchRuns, trigger, approve, reject, cancel };
}

export function useRun(id: string) {
  const [run, setRun] = useState<Run | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRun() {
      try {
        setIsLoading(true);
        const data = await api.runs.get(id);
        setRun(data as Run);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch run");
      } finally {
        setIsLoading(false);
      }
    }
    fetchRun();
  }, [id]);

  return { run, isLoading, error };
}

export function useRunStream(runId: string | null) {
  const [events, setEvents] = useState<RunStreamEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const connect = useCallback(() => {
    if (!runId) return;

    const unsubscribe = api.runs.subscribe(runId, (update: unknown) => {
      setEvents((prev) => [...prev, update as RunStreamEvent]);
    });

    unsubscribeRef.current = unsubscribe;
    setIsConnected(true);
  }, [runId]);

  useEffect(() => {
    connect();
    return () => {
      unsubscribeRef.current?.();
      setIsConnected(false);
    };
  }, [connect]);

  const disconnect = () => {
    unsubscribeRef.current?.();
    setIsConnected(false);
  };

  return { events, isConnected, disconnect };
}
