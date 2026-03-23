"use client";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type ReactFlowInstance,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { TriggerNode } from "./nodes/trigger-node";
import { LLMNode } from "./nodes/llm-node";
import { HumanGateNode } from "./nodes/human-gate-node";
import { ToolNode } from "./nodes/tool-node";
import { ConditionNode } from "./nodes/condition-node";
import { OutputNode } from "./nodes/output-node";
import { LoopNode } from "./nodes/loop-node";
import { ParallelNode } from "./nodes/parallel-node";
import { MergeNode } from "./nodes/merge-node";
import { TransformNode } from "./nodes/transform-node";
import { ConfigDrawer } from "./config-drawer";
import { NodePalette, NODE_SHORTCUTS } from "./node-palette";
import type { PipelineNodeType, NodeSpec, EdgeSpec } from "@/types/pipeline";

const nodeTypes = {
  trigger: TriggerNode,
  llm: LLMNode,
  humanGate: HumanGateNode,
  tool: ToolNode,
  condition: ConditionNode,
  output: OutputNode,
  loop: LoopNode,
  parallel: ParallelNode,
  merge: MergeNode,
  transform: TransformNode,
};

/** Default data for each node type when created via palette */
const defaultNodeData: Record<PipelineNodeType, Record<string, unknown>> = {
  trigger: { triggerType: "Manual" },
  llm: { phase: "analyze", model: "Claude Sonnet 4", provider: "Anthropic", toolCount: 0 },
  tool: { name: "Unnamed", description: "" },
  humanGate: { approval: "required" },
  condition: { expression: "if ..." },
  loop: { maxIterations: 5 },
  parallel: { branches: 2 },
  merge: { inputs: 2 },
  transform: { expression: "Map data" },
  output: { label: "Result" },
};

// Default pipeline nodes for a new agent (backward compat)
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
    { id: "e-trigger-analyze", source: "trigger", target: "analyze", animated: true, style: { stroke: "var(--phase-trigger)" } },
    { id: "e-analyze-plan", source: "analyze", target: "plan", animated: true, style: { stroke: "var(--phase-analyze)" } },
    { id: "e-plan-approve", source: "plan", target: "approve", animated: true, style: { stroke: "var(--phase-plan)" } },
    { id: "e-approve-execute", source: "approve", target: "execute", animated: true, style: { stroke: "var(--phase-approve)" } },
    { id: "e-execute-output", source: "execute", target: "output", animated: true, style: { stroke: "var(--phase-execute)" } },
  ];
}

function specToNodes(specs: NodeSpec[]): Node[] {
  return specs.map((s) => ({
    id: s.id,
    type: s.type,
    position: s.position,
    data: s.data,
  }));
}

function specToEdges(specs: EdgeSpec[]): Edge[] {
  return specs.map((s) => ({
    id: `e-${s.source}-${s.target}`,
    source: s.source,
    target: s.target,
    sourceHandle: s.sourceHandle,
    label: s.label,
    animated: true,
    style: { stroke: "hsl(var(--primary))" },
  }));
}

export interface PipelineCanvasProps {
  initialNodes?: NodeSpec[];
  initialEdges?: EdgeSpec[];
  /** Called whenever the pipeline changes (for bidirectional sync) */
  onChange?: (nodes: NodeSpec[], edges: EdgeSpec[]) => void;
}

export function PipelineCanvas({ initialNodes, initialEdges, onChange }: PipelineCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(
    initialNodes ? specToNodes(initialNodes) : createDefaultNodes(),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initialEdges ? specToEdges(initialEdges) : createDefaultEdges(),
  );
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const idCounter = useRef(1);

  // Notify parent on changes
  useEffect(() => {
    if (!onChange) return;
    const nodeSpecs: NodeSpec[] = nodes.map((n) => ({
      id: n.id,
      type: n.type as PipelineNodeType,
      position: n.position,
      data: n.data as Record<string, unknown>,
    }));
    const edgeSpecs: EdgeSpec[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      label: typeof e.label === "string" ? e.label : undefined,
    }));
    onChange(nodeSpecs, edgeSpecs);
  }, [nodes, edges, onChange]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          { ...params, animated: true, style: { stroke: "hsl(var(--primary))" } },
          eds,
        ),
      );
    },
    [setEdges],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setDrawerOpen(true);
  }, []);

  /** Create a new node at a given position */
  const createNode = useCallback(
    (type: PipelineNodeType, position?: { x: number; y: number }) => {
      const id = `${type}-${Date.now()}-${idCounter.current++}`;
      const pos = position ?? { x: 300, y: 200 };
      const newNode: Node = {
        id,
        type,
        position: pos,
        data: { ...defaultNodeData[type] },
      };
      setNodes((nds) => [...nds, newNode]);
      return id;
    },
    [setNodes],
  );

  /** Handle palette add (double-click) */
  const handlePaletteAdd = useCallback(
    (type: PipelineNodeType) => {
      // Place in center of current viewport
      if (rfInstance) {
        const viewport = rfInstance.getViewport();
        const pos = rfInstance.screenToFlowPosition({
          x: window.innerWidth / 2 - viewport.x,
          y: window.innerHeight / 2 - viewport.y,
        });
        createNode(type, pos);
      } else {
        createNode(type);
      }
    },
    [createNode, rfInstance],
  );

  /** Handle drop from palette */
  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/reactflow-nodetype") as PipelineNodeType;
      if (!type || !rfInstance) return;
      const position = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      createNode(type, position);
    },
    [createNode, rfInstance],
  );

  /** Keyboard shortcuts */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only if no input is focused
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const type = NODE_SHORTCUTS[e.key.toLowerCase()];
      if (type) {
        e.preventDefault();
        handlePaletteAdd(type);
      }

      // Delete selected nodes
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNode) {
        setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
        setEdges((eds) =>
          eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id),
        );
        setSelectedNode(null);
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handlePaletteAdd, selectedNode, setNodes, setEdges]);

  return (
    <div className="h-full w-full relative" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onInit={setRfInstance}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={null} // we handle delete manually
        className="bg-background"
      >
        <Controls className="!bg-card !border-border !shadow-md" />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="!bg-background" />
        <MiniMap
          className="!bg-card !border-border"
          nodeColor={(node) => {
            const phase = (node.data as Record<string, unknown>)?.phase as string | undefined;
            if (phase === "analyze") return "var(--phase-analyze, #60a5fa)";
            if (phase === "plan") return "var(--phase-plan, #34d399)";
            if (phase === "execute") return "var(--phase-execute, #f472b6)";
            if (node.type === "trigger") return "var(--phase-trigger, #a78bfa)";
            if (node.type === "humanGate") return "var(--phase-approve, #f59e0b)";
            if (node.type === "loop") return "var(--phase-loop, #fbbf24)";
            if (node.type === "parallel") return "var(--phase-parallel, #22d3ee)";
            if (node.type === "merge") return "var(--phase-merge, #2dd4bf)";
            if (node.type === "transform") return "var(--phase-transform, #fb923c)";
            if (node.type === "condition") return "hsl(var(--primary))";
            if (node.type === "output") return "var(--status-completed, #22c55e)";
            return "#6b7280";
          }}
        />
      </ReactFlow>

      <NodePalette onAddNode={handlePaletteAdd} />

      <ConfigDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        node={selectedNode}
        onUpdate={(data) => {
          if (selectedNode) {
            setNodes((nds) =>
              nds.map((n) =>
                n.id === selectedNode.id ? { ...n, data: { ...n.data, ...data } } : n,
              ),
            );
          }
        }}
        onDelete={() => {
          if (selectedNode) {
            setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
            setEdges((eds) =>
              eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id),
            );
            setSelectedNode(null);
            setDrawerOpen(false);
          }
        }}
      />
    </div>
  );
}
