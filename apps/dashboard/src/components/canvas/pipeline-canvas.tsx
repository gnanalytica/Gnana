"use client";
import { useCallback, useState } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { TriggerNode } from "./nodes/trigger-node";
import { LLMNode } from "./nodes/llm-node";
import { HumanGateNode } from "./nodes/human-gate-node";
import { ToolNode } from "./nodes/tool-node";
import { ConditionNode } from "./nodes/condition-node";
import { OutputNode } from "./nodes/output-node";
import { ConfigDrawer } from "./config-drawer";

const nodeTypes = {
  trigger: TriggerNode,
  llm: LLMNode,
  humanGate: HumanGateNode,
  tool: ToolNode,
  condition: ConditionNode,
  output: OutputNode,
};

// Default pipeline nodes for a new agent
function createDefaultNodes(): Node[] {
  return [
    { id: "trigger", type: "trigger", position: { x: 0, y: 150 }, data: { triggerType: "Manual" } },
    {
      id: "analyze",
      type: "llm",
      position: { x: 220, y: 100 },
      data: { phase: "analyze", model: "Claude Sonnet 4", provider: "Anthropic", toolCount: 3 },
    },
    {
      id: "plan",
      type: "llm",
      position: { x: 460, y: 100 },
      data: { phase: "plan", model: "Gemini 2.5 Flash", provider: "Google", toolCount: 0 },
    },
    {
      id: "approve",
      type: "humanGate",
      position: { x: 700, y: 150 },
      data: { approval: "required" },
    },
    {
      id: "execute",
      type: "llm",
      position: { x: 940, y: 100 },
      data: { phase: "execute", model: "GPT-4.1", provider: "OpenAI", toolCount: 5 },
    },
    { id: "output", type: "output", position: { x: 1160, y: 150 }, data: {} },
  ];
}

function createDefaultEdges(): Edge[] {
  return [
    {
      id: "e-trigger-analyze",
      source: "trigger",
      target: "analyze",
      animated: true,
      style: { stroke: "var(--phase-trigger)" },
    },
    {
      id: "e-analyze-plan",
      source: "analyze",
      target: "plan",
      animated: true,
      style: { stroke: "var(--phase-analyze)" },
    },
    {
      id: "e-plan-approve",
      source: "plan",
      target: "approve",
      animated: true,
      style: { stroke: "var(--phase-plan)" },
    },
    {
      id: "e-approve-execute",
      source: "approve",
      target: "execute",
      animated: true,
      style: { stroke: "var(--phase-approve)" },
    },
    {
      id: "e-execute-output",
      source: "execute",
      target: "output",
      animated: true,
      style: { stroke: "var(--phase-execute)" },
    },
  ];
}

export function PipelineCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState(createDefaultNodes());
  const [edges, _setEdges, onEdgesChange] = useEdgesState(createDefaultEdges());
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setDrawerOpen(true);
  }, []);

  return (
    <div className="h-full w-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        className="bg-background"
      >
        <Controls className="!bg-card !border-border !shadow-md" />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="!bg-background" />
        <MiniMap
          className="!bg-card !border-border"
          nodeColor={(node) => {
            const phase = (node.data as any)?.phase;
            if (phase === "analyze") return "var(--phase-analyze, #60a5fa)";
            if (phase === "plan") return "var(--phase-plan, #34d399)";
            if (phase === "execute") return "var(--phase-execute, #f472b6)";
            if (node.type === "trigger") return "var(--phase-trigger, #a78bfa)";
            if (node.type === "humanGate") return "var(--phase-approve, #f59e0b)";
            return "#6b7280";
          }}
        />
      </ReactFlow>
      <ConfigDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        nodeData={selectedNode?.data}
        onUpdate={(data) => {
          if (selectedNode) {
            setNodes((nds) =>
              nds.map((n) =>
                n.id === selectedNode.id ? { ...n, data: { ...n.data, ...data } } : n,
              ),
            );
          }
        }}
      />
    </div>
  );
}
