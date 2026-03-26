"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Hexagon, Send, Loader2, RotateCcw, AlertCircle } from "lucide-react";
import { TemplateGrid } from "./template-grid";
import { PipelineSummaryCard } from "./pipeline-summary-card";
import type { PipelineSpec, ChatMessage } from "@/types/pipeline";
import { streamPipelineResponse } from "@/lib/pipeline-ai-stream";

/** Find the last index matching a predicate (ES2023-safe polyfill). */
function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    const item = arr[i];
    if (item !== undefined && predicate(item)) return i;
  }
  return -1;
}

interface ChatOnboardingProps {
  onOpenCanvas: (spec: PipelineSpec) => void;
}

export function ChatOnboarding({ onOpenCanvas }: ChatOnboardingProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showTemplates, setShowTemplates] = useState(true);
  const [generatedSpec, setGeneratedSpec] = useState<PipelineSpec | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<Pick<ChatMessage, "role" | "content">[]>([]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(
    async (text?: string) => {
      const message = text ?? input.trim();
      if (!message || isGenerating) return;

      setShowTemplates(false);
      setInput("");
      setSuggestions([]);

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
      };
      setMessages((prev) => [...prev, userMsg]);

      // Add to conversation history for the API
      historyRef.current = [...historyRef.current, { role: "user", content: message }];

      setIsGenerating(true);

      const streamMsgId = crypto.randomUUID();
      // Create assistant message immediately with empty content
      setMessages((prev) => [...prev, { id: streamMsgId, role: "assistant", content: "" }]);

      // Determine if we should force pipeline generation
      const shouldForce = questionCount >= 3;

      try {
        const stream = streamPipelineResponse(message, {
          mode: "design",
          history: historyRef.current,
          forceGenerate: shouldForce,
        });

        let accumulatedText = "";
        let spec: PipelineSpec | null = null;
        let responseSuggestions: string[] = [];
        let hasError = false;

        for await (const chunk of stream) {
          switch (chunk.type) {
            case "thinking":
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamMsgId
                    ? { ...m, thinking: (m.thinking ?? "") + chunk.content }
                    : m,
                ),
              );
              break;

            case "thinking_complete":
              // Thinking is already accumulated via "thinking" chunks
              break;

            case "text":
              accumulatedText += chunk.content;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamMsgId ? { ...m, content: m.content + chunk.content } : m,
                ),
              );
              break;

            case "question":
              accumulatedText += chunk.content;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamMsgId ? { ...m, content: m.content + chunk.content } : m,
                ),
              );
              setQuestionCount((prev) => prev + 1);
              break;

            case "pipeline":
              spec = chunk.spec;
              responseSuggestions = chunk.suggestions ?? [];

              setGeneratedSpec(spec);
              setMessages((prev) =>
                prev.map((m) => (m.id === streamMsgId ? { ...m, pipelineSpec: spec! } : m)),
              );
              setSuggestions(responseSuggestions);
              break;

            case "error":
              hasError = true;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamMsgId
                    ? {
                        ...m,
                        content: chunk.message,
                      }
                    : m,
                ),
              );
              accumulatedText = chunk.message;
              break;
          }
        }

        // Add the full assistant response to history
        if (accumulatedText) {
          historyRef.current = [
            ...historyRef.current,
            { role: "assistant", content: accumulatedText },
          ];
        }

        // Mark error messages for rendering
        if (hasError) {
          setMessages((prev) =>
            prev.map((m) => (m.id === streamMsgId ? { ...m, id: `error-${streamMsgId}` } : m)),
          );
        }
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamMsgId
              ? {
                  ...m,
                  id: `error-${streamMsgId}`,
                  content: "Something went wrong while generating your pipeline. Please try again.",
                }
              : m,
          ),
        );
        historyRef.current = [
          ...historyRef.current,
          {
            role: "assistant",
            content: "Something went wrong while generating your pipeline. Please try again.",
          },
        ];
      } finally {
        setIsGenerating(false);
      }
    },
    [input, isGenerating, questionCount],
  );

  const handleRetry = useCallback(() => {
    // Resend the last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      // Remove the error message from state
      setMessages((prev) => {
        const idx = findLastIndex(prev, (m) => m.id.startsWith("error-"));
        if (idx >= 0) return prev.slice(0, idx);
        return prev;
      });
      // Remove last assistant entry from history
      const lastAssistantIdx = findLastIndex(historyRef.current, (m) => m.role === "assistant");
      if (lastAssistantIdx >= 0) {
        historyRef.current = historyRef.current.slice(0, lastAssistantIdx);
      }
      // Also remove last user from history since handleSend will re-add it
      const lastUserIdx = findLastIndex(historyRef.current, (m) => m.role === "user");
      if (lastUserIdx >= 0) {
        historyRef.current = historyRef.current.slice(0, lastUserIdx);
      }
      handleSend(lastUserMsg.content);
    }
  }, [messages, handleSend]);

  const handleTemplateSelect = (prompt: string) => {
    if (prompt) {
      handleSend(prompt);
    } else {
      setShowTemplates(false);
      textareaRef.current?.focus();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    handleSend(suggestion);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const progressLabel =
    questionCount >= 2 && !generatedSpec && isGenerating ? "Almost ready..." : null;

  return (
    <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto px-4">
      {/* Header -- only when no messages */}
      {messages.length === 0 && (
        <div className="flex flex-col items-center gap-4 mb-8">
          <Hexagon className="h-12 w-12 text-primary" />
          <h1 className="text-2xl font-bold">Build Your Agent</h1>
          <p className="text-muted-foreground text-center max-w-md">
            Describe what you want your agent to do and I&apos;ll build it for you.
          </p>
        </div>
      )}

      {/* Template grid */}
      {showTemplates && messages.length === 0 && (
        <div className="mb-8 flex flex-col items-center gap-3">
          <span className="text-sm text-muted-foreground">Start from a template...</span>
          <TemplateGrid onSelect={handleTemplateSelect} />
        </div>
      )}

      {/* Messages */}
      {messages.length > 0 && (
        <ScrollArea className="flex-1 w-full mb-4" ref={scrollRef}>
          <div className="space-y-4 py-4">
            {messages.map((msg) => {
              const isError = msg.id.startsWith("error-");

              return (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : isError
                          ? "bg-destructive/10 text-destructive border border-destructive/20"
                          : "bg-muted text-foreground"
                    }`}
                  >
                    {isError && (
                      <div className="flex items-center gap-2 mb-1">
                        <AlertCircle className="h-4 w-4" />
                        <span className="font-medium text-xs">Error</span>
                      </div>
                    )}
                    {msg.thinking && (
                      <details className="mb-2 text-xs">
                        <summary className="cursor-pointer text-muted-foreground/70 hover:text-muted-foreground select-none flex items-center gap-1">
                          <span className="text-[10px]">💭</span> Thinking...
                        </summary>
                        <div className="mt-1 pl-4 border-l-2 border-muted-foreground/20 text-muted-foreground/60 whitespace-pre-wrap">
                          {msg.thinking}
                        </div>
                      </details>
                    )}
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {isError && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 gap-1.5 text-xs"
                        onClick={handleRetry}
                        disabled={isGenerating}
                      >
                        <RotateCcw className="h-3 w-3" />
                        Retry
                      </Button>
                    )}
                    {msg.pipelineSpec && generatedSpec && (
                      <div className="mt-3">
                        <PipelineSummaryCard
                          spec={msg.pipelineSpec}
                          onOpenCanvas={() => onOpenCanvas(msg.pipelineSpec!)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Loading indicator */}
            {isGenerating && messages[messages.length - 1]?.content === "" && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-2 text-sm flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {progressLabel ?? "Building your pipeline..."}
                </div>
              </div>
            )}

            {/* Progress indicator when questions are accumulating */}
            {progressLabel && isGenerating && messages[messages.length - 1]?.content !== "" && (
              <div className="flex justify-center">
                <span className="text-xs text-muted-foreground animate-pulse">{progressLabel}</span>
              </div>
            )}

            {/* Suggestion chips */}
            {suggestions.length > 0 && !isGenerating && (
              <div className="flex flex-wrap gap-2 pt-2">
                {suggestions.map((suggestion) => (
                  <Badge
                    key={suggestion}
                    variant="outline"
                    className="cursor-pointer hover:bg-primary/10 transition-colors px-3 py-1.5 text-xs"
                    onClick={() => handleSuggestionClick(suggestion)}
                  >
                    {suggestion}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      )}

      {/* Input */}
      <div className="w-full relative">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            messages.length === 0
              ? '"Monitor GitHub PRs for my repo and post summaries to Slack..."'
              : generatedSpec
                ? "Describe changes to your pipeline..."
                : "Tell me more about what you need..."
          }
          className="min-h-[56px] max-h-[160px] pr-12 resize-none"
          rows={2}
        />
        <Button
          size="icon"
          className="absolute right-2 bottom-2"
          onClick={() => handleSend()}
          disabled={!input.trim() || isGenerating}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
