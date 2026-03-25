"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2, X, Sparkles, Focus, ChevronRight } from "lucide-react";
import type { ChatMessage, NodeSpec, EdgeSpec, PipelineSpec } from "@/types/pipeline";
import { streamPipelineResponse } from "@/lib/pipeline-ai-stream";
import type { CanvasEvent } from "@/lib/canvas/use-canvas-events";
import { formatCanvasEvents } from "@/lib/canvas/use-canvas-events";

/** Extended chat message with optional metadata from pipeline chunks */
interface ExtendedChatMessage extends ChatMessage {
  suggestions?: string[];
  changes?: Array<{ action: string; nodeId?: string; description: string }>;
}

export interface CanvasChatPanelProps {
  onClose: () => void;
  currentNodes: NodeSpec[];
  currentEdges: EdgeSpec[];
  onPipelineUpdate: (nodes: NodeSpec[], edges: EdgeSpec[]) => void;
  /** Currently focused node ID from canvas selection */
  focusedNodeId?: string | null;
  /** Whether AI assistant proactive mode is enabled */
  aiAssistantMode?: boolean;
  /** Toggle AI assistant mode */
  onToggleAssistantMode?: () => void;
}

export interface CanvasChatPanelRef {
  /** Receive a canvas event and optionally auto-send a contextual message */
  onCanvasEvent: (events: CanvasEvent[]) => void;
}

export const CanvasChatPanel = forwardRef<CanvasChatPanelRef, CanvasChatPanelProps>(
  function CanvasChatPanel(
    {
      onClose,
      currentNodes,
      currentEdges,
      onPipelineUpdate,
      focusedNodeId,
      aiAssistantMode,
      onToggleAssistantMode,
    },
    ref,
  ) {
    const [messages, setMessages] = useState<ExtendedChatMessage[]>([
      {
        id: "welcome",
        role: "assistant",
        content:
          'I can help you modify your pipeline. Try things like:\n\u2022 "Add a Slack notification after the execute step"\n\u2022 "Use Claude Opus for the analysis node"\n\u2022 "Add error handling with a condition node"',
      },
    ]);
    const [input, setInput] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const historyRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);

    // Find focused node label for display
    const focusedNode = focusedNodeId
      ? currentNodes.find((n) => n.id === focusedNodeId)
      : null;
    const focusedNodeLabel = focusedNode
      ? (focusedNode.data.name as string) ||
        (focusedNode.data.label as string) ||
        (focusedNode.data.phase as string) ||
        focusedNode.type
      : null;

    useEffect(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [messages]);

    const sendMessage = useCallback(
      async (text: string) => {
        if (!text.trim() || isGenerating) return;

        setInput("");
        const userMsg: ExtendedChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          content: text,
        };
        setMessages((prev) => [...prev, userMsg]);
        historyRef.current.push({ role: "user", content: text });
        setIsGenerating(true);

        const streamMsgId = crypto.randomUUID();
        // Create assistant message immediately with empty content
        setMessages((prev) => [...prev, { id: streamMsgId, role: "assistant", content: "" }]);

        let accumulatedText = "";

        try {
          // Build current pipeline spec for context
          const pipelineSpec: PipelineSpec = {
            name: "Current Pipeline",
            description: "",
            systemPrompt: "",
            nodes: currentNodes,
            edges: currentEdges,
          };

          const stream = streamPipelineResponse(text, {
            pipeline: pipelineSpec,
            mode: currentNodes.length > 0 ? "modify" : "design",
            history: historyRef.current.slice(-10), // last 10 messages for context
            focusedNodeId: focusedNodeId ?? undefined,
          });

          for await (const chunk of stream) {
            switch (chunk.type) {
              case "text":
                accumulatedText += chunk.content;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === streamMsgId
                      ? { ...m, content: accumulatedText }
                      : m,
                  ),
                );
                break;

              case "pipeline":
                onPipelineUpdate(chunk.spec.nodes, chunk.spec.edges);
                // Update message with suggestions and changes
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === streamMsgId
                      ? {
                          ...m,
                          content: accumulatedText,
                          suggestions: chunk.suggestions,
                          changes: chunk.changes,
                          pipelineSpec: chunk.spec,
                        }
                      : m,
                  ),
                );
                break;

              case "question":
                accumulatedText += "\n\n" + chunk.content;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === streamMsgId
                      ? { ...m, content: accumulatedText }
                      : m,
                  ),
                );
                break;

              case "error":
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === streamMsgId
                      ? { ...m, content: `Error: ${chunk.message}` }
                      : m,
                  ),
                );
                break;
            }
          }

          // Store assistant response in history
          historyRef.current.push({ role: "assistant", content: accumulatedText });
        } catch {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamMsgId
                ? {
                    ...m,
                    content:
                      "Sorry, I couldn't process that request. Could you rephrase it?",
                  }
                : m,
            ),
          );
        } finally {
          setIsGenerating(false);
        }
      },
      [isGenerating, currentNodes, currentEdges, onPipelineUpdate, focusedNodeId],
    );

    const handleSend = useCallback(async () => {
      const text = input.trim();
      if (!text) return;
      await sendMessage(text);
    }, [input, sendMessage]);

    /** Handle clicking a suggestion chip */
    const handleSuggestionClick = useCallback(
      (suggestion: string) => {
        setInput(suggestion);
        // Auto-send suggestion
        sendMessage(suggestion);
      },
      [sendMessage],
    );

    /** Receive canvas events from the split-canvas (via ref) */
    useImperativeHandle(
      ref,
      () => ({
        onCanvasEvent: (events: CanvasEvent[]) => {
          if (events.length === 0) return;
          const summary = formatCanvasEvents(events);
          if (!summary) return;

          // Add as a system-like user message and request AI assistance
          const eventMsg: ExtendedChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: summary,
          };
          setMessages((prev) => [...prev, eventMsg]);

          // Auto-trigger AI response for canvas events
          sendMessage(summary + " -- Can you suggest improvements or next steps?");
        },
      }),
      [sendMessage],
    );

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
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">AI Chat</span>
            {onToggleAssistantMode && (
              <Button
                variant={aiAssistantMode ? "default" : "ghost"}
                size="icon"
                className="h-6 w-6"
                onClick={onToggleAssistantMode}
                title={
                  aiAssistantMode
                    ? "AI Assistant mode ON -- watching canvas changes"
                    : "AI Assistant mode OFF -- click to enable proactive suggestions"
                }
              >
                <Sparkles className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Node focus indicator */}
        {focusedNodeId && focusedNodeLabel && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/50">
            <Focus className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-xs text-muted-foreground">Focused on:</span>
            <Badge variant="secondary" className="text-xs">
              {focusedNodeLabel}
            </Badge>
          </div>
        )}

        {/* Messages */}
        <ScrollArea className="flex-1 px-4" ref={scrollRef}>
          <div className="space-y-3 py-4">
            {messages.map((msg) => (
              <div key={msg.id}>
                <div
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

                    {/* Changes list */}
                    {msg.changes && msg.changes.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/50">
                        <p className="text-xs font-medium mb-1 text-muted-foreground">
                          Changes:
                        </p>
                        <ul className="text-xs space-y-0.5">
                          {msg.changes.map((change, i) => (
                            <li key={i} className="flex items-start gap-1">
                              <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                              <span>{change.description}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Suggestion chips */}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 ml-1">
                    {msg.suggestions.map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => handleSuggestionClick(suggestion)}
                        disabled={isGenerating}
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {isGenerating && messages[messages.length - 1]?.content === "" && (
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
              placeholder={
                focusedNodeId
                  ? `Ask about ${focusedNodeLabel ?? "this node"}...`
                  : "Describe changes..."
              }
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
  },
);
