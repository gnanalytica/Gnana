"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { Connector } from "@/types";

export function useConnectors() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConnectors = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await api.connectors.list();
      setConnectors(data as Connector[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch connectors");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  const createConnector = async (data: Partial<Connector>) => {
    const created = await api.connectors.create(data as Record<string, unknown>);
    await fetchConnectors();
    return created as Connector;
  };

  const deleteConnector = async (id: string) => {
    await api.connectors.delete(id);
    await fetchConnectors();
  };

  const testConnector = async (id: string) => {
    const result = await api.connectors.test(id);
    return result as { success: boolean; message?: string };
  };

  return {
    connectors,
    isLoading,
    error,
    refetch: fetchConnectors,
    createConnector,
    deleteConnector,
    testConnector,
  };
}

export function useConnector(id: string) {
  const [connector, setConnector] = useState<Connector | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchConnector() {
      try {
        setIsLoading(true);
        const data = await api.connectors.get(id);
        setConnector(data as Connector);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch connector");
      } finally {
        setIsLoading(false);
      }
    }
    fetchConnector();
  }, [id]);

  return { connector, isLoading, error };
}
