import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import type { NodeSpec, EdgeSpec } from "@/types/pipeline";

type SaveStatus = "saved" | "saving" | "unsaved" | "error";

interface UseAutoSaveOptions {
  agentId?: string;
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  enabled?: boolean;
}

export function useAutoSave({ agentId, nodes, edges, enabled = true }: UseAutoSaveOptions) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const lastHashRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);

  nodesRef.current = nodes;
  edgesRef.current = edges;

  const computeHash = useCallback((n: NodeSpec[], e: EdgeSpec[]) => {
    return JSON.stringify({ n, e });
  }, []);

  const save = useCallback(async () => {
    if (!agentId) return;
    const hash = computeHash(nodesRef.current, edgesRef.current);
    if (hash === lastHashRef.current) return;

    setSaveStatus("saving");
    try {
      await api.agents.update(agentId, {
        pipelineConfig: { nodes: nodesRef.current, edges: edgesRef.current },
      } as Record<string, unknown>);
      lastHashRef.current = hash;
      setSaveStatus("saved");
      setLastSaved(new Date());
    } catch {
      setSaveStatus("error");
    }
  }, [agentId, computeHash]);

  // Auto-save on changes
  useEffect(() => {
    if (!enabled || !agentId) return;
    const hash = computeHash(nodes, edges);
    if (hash === lastHashRef.current) return;

    setSaveStatus("unsaved");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      save();
    }, 2000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [nodes, edges, enabled, agentId, computeHash, save]);

  return { saveStatus, lastSaved, save };
}
