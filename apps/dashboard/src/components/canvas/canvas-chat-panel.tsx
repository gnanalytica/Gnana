"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2, X } from "lucide-react";
import type { ChatMessage, NodeSpec, EdgeSpec } from "@/types/pipeline";
import { generatePipelineFromPrompt } from "@/lib/pipeline-ai";

interface CanvasChatPanelProps {
  onClose: () => void;
  currentNodes: NodeSpec[];
  currentEdges: EdgeSpec[];
  onPipelineUpdate: (nodes: NodeSpec[], edges: EdgeSpec[]) => void;
}

export function CanvasChatPanel({
  onClose,
  currentNodes,
  currentEdges,
  onPipelineUpdate,
}: CanvasChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "I can help you modify your pipeline. Try things like:\n• \"Add a Slack notification after the execute step\"\n• \"Use Claude Opus for the analysis node\"\n• \"Add error handling with a condition node\"",
    },
  ]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isGenerating) return;

    setInput("");
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsGenerating(true);

    try {
      // Generate a new pipeline from the combined context
      const contextDescription = `Current pipeline has ${currentNodes.length} nodes and ${currentEdges.length} edges. User request: ${text}`;
      const spec = await generatePipelineFromPrompt(contextDescription);

      onPipelineUpdate(spec.nodes, spec.edges);

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Done! I've updated the pipeline. It now has ${spec.nodes.length} nodes and ${spec.edges.length} connections.`,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Sorry, I couldn't process that request. Could you rephrase it?",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsGenerating(false);
    }
  }, [input, isGenerating, currentNodes, currentEdges, onPipelineUpdate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold">AI Chat</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4" ref={scrollRef}>
        <div className="space-y-3 py-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}
          {isGenerating && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Thinking...
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe changes..."
            className="min-h-[44px] max-h-[100px] pr-10 resize-none text-sm"
            rows={1}
          />
          <Button
            size="icon"
            className="absolute right-1.5 bottom-1.5 h-7 w-7"
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
          >
            <Send className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
