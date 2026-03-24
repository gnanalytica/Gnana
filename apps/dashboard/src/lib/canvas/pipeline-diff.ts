import type { PipelineConfig, NodeSpec, EdgeSpec } from "@/types/pipeline";

interface DiffResult {
  addedNodes: NodeSpec[];
  removedNodes: NodeSpec[];
  modifiedNodes: { before: NodeSpec; after: NodeSpec }[];
  addedEdges: EdgeSpec[];
  removedEdges: EdgeSpec[];
}

/**
 * Diff two PipelineConfig objects and return the differences.
 */
export function diffPipelines(before: PipelineConfig, after: PipelineConfig): DiffResult {
  const beforeNodeMap = new Map(before.nodes.map((n) => [n.id, n]));
  const afterNodeMap = new Map(after.nodes.map((n) => [n.id, n]));

  const addedNodes = after.nodes.filter((n) => !beforeNodeMap.has(n.id));
  const removedNodes = before.nodes.filter((n) => !afterNodeMap.has(n.id));
  const modifiedNodes: DiffResult["modifiedNodes"] = [];

  for (const afterNode of after.nodes) {
    const beforeNode = beforeNodeMap.get(afterNode.id);
    if (beforeNode && JSON.stringify(beforeNode.data) !== JSON.stringify(afterNode.data)) {
      modifiedNodes.push({ before: beforeNode, after: afterNode });
    }
  }

  const edgeKey = (e: EdgeSpec) => `${e.source}->${e.target}:${e.sourceHandle ?? ""}`;
  const beforeEdgeSet = new Set(before.edges.map(edgeKey));
  const afterEdgeSet = new Set(after.edges.map(edgeKey));

  const addedEdges = after.edges.filter((e) => !beforeEdgeSet.has(edgeKey(e)));
  const removedEdges = before.edges.filter((e) => !afterEdgeSet.has(edgeKey(e)));

  return { addedNodes, removedNodes, modifiedNodes, addedEdges, removedEdges };
}
