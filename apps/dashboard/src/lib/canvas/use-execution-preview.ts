import { useState, useCallback, useRef, useEffect } from "react";
import type { NodeSpec, EdgeSpec } from "@/types/pipeline";

interface ExecutionPreviewState {
  isRunning: boolean;
  isPaused: boolean;
  currentNodeId: string | null;
  executedNodeIds: Set<string>;
  step: number;
}

/**
 * Compute topological order via BFS from trigger nodes.
 */
function topologicalSort(nodes: NodeSpec[], edges: EdgeSpec[]): string[] {
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

  // Start from nodes with 0 in-degree (triggers)
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

export function useExecutionPreview(nodes: NodeSpec[], edges: EdgeSpec[], delay = 1500) {
  const [state, setState] = useState<ExecutionPreviewState>({
    isRunning: false,
    isPaused: false,
    currentNodeId: null,
    executedNodeIds: new Set(),
    step: 0,
  });

  const orderRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const advance = useCallback(() => {
    const s = stateRef.current;
    const order = orderRef.current;
    const nextStep = s.step + 1;

    if (nextStep >= order.length) {
      // Finished
      setState({
        isRunning: false,
        isPaused: false,
        currentNodeId: null,
        executedNodeIds: new Set([...s.executedNodeIds, ...(s.currentNodeId ? [s.currentNodeId] : [])]),
        step: nextStep,
      });
      return;
    }

    setState({
      isRunning: true,
      isPaused: false,
      currentNodeId: order[nextStep] ?? null,
      executedNodeIds: new Set([...s.executedNodeIds, ...(s.currentNodeId ? [s.currentNodeId] : [])]),
      step: nextStep,
    });

    timerRef.current = setTimeout(() => advance(), delay);
  }, [delay]);

  const start = useCallback(() => {
    const order = topologicalSort(nodes, edges);
    orderRef.current = order;
    if (order.length === 0) return;

    setState({
      isRunning: true,
      isPaused: false,
      currentNodeId: order[0] ?? null,
      executedNodeIds: new Set(),
      step: 0,
    });

    timerRef.current = setTimeout(() => advance(), delay);
  }, [nodes, edges, delay, advance]);

  const pause = useCallback(() => {
    clearTimer();
    setState((s) => ({ ...s, isPaused: true }));
  }, [clearTimer]);

  const resume = useCallback(() => {
    setState((s) => ({ ...s, isPaused: false }));
    timerRef.current = setTimeout(() => advance(), delay);
  }, [advance, delay]);

  const reset = useCallback(() => {
    clearTimer();
    setState({
      isRunning: false,
      isPaused: false,
      currentNodeId: null,
      executedNodeIds: new Set(),
      step: 0,
    });
  }, [clearTimer]);

  const stepForward = useCallback(() => {
    if (!state.isRunning) {
      // Start fresh then pause
      const order = topologicalSort(nodes, edges);
      orderRef.current = order;
      if (order.length === 0) return;
      setState({
        isRunning: true,
        isPaused: true,
        currentNodeId: order[0] ?? null,
        executedNodeIds: new Set(),
        step: 0,
      });
    } else {
      clearTimer();
      advance();
      // Pause after step
      setTimeout(() => {
        setState((s) => ({ ...s, isPaused: true }));
        clearTimer();
      }, 50);
    }
  }, [state.isRunning, nodes, edges, clearTimer, advance]);

  // Cleanup
  useEffect(() => () => clearTimer(), [clearTimer]);

  return {
    ...state,
    start,
    pause,
    resume,
    reset,
    stepForward,
  };
}
