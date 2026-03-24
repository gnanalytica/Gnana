import type { Node, Edge } from "@xyflow/react";

export interface ClipboardData {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Serialize selected nodes and their internal edges for copying.
 */
export function copyNodes(selectedNodes: Node[], allEdges: Edge[]): ClipboardData {
  const nodeIds = new Set(selectedNodes.map((n) => n.id));
  // Only include edges where both source and target are in the selection
  const internalEdges = allEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  return {
    nodes: selectedNodes.map((n) => ({ ...n })),
    edges: internalEdges.map((e) => ({ ...e })),
  };
}

/**
 * Create cloned copies of clipboard data with new IDs and position offset.
 */
export function pasteNodes(
  clipboard: ClipboardData,
  offset: { x: number; y: number } = { x: 20, y: 20 },
): { nodes: Node[]; edges: Edge[] } {
  const idMap = new Map<string, string>();
  const now = Date.now();

  const newNodes = clipboard.nodes.map((node, i) => {
    const newId = `${node.type}-${now}-${i}`;
    idMap.set(node.id, newId);
    return {
      ...node,
      id: newId,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
      selected: false,
    };
  });

  const newEdges = clipboard.edges.map((edge) => {
    const newSource = idMap.get(edge.source) ?? edge.source;
    const newTarget = idMap.get(edge.target) ?? edge.target;
    return {
      ...edge,
      id: `e-${newSource}-${newTarget}`,
      source: newSource,
      target: newTarget,
      selected: false,
    };
  });

  return { nodes: newNodes, edges: newEdges };
}
