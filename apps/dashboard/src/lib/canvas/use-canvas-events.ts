import type { NodeSpec, EdgeSpec } from "@/types/pipeline";

export type CanvasEvent =
  | { type: "nodeAdded"; node: NodeSpec }
  | { type: "nodeRemoved"; nodeId: string; nodeType: string }
  | { type: "nodeUpdated"; nodeId: string; changes: Record<string, unknown> }
  | { type: "edgeAdded"; source: string; target: string }
  | { type: "edgeRemoved"; source: string; target: string };

/**
 * Compute meaningful canvas diffs between two pipeline states.
 * Ignores position-only changes -- only reports structural and data changes.
 */
export function computeCanvasDiff(
  prevNodes: NodeSpec[],
  newNodes: NodeSpec[],
  prevEdges: EdgeSpec[],
  newEdges: EdgeSpec[],
): CanvasEvent[] {
  const events: CanvasEvent[] = [];

  const prevNodeMap = new Map(prevNodes.map((n) => [n.id, n]));
  const newNodeMap = new Map(newNodes.map((n) => [n.id, n]));

  // Detect added nodes
  for (const node of newNodes) {
    if (!prevNodeMap.has(node.id)) {
      events.push({ type: "nodeAdded", node });
    }
  }

  // Detect removed nodes
  for (const node of prevNodes) {
    if (!newNodeMap.has(node.id)) {
      events.push({ type: "nodeRemoved", nodeId: node.id, nodeType: node.type });
    }
  }

  // Detect updated nodes (data changes only, not position)
  for (const node of newNodes) {
    const prev = prevNodeMap.get(node.id);
    if (prev && JSON.stringify(prev.data) !== JSON.stringify(node.data)) {
      events.push({ type: "nodeUpdated", nodeId: node.id, changes: node.data });
    }
  }

  // Detect edge changes
  const prevEdgeSet = new Set(prevEdges.map((e) => `${e.source}->${e.target}`));
  const newEdgeSet = new Set(newEdges.map((e) => `${e.source}->${e.target}`));

  for (const edge of newEdges) {
    if (!prevEdgeSet.has(`${edge.source}->${edge.target}`)) {
      events.push({ type: "edgeAdded", source: edge.source, target: edge.target });
    }
  }
  for (const edge of prevEdges) {
    if (!newEdgeSet.has(`${edge.source}->${edge.target}`)) {
      events.push({ type: "edgeRemoved", source: edge.source, target: edge.target });
    }
  }

  return events;
}

/**
 * Format canvas events into a human-readable summary string
 * suitable for sending to the AI assistant as context.
 */
export function formatCanvasEvents(events: CanvasEvent[]): string {
  if (events.length === 0) return "";

  const parts: string[] = [];
  for (const event of events) {
    switch (event.type) {
      case "nodeAdded": {
        const label =
          (event.node.data.name as string) ||
          (event.node.data.label as string) ||
          (event.node.data.phase as string) ||
          event.node.type;
        parts.push(`added a ${event.node.type} node "${label}"`);
        break;
      }
      case "nodeRemoved":
        parts.push(`removed a ${event.nodeType} node (${event.nodeId})`);
        break;
      case "nodeUpdated":
        parts.push(`updated node ${event.nodeId}`);
        break;
      case "edgeAdded":
        parts.push(`connected ${event.source} to ${event.target}`);
        break;
      case "edgeRemoved":
        parts.push(`disconnected ${event.source} from ${event.target}`);
        break;
    }
  }

  return `The user just ${parts.join(", ")}`;
}
