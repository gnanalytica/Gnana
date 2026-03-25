"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  type: "personal" | "team";
  role: string;
}

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [current, setCurrent] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchWorkspaces = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.fetch("/api/workspaces");
      const wsList = (await res.json()) as Workspace[];
      setWorkspaces(wsList);
      // Restore previously selected workspace from localStorage
      const savedId =
        typeof window !== "undefined"
          ? localStorage.getItem("gnana-current-workspace")
          : null;
      const match = savedId ? wsList.find((w) => w.id === savedId) : null;
      setCurrent(match ?? wsList[0] ?? null);
    } catch {
      setWorkspaces([]);
      setCurrent(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const switchWorkspace = useCallback((ws: Workspace) => {
    setCurrent(ws);
    if (typeof window !== "undefined") {
      localStorage.setItem("gnana-current-workspace", ws.id);
    }
  }, []);

  return {
    workspaces,
    current,
    setCurrent: switchWorkspace,
    loading,
    refetch: fetchWorkspaces,
  };
}
