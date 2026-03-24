import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

/** Default node dimensions by type */
const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  trigger: { width: 160, height: 80 },
  llm: { width: 180, height: 100 },
  tool: { width: 160, height: 90 },
  humanGate: { width: 160, height: 80 },
  condition: { width: 160, height: 100 },
  loop: { width: 170, height: 100 },
  parallel: { width: 170, height: 90 },
  merge: { width: 170, height: 90 },
  transform: { width: 170, height: 80 },
  output: { width: 160, height: 80 },
  group: { width: 300, height: 200 },
};

/**
 * Apply dagre auto-layout to a set of nodes and edges.
 * Returns a new array of nodes with updated positions.
 */
export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "LR" | "TB" = "LR",
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 200 });

  for (const node of nodes) {
    const dims = NODE_DIMENSIONS[node.type ?? ""] ?? { width: 160, height: 80 };
    g.setNode(node.id, { width: dims.width, height: dims.height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const dims = NODE_DIMENSIONS[node.type ?? ""] ?? { width: 160, height: 80 };
    return {
      ...node,
      position: {
        // dagre returns center coords, React Flow uses top-left
        x: pos.x - dims.width / 2,
        y: pos.y - dims.height / 2,
      },
    };
  });
}
