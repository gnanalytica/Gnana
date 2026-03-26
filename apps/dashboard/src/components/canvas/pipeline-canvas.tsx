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
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type Connection,
  type ReactFlowInstance,
  type OnSelectionChangeParams,
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
import { GroupNode } from "./nodes/group-node";
import { ConfigDrawer } from "./config-drawer";
import { NodePalette, NODE_SHORTCUTS } from "./node-palette";
import { CanvasContextMenu, type ContextMenuState } from "./canvas-context-menu";
import { CustomEdge } from "./custom-edge";
import { ExecutionToolbar } from "./execution-toolbar";
import { Button } from "@/components/ui/button";
import { LayoutGrid, Undo2, Redo2, Play } from "lucide-react";
import { applyDagreLayout } from "@/lib/canvas/auto-layout";
import { useUndoRedo } from "@/lib/canvas/use-undo-redo";
import { copyNodes, pasteNodes, type ClipboardData } from "@/lib/canvas/clipboard";
import { validatePipeline } from "@/lib/canvas/validate-pipeline";
import { createGroup } from "@/lib/canvas/group-utils";
import { useExecutionPreview } from "@/lib/canvas/use-execution-preview";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import type { PipelineNodeType, NodeSpec, EdgeSpec } from "@/types/pipeline";
import type { ValidationError } from "@/lib/canvas/validation-types";

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
  group: GroupNode,
};

const edgeTypes = {
  custom: CustomEdge,
};

/** Default data for each node type when created via palette */
const defaultNodeData: Record<string, Record<string, unknown>> = {
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
  group: { label: "Group" },
};

/** Auto-infer edge label from source node type */
function inferEdgeLabel(sourceNode: Node | undefined): string | undefined {
  if (!sourceNode) return undefined;
  const d = sourceNode.data as Record<string, unknown>;
  if (sourceNode.type === "llm") {
    const phase = d.phase as string;
    if (phase === "analyze") return "Analysis";
    if (phase === "plan") return "Plan";
    if (phase === "execute") return "Result";
    return "LLMResponse";
  }
  if (sourceNode.type === "tool") return "ToolResult";
  if (sourceNode.type === "trigger") return "Input";
  return undefined;
}

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
    {
      id: "e-trigger-analyze",
      source: "trigger",
      target: "analyze",
      type: "custom",
      animated: true,
      style: { stroke: "var(--phase-trigger)" },
    },
    {
      id: "e-analyze-plan",
      source: "analyze",
      target: "plan",
      type: "custom",
      animated: true,
      style: { stroke: "var(--phase-analyze)" },
    },
    {
      id: "e-plan-approve",
      source: "plan",
      target: "approve",
      type: "custom",
      animated: true,
      style: { stroke: "var(--phase-plan)" },
    },
    {
      id: "e-approve-execute",
      source: "approve",
      target: "execute",
      type: "custom",
      animated: true,
      style: { stroke: "var(--phase-approve)" },
    },
    {
      id: "e-execute-output",
      source: "execute",
      target: "output",
      type: "custom",
      animated: true,
      style: { stroke: "var(--phase-execute)" },
    },
  ];
}

function specToNodes(specs: NodeSpec[]): Node[] {
  return specs.map((s) => ({
    id: s.id,
    type: s.type,
    position: s.position,
    data: s.data,
    ...(s.parentId ? { parentId: s.parentId, extent: "parent" as const } : {}),
  }));
}

function specToEdges(specs: EdgeSpec[]): Edge[] {
  return specs.map((s) => ({
    id: `e-${s.source}-${s.target}`,
    source: s.source,
    target: s.target,
    sourceHandle: s.sourceHandle,
    label: s.label,
    type: "custom",
    animated: true,
    style: { stroke: "hsl(var(--primary))" },
    data: { dataType: s.dataType },
  }));
}

export interface LiveRunOverlay {
  executingNodeId: string | null;
  completedNodeIds: Set<string>;
  failedNodeIds: Set<string>;
  isRunning: boolean;
}

export interface PipelineCanvasProps {
  initialNodes?: NodeSpec[];
  initialEdges?: EdgeSpec[];
  /** Called whenever the pipeline changes (for bidirectional sync) */
  onChange?: (nodes: NodeSpec[], edges: EdgeSpec[]) => void;
  /** Live run overlay state — lights up nodes during execution */
  liveRun?: LiveRunOverlay | null;
  /** Called when a node is clicked (with node ID) or canvas background is clicked (null) */
  onNodeSelect?: (nodeId: string | null) => void;
}

function PipelineCanvasInner({
  initialNodes,
  initialEdges,
  onChange,
  liveRun,
  onNodeSelect,
}: PipelineCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(
    initialNodes ? specToNodes(initialNodes) : createDefaultNodes(),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initialEdges ? specToEdges(initialEdges) : createDefaultEdges(),
  );
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const idCounter = useRef(1);
  const clipboardRef = useRef<ClipboardData | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [dryRunNodeIds, setDryRunNodeIds] = useState<Set<string> | null>(null);
  const [validationErrors, setValidationErrors] = useState<Map<string, ValidationError[]>>(
    new Map(),
  );
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMobile = useMediaQuery("(max-width: 768px)");

  const { fitView } = useReactFlow();

  // Undo/Redo
  const { pushSnapshot, undo, redo, canUndo, canRedo } = useUndoRedo(
    initialNodes ? specToNodes(initialNodes) : createDefaultNodes(),
    initialEdges ? specToEdges(initialEdges) : createDefaultEdges(),
  );

  // Execution preview
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
  const execPreview = useExecutionPreview(nodeSpecs, edgeSpecs);

  // Run validation on changes (debounced 500ms)
  useEffect(() => {
    if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
    validationTimerRef.current = setTimeout(() => {
      const ns: NodeSpec[] = nodes.map((n) => ({
        id: n.id,
        type: n.type as PipelineNodeType,
        position: n.position,
        data: n.data as Record<string, unknown>,
      }));
      const es: EdgeSpec[] = edges.map((e) => ({
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        label: typeof e.label === "string" ? e.label : undefined,
      }));
      const result = validatePipeline(ns, es);
      const errorMap = new Map<string, ValidationError[]>();
      for (const err of [...result.errors, ...result.warnings]) {
        if (err.nodeId) {
          const existing = errorMap.get(err.nodeId) ?? [];
          existing.push(err);
          errorMap.set(err.nodeId, existing);
        }
      }
      setValidationErrors(errorMap);
    }, 500);
  }, [nodes, edges]);

  // Inject _errors, _executing, _completed, _failed, _dryRunExecuted, _dryRunSkipped into node data for rendering
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        const errors = validationErrors.get(n.id);
        // Preview state (local simulation)
        const isPreviewExecuting = execPreview.currentNodeId === n.id;
        const isPreviewExecuted = execPreview.executedNodeIds.has(n.id);
        // Live run state (real execution via WebSocket) takes priority
        const isLiveExecuting = liveRun?.isRunning && liveRun.executingNodeId === n.id;
        const isLiveCompleted = liveRun?.isRunning && liveRun.completedNodeIds.has(n.id);
        const isLiveFailed = liveRun?.failedNodeIds.has(n.id);
        // Dry-run preview state
        const isDryRunExecuted = dryRunNodeIds !== null && dryRunNodeIds.has(n.id);
        const isDryRunSkipped = dryRunNodeIds !== null && !dryRunNodeIds.has(n.id);
        return {
          ...n,
          data: {
            ...n.data,
            _errors: errors ?? null,
            _executing: isLiveExecuting || isPreviewExecuting,
            _executed: isPreviewExecuted,
            _completed: isLiveCompleted ?? false,
            _failed: isLiveFailed ?? false,
            _dryRunExecuted: isDryRunExecuted,
            _dryRunSkipped: isDryRunSkipped,
          },
        };
      }),
    );
  }, [
    validationErrors,
    execPreview.currentNodeId,
    execPreview.executedNodeIds,
    liveRun,
    dryRunNodeIds,
    setNodes,
  ]);

  // Notify parent on changes
  useEffect(() => {
    if (!onChange) return;
    const ns: NodeSpec[] = nodes.map((n) => ({
      id: n.id,
      type: n.type as PipelineNodeType,
      position: n.position,
      data: n.data as Record<string, unknown>,
      ...(n.parentId ? { parentId: n.parentId } : {}),
    }));
    const es: EdgeSpec[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      label: typeof e.label === "string" ? e.label : undefined,
      dataType: (e.data as Record<string, unknown>)?.dataType as string | undefined,
    }));
    onChange(ns, es);
  }, [nodes, edges, onChange]);

  // Push snapshots for undo/redo
  useEffect(() => {
    pushSnapshot(nodes, edges);
  }, [nodes, edges, pushSnapshot]);

  const onConnect = useCallback(
    (params: Connection) => {
      const sourceNode = nodes.find((n) => n.id === params.source);
      const label = inferEdgeLabel(sourceNode);
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "custom",
            animated: true,
            style: { stroke: "hsl(var(--primary))" },
            label,
            data: { dataType: label },
          },
          eds,
        ),
      );
    },
    [setEdges, nodes],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode(node);
      setDrawerOpen(true);
      onNodeSelect?.(node.id);
    },
    [onNodeSelect],
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect?.(null);
  }, [onNodeSelect]);

  const onSelectionChange = useCallback(({ nodes: selected }: OnSelectionChangeParams) => {
    setSelectedNodes(selected);
  }, []);

  /** Create a new node at a given position */
  const createNode = useCallback(
    (type: PipelineNodeType | "group", position?: { x: number; y: number }) => {
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

  /** Auto-layout */
  const handleAutoLayout = useCallback(() => {
    const layoutedNodes = applyDagreLayout(nodes, edges);
    setNodes(layoutedNodes);
    setTimeout(() => fitView({ padding: 0.2 }), 50);
  }, [nodes, edges, setNodes, fitView]);

  /** Undo handler */
  const handleUndo = useCallback(() => {
    const snapshot = undo();
    if (snapshot) {
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
    }
  }, [undo, setNodes, setEdges]);

  /** Redo handler */
  const handleRedo = useCallback(() => {
    const snapshot = redo();
    if (snapshot) {
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
    }
  }, [redo, setNodes, setEdges]);

  /** Copy selected nodes */
  const handleCopy = useCallback(() => {
    const selected = nodes.filter((n) => n.selected);
    if (selected.length > 0) {
      clipboardRef.current = copyNodes(selected, edges);
    } else if (selectedNode) {
      clipboardRef.current = copyNodes([selectedNode], edges);
    }
  }, [nodes, edges, selectedNode]);

  /** Paste nodes */
  const handlePaste = useCallback(() => {
    if (!clipboardRef.current) return;
    const { nodes: newNodes, edges: newEdges } = pasteNodes(clipboardRef.current);
    setNodes((nds) => [...nds, ...newNodes]);
    setEdges((eds) => [...eds, ...newEdges]);
  }, [setNodes, setEdges]);

  /** Duplicate selected nodes */
  const handleDuplicate = useCallback(() => {
    const selected = nodes.filter((n) => n.selected);
    const toDuplicate = selected.length > 0 ? selected : selectedNode ? [selectedNode] : [];
    if (toDuplicate.length === 0) return;
    const clip = copyNodes(toDuplicate, edges);
    const { nodes: newNodes, edges: newEdges } = pasteNodes(clip);
    setNodes((nds) => [...nds, ...newNodes]);
    setEdges((eds) => [...eds, ...newEdges]);
  }, [nodes, edges, selectedNode, setNodes, setEdges]);

  /** Group selected nodes */
  const handleGroup = useCallback(() => {
    const selected = nodes.filter((n) => n.selected);
    if (selected.length < 2) return;
    const selectedIds = selected.map((n) => n.id);
    const result = createGroup(selectedIds, nodes, edges);
    setNodes(result.nodes);
    setEdges(result.edges);
  }, [nodes, edges, setNodes, setEdges]);

  /** Delete selected node(s) */
  const handleDeleteSelected = useCallback(() => {
    if (selectedNode) {
      setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
      setEdges((eds) =>
        eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id),
      );
      setSelectedNode(null);
      setDrawerOpen(false);
    }
  }, [selectedNode, setNodes, setEdges]);

  /** Context menu handlers */
  const onPaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({ type: "pane", x: event.clientX, y: event.clientY });
  }, []);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setSelectedNode(node);
      setContextMenu({
        type: "node",
        x: event.clientX,
        y: event.clientY,
        nodeId: node.id,
        multiSelected: selectedNodes.length > 1,
      });
    },
    [selectedNodes],
  );

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    setContextMenu({ type: "edge", x: event.clientX, y: event.clientY, edgeId: edge.id });
  }, []);

  /** Keyboard shortcuts */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Undo/Redo
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Copy/Paste/Duplicate
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        e.preventDefault();
        handleCopy();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        e.preventDefault();
        handlePaste();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        handleDuplicate();
        return;
      }

      // Select all
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
        return;
      }

      // Node shortcuts
      const type = NODE_SHORTCUTS[e.key.toLowerCase()];
      if (type) {
        e.preventDefault();
        handlePaletteAdd(type);
      }

      // Delete selected nodes
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNode) {
        handleDeleteSelected();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    handlePaletteAdd,
    selectedNode,
    handleUndo,
    handleRedo,
    handleCopy,
    handlePaste,
    handleDuplicate,
    handleDeleteSelected,
    setNodes,
  ]);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  return (
    <div className="h-full w-full relative" ref={reactFlowWrapper}>
      {/* Toolbar */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1 bg-card border border-border rounded-lg shadow-md px-1.5 py-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </Button>
        <div className="w-px h-4 bg-border mx-0.5" />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleAutoLayout}
          title="Auto Layout"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setShowPreview(!showPreview)}
          title="Preview Execution"
        >
          <Play className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Execution preview toolbar */}
      {showPreview && (
        <ExecutionToolbar
          isRunning={execPreview.isRunning}
          isPaused={execPreview.isPaused}
          step={execPreview.step}
          onStart={execPreview.start}
          onPause={execPreview.pause}
          onResume={execPreview.resume}
          onReset={execPreview.reset}
          onStep={execPreview.stepForward}
          nodes={nodeSpecs}
          edges={edgeSpecs}
          onPreviewChange={setDryRunNodeIds}
        />
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onInit={setRfInstance}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onSelectionChange={onSelectionChange}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: "custom" }}
        fitView
        deleteKeyCode={null}
        className="bg-background"
      >
        <Controls className="!bg-card !border-border !shadow-md" />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="!bg-background" />
        {!isMobile && (
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
              if (node.type === "group") return "var(--muted, #6b7280)";
              return "#6b7280";
            }}
          />
        )}
      </ReactFlow>

      <NodePalette onAddNode={handlePaletteAdd} />

      <ConfigDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        node={selectedNode}
        validationErrors={selectedNode ? (validationErrors.get(selectedNode.id) ?? []) : []}
        onUpdate={(data) => {
          if (selectedNode) {
            setNodes((nds) =>
              nds.map((n) =>
                n.id === selectedNode.id ? { ...n, data: { ...n.data, ...data } } : n,
              ),
            );
          }
        }}
        onDelete={handleDeleteSelected}
      />

      {/* Context menu */}
      <CanvasContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(null)}
        onAddNode={(type, position) => {
          if (rfInstance) {
            const flowPos = rfInstance.screenToFlowPosition(position);
            createNode(type, flowPos);
          } else {
            createNode(type, position);
          }
        }}
        onPaste={handlePaste}
        onAutoLayout={handleAutoLayout}
        onSelectAll={() => setNodes((nds) => nds.map((n) => ({ ...n, selected: true })))}
        onFitView={() => fitView({ padding: 0.2 })}
        onEditNode={() => {
          if (selectedNode) setDrawerOpen(true);
        }}
        onDuplicateNode={handleDuplicate}
        onCopyNode={handleCopy}
        onDeleteNode={handleDeleteSelected}
        onGroupNodes={handleGroup}
        onDeleteEdge={() => {
          if (contextMenu?.edgeId) {
            setEdges((eds) => eds.filter((e) => e.id !== contextMenu.edgeId));
          }
        }}
        hasClipboard={clipboardRef.current !== null}
      />
    </div>
  );
}

export function PipelineCanvas(props: PipelineCanvasProps) {
  return (
    <ReactFlowProvider>
      <PipelineCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
