"use client";

import { useState, useCallback, useRef } from "react";
import { PipelineCanvas } from "./pipeline-canvas";
import { CanvasChatPanel } from "./canvas-chat-panel";
import { VersionHistoryPanel } from "./version-history-panel";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  MessageSquare,
  History,
  Save,
  Check,
  Loader2,
  AlertCircle,
  Play,
  X,
  Square,
} from "lucide-react";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useAutoSave } from "@/lib/canvas/use-auto-save";
import { applyDagreLayout } from "@/lib/canvas/auto-layout";
import { useLiveRun, type LiveRunLog } from "@/lib/canvas/use-live-run";
import { api } from "@/lib/api";
import type { NodeSpec, EdgeSpec } from "@/types/pipeline";
import type { Node, Edge } from "@xyflow/react";

interface SplitCanvasProps {
  initialNodes?: NodeSpec[];
  initialEdges?: EdgeSpec[];
  agentId?: string;
}

export function SplitCanvas({ initialNodes, initialEdges, agentId }: SplitCanvasProps) {
  const [chatOpen, setChatOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [nodes, setNodes] = useState<NodeSpec[]>(initialNodes ?? []);
  const [edges, setEdges] = useState<EdgeSpec[]>(initialEdges ?? []);
  const [canvasKey, setCanvasKey] = useState(0);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const isMobile = useMediaQuery("(max-width: 768px)");

  // Live run state
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [runTriggering, setRunTriggering] = useState(false);
  const liveRun = useLiveRun(activeRunId);

  const handleTriggerRun = useCallback(async () => {
    if (!agentId || runTriggering) return;
    try {
      setRunTriggering(true);
      const run = (await api.runs.trigger({ agentId })) as { id: string };
      setActiveRunId(run.id);
      setShowLogs(true);
    } catch (err) {
      console.error("Failed to trigger run:", err);
    } finally {
      setRunTriggering(false);
    }
  }, [agentId, runTriggering]);

  const handleStopRun = useCallback(() => {
    liveRun.reset();
    setActiveRunId(null);
    setShowLogs(false);
  }, [liveRun]);

  // Auto-save
  const { saveStatus, save } = useAutoSave({
    agentId,
    nodes,
    edges,
    enabled: !!agentId,
  });

  const handleCanvasChange = useCallback((newNodes: NodeSpec[], newEdges: EdgeSpec[]) => {
    nodesRef.current = newNodes;
    edgesRef.current = newEdges;
    setNodes(newNodes);
    setEdges(newEdges);
  }, []);

  const handleChatPipelineUpdate = useCallback((newNodes: NodeSpec[], newEdges: EdgeSpec[]) => {
    // Apply dagre layout to AI-generated nodes before passing them down
    const rfNodes: Node[] = newNodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    }));
    const rfEdges: Edge[] = newEdges.map((e) => ({
      id: `e-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
    }));
    const layouted = applyDagreLayout(rfNodes, rfEdges);
    const layoutedSpecs: NodeSpec[] = layouted.map((n) => ({
      id: n.id,
      type: n.type as NodeSpec["type"],
      position: n.position,
      data: n.data as Record<string, unknown>,
    }));

    setNodes(layoutedSpecs);
    setEdges(newEdges);
    nodesRef.current = layoutedSpecs;
    edgesRef.current = newEdges;
    setCanvasKey((k) => k + 1);
  }, []);

  const handleVersionRestore = useCallback((versionNodes: NodeSpec[], versionEdges: EdgeSpec[]) => {
    setNodes(versionNodes);
    setEdges(versionEdges);
    nodesRef.current = versionNodes;
    edgesRef.current = versionEdges;
    setCanvasKey((k) => k + 1);
    setHistoryOpen(false);
  }, []);

  const SaveIndicator = () => {
    if (!agentId) return null;
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {saveStatus === "saved" && (
          <>
            <Check className="h-3 w-3 text-green-500" />
            <span>Saved</span>
          </>
        )}
        {saveStatus === "saving" && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Saving...</span>
          </>
        )}
        {saveStatus === "unsaved" && <span className="text-amber-500">Unsaved</span>}
        {saveStatus === "error" && (
          <>
            <AlertCircle className="h-3 w-3 text-destructive" />
            <span className="text-destructive">Error</span>
          </>
        )}
      </div>
    );
  };

  // Build liveRun overlay for canvas
  const liveRunOverlay =
    activeRunId && liveRun.isRunning
      ? {
          executingNodeId: liveRun.executingNodeId,
          completedNodeIds: liveRun.completedNodeIds,
          failedNodeIds: liveRun.failedNodeIds,
          isRunning: liveRun.isRunning,
        }
      : null;

  // Floating log panel component
  const RunLogPanel = () => {
    if (!showLogs) return null;
    return (
      <div className="absolute bottom-4 left-4 right-4 z-10 max-h-48 bg-card border border-border rounded-lg shadow-lg flex flex-col">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">Run Logs</span>
            {liveRun.isRunning && (
              <span className="flex items-center gap-1 text-xs text-blue-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                Running
              </span>
            )}
            {!liveRun.isRunning && activeRunId && (
              <span className="text-xs text-green-500">Completed</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => setShowLogs(false)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-xs font-mono text-muted-foreground">
          {liveRun.logs.length === 0 && (
            <div className="text-muted-foreground/50">Waiting for events...</div>
          )}
          {liveRun.logs.map((log: LiveRunLog, i: number) => (
            <div key={i} className="flex gap-2">
              <span className="text-muted-foreground/50 shrink-0">
                {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "--:--:--"}
              </span>
              {log.nodeId && <span className="text-blue-400 shrink-0">[{log.nodeId}]</span>}
              <span className={log.type === "error" ? "text-red-400" : ""}>{log.message}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Mobile: tab-based layout
  if (isMobile) {
    return (
      <div className="flex flex-col h-full w-full">
        {/* Top bar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
          <SaveIndicator />
          <div className="flex items-center gap-1">
            {agentId && (
              <>
                {liveRun.isRunning ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleStopRun}
                    title="Stop run"
                  >
                    <Square className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleTriggerRun}
                    disabled={runTriggering}
                    title="Run pipeline"
                  >
                    {runTriggering ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5 text-green-500" />
                    )}
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={save}>
                  <Save className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
        <Tabs defaultValue="canvas" className="flex-1 flex flex-col">
          <TabsList className="mx-2 mt-2">
            <TabsTrigger value="canvas">Canvas</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
          </TabsList>
          <TabsContent value="canvas" className="flex-1 m-0 relative">
            <PipelineCanvas
              key={canvasKey}
              initialNodes={nodes.length > 0 ? nodes : undefined}
              initialEdges={edges.length > 0 ? edges : undefined}
              onChange={handleCanvasChange}
              liveRun={liveRunOverlay}
            />
            <RunLogPanel />
          </TabsContent>
          <TabsContent value="chat" className="flex-1 m-0">
            <CanvasChatPanel
              onClose={() => {}}
              currentNodes={nodesRef.current}
              currentEdges={edgesRef.current}
              onPipelineUpdate={handleChatPipelineUpdate}
            />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // Desktop: resizable split layout
  return (
    <div className="flex h-full w-full">
      <ResizablePanelGroup orientation="horizontal">
        {/* Canvas area */}
        <ResizablePanel defaultSize={70} minSize={40}>
          <div className="relative h-full">
            {/* Top bar with save indicator and run button */}
            {agentId && (
              <div className="absolute top-4 left-4 z-10 flex items-center gap-2 bg-card border border-border rounded-lg shadow-md px-2.5 py-1.5">
                <SaveIndicator />
                <div className="w-px h-4 bg-border" />
                {liveRun.isRunning ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleStopRun}
                    title="Stop run"
                  >
                    <Square className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleTriggerRun}
                    disabled={runTriggering}
                    title="Run pipeline"
                  >
                    {runTriggering ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5 text-green-500" />
                    )}
                  </Button>
                )}
                <div className="w-px h-4 bg-border" />
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={save}>
                  <Save className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setHistoryOpen(!historyOpen)}
                  title="Version history"
                >
                  <History className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            <PipelineCanvas
              key={canvasKey}
              initialNodes={nodes.length > 0 ? nodes : undefined}
              initialEdges={edges.length > 0 ? edges : undefined}
              onChange={handleCanvasChange}
              liveRun={liveRunOverlay}
            />
            {/* Floating log panel */}
            <RunLogPanel />
            {/* Toggle chat button when collapsed */}
            {!chatOpen && (
              <Button
                variant="outline"
                size="icon"
                className="absolute top-4 right-4 z-10"
                onClick={() => setChatOpen(true)}
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
            )}
          </div>
        </ResizablePanel>

        {/* Chat panel */}
        {chatOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={30} minSize={20}>
              <CanvasChatPanel
                onClose={() => setChatOpen(false)}
                currentNodes={nodesRef.current}
                currentEdges={edgesRef.current}
                onPipelineUpdate={handleChatPipelineUpdate}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* Version history panel */}
      {historyOpen && agentId && (
        <VersionHistoryPanel
          agentId={agentId}
          onClose={() => setHistoryOpen(false)}
          onRestore={handleVersionRestore}
        />
      )}
    </div>
  );
}
