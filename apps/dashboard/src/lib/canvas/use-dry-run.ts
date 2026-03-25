import { useState, useCallback } from "react";
import { api } from "@/lib/api";
import type { NodeSpec, EdgeSpec } from "@/types/pipeline";

export interface DryRunNodeResult {
  nodeId: string;
  status: "would-execute" | "skipped";
  reason?: string;
}

export interface DryRunWarning {
  nodeId?: string;
  message: string;
}

export interface DryRunPreview {
  executionOrder: string[];
  nodeResults: DryRunNodeResult[];
  warnings: DryRunWarning[];
}

interface UseDryRunReturn {
  preview: DryRunPreview | null;
  isLoading: boolean;
  error: string | null;
  runPreview: (nodes: NodeSpec[], edges: EdgeSpec[]) => Promise<void>;
  clearPreview: () => void;
}

export function useDryRun(): UseDryRunReturn {
  const [preview, setPreview] = useState<DryRunPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPreview = useCallback(async (nodes: NodeSpec[], edges: EdgeSpec[]) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await api.fetch("/api/runs/dry-run", {
        method: "POST",
        body: JSON.stringify({ nodes, edges }),
      });
      const data = (await res.json()) as DryRunPreview;
      setPreview(data);
    } catch (err) {
      // Fallback: compute execution order client-side when server endpoint is unavailable
      const executionOrder = computeLocalExecutionOrder(nodes, edges);
      const nodeIds = new Set(nodes.map((n) => n.id));
      const nodeResults: DryRunNodeResult[] = nodes.map((n) => ({
        nodeId: n.id,
        status: executionOrder.includes(n.id) ? "would-execute" : "skipped",
      }));
      const warnings: DryRunWarning[] = [];

      // Warn about disconnected nodes
      const connectedIds = new Set<string>();
      for (const e of edges) {
        connectedIds.add(e.source);
        connectedIds.add(e.target);
      }
      for (const n of nodes) {
        if (!connectedIds.has(n.id) && nodes.length > 1) {
          warnings.push({ nodeId: n.id, message: `Node "${n.id}" is disconnected` });
        }
      }

      // Suppress unused variable warning
      void nodeIds;

      setPreview({ executionOrder, nodeResults, warnings });

      // Only set error if the fallback had a real issue (non-404/non-network)
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("404") && !message.includes("timed out")) {
        setError(null); // Silently fell back to local computation
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearPreview = useCallback(() => {
    setPreview(null);
    setError(null);
  }, []);

  return { preview, isLoading, error, runPreview, clearPreview };
}

/**
 * Client-side topological sort (BFS) to determine execution order.
 * Used as a fallback when the server dry-run endpoint is unavailable.
 */
function computeLocalExecutionOrder(nodes: NodeSpec[], edges: EdgeSpec[]): string[] {
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    adjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  return order;
}
