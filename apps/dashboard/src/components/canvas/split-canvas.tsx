"use client";

import { useState, useCallback, useRef } from "react";
import { PipelineCanvas } from "./pipeline-canvas";
import { CanvasChatPanel } from "./canvas-chat-panel";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import type { NodeSpec, EdgeSpec } from "@/types/pipeline";

interface SplitCanvasProps {
  initialNodes?: NodeSpec[];
  initialEdges?: EdgeSpec[];
}

export function SplitCanvas({ initialNodes, initialEdges }: SplitCanvasProps) {
  const [chatOpen, setChatOpen] = useState(true);
  const [nodes, setNodes] = useState<NodeSpec[]>(initialNodes ?? []);
  const [edges, setEdges] = useState<EdgeSpec[]>(initialEdges ?? []);
  // Key to force canvas remount when AI updates pipeline
  const [canvasKey, setCanvasKey] = useState(0);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);

  const handleCanvasChange = useCallback((newNodes: NodeSpec[], newEdges: EdgeSpec[]) => {
    nodesRef.current = newNodes;
    edgesRef.current = newEdges;
    setNodes(newNodes);
    setEdges(newEdges);
  }, []);

  const handleChatPipelineUpdate = useCallback(
    (newNodes: NodeSpec[], newEdges: EdgeSpec[]) => {
      setNodes(newNodes);
      setEdges(newEdges);
      nodesRef.current = newNodes;
      edgesRef.current = newEdges;
      setCanvasKey((k) => k + 1);
    },
    [],
  );

  return (
    <div className="flex h-full w-full">
      {/* Canvas area */}
      <div className="flex-1 relative">
        <PipelineCanvas
          key={canvasKey}
          initialNodes={nodes.length > 0 ? nodes : undefined}
          initialEdges={edges.length > 0 ? edges : undefined}
          onChange={handleCanvasChange}
        />
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

      {/* Chat panel (~30% width) */}
      {chatOpen && (
        <div className="w-[340px] min-w-[280px] max-w-[440px] flex-shrink-0">
          <CanvasChatPanel
            onClose={() => setChatOpen(false)}
            currentNodes={nodesRef.current}
            currentEdges={edgesRef.current}
            onPipelineUpdate={handleChatPipelineUpdate}
          />
        </div>
      )}
    </div>
  );
}
