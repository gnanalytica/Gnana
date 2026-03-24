import { useCallback, useRef } from "react";
import type { Node, Edge } from "@xyflow/react";

interface Snapshot {
  nodes: Node[];
  edges: Edge[];
}

interface UndoRedoState {
  past: Snapshot[];
  present: Snapshot;
  future: Snapshot[];
}

const MAX_HISTORY = 50;

export function useUndoRedo(initialNodes: Node[], initialEdges: Edge[]) {
  const stateRef = useRef<UndoRedoState>({
    past: [],
    present: { nodes: initialNodes, edges: initialEdges },
    future: [],
  });

  // Debounce timer ref
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Force re-render counter
  const renderRef = useRef(0);
  const forceUpdate = useCallback(() => {
    renderRef.current++;
  }, []);

  const pushSnapshot = useCallback(
    (nodes: Node[], edges: Edge[]) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const state = stateRef.current;
        const past = [...state.past, state.present].slice(-MAX_HISTORY);
        stateRef.current = {
          past,
          present: { nodes, edges },
          future: [],
        };
        forceUpdate();
      }, 300);
    },
    [forceUpdate],
  );

  const undo = useCallback((): Snapshot | null => {
    const state = stateRef.current;
    if (state.past.length === 0) return null;
    const previous = state.past[state.past.length - 1]!;
    stateRef.current = {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
    };
    forceUpdate();
    return previous;
  }, [forceUpdate]);

  const redo = useCallback((): Snapshot | null => {
    const state = stateRef.current;
    if (state.future.length === 0) return null;
    const next = state.future[0]!;
    stateRef.current = {
      past: [...state.past, state.present],
      present: next,
      future: state.future.slice(1),
    };
    forceUpdate();
    return next;
  }, [forceUpdate]);

  return {
    pushSnapshot,
    undo,
    redo,
    canUndo: stateRef.current.past.length > 0,
    canRedo: stateRef.current.future.length > 0,
  };
}
