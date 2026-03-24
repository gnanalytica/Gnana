import type { Node, Edge } from "@xyflow/react";

/**
 * Create a group node encompassing the selected nodes.
 * Sets parentId on children and converts to relative positions.
 */
export function createGroup(
  selectedIds: string[],
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const selectedNodes = nodes.filter((n) => selectedIds.includes(n.id));
  if (selectedNodes.length < 2) return { nodes, edges };

  // Compute bounding box
  const padding = 40;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const node of selectedNodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + 180); // approximate width
    maxY = Math.max(maxY, node.position.y + 100); // approximate height
  }

  const groupId = `group-${Date.now()}`;
  const groupNode: Node = {
    id: groupId,
    type: "group",
    position: { x: minX - padding, y: minY - padding },
    data: { label: "Group", childCount: selectedNodes.length },
    style: {
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    },
  };

  // Update children to have parentId and relative positions
  const updatedNodes = nodes.map((node) => {
    if (selectedIds.includes(node.id)) {
      return {
        ...node,
        parentId: groupId,
        extent: "parent" as const,
        position: {
          x: node.position.x - (minX - padding),
          y: node.position.y - (minY - padding),
        },
      };
    }
    return node;
  });

  return {
    nodes: [groupNode, ...updatedNodes],
    edges,
  };
}

/**
 * Ungroup: remove group node and convert children back to absolute positions.
 */
export function expandGroup(
  groupId: string,
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const groupNode = nodes.find((n) => n.id === groupId);
  if (!groupNode) return { nodes, edges };

  const updatedNodes = nodes
    .filter((n) => n.id !== groupId)
    .map((node) => {
      if (node.parentId === groupId) {
        return {
          ...node,
          parentId: undefined,
          extent: undefined,
          position: {
            x: node.position.x + groupNode.position.x,
            y: node.position.y + groupNode.position.y,
          },
        };
      }
      return node;
    });

  return {
    nodes: updatedNodes,
    edges,
  };
}
