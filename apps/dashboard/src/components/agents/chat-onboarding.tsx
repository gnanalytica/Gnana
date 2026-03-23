"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hexagon, Send, Loader2 } from "lucide-react";
import { TemplateGrid } from "./template-grid";
import { PipelineSummaryCard } from "./pipeline-summary-card";
import type { PipelineSpec, ChatMessage } from "@/types/pipeline";
import { generatePipelineFromPrompt } from "@/lib/pipeline-ai";

interface ChatOnboardingProps {
  onOpenCanvas: (spec: PipelineSpec) => void;
}

export function ChatOnboarding({ onOpenCanvas }: ChatOnboardingProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showTemplates, setShowTemplates] = useState(true);
  const [generatedSpec, setGeneratedSpec] = useState<PipelineSpec | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsGenerating(true);

      try {
        const spec = await generatePipelineFromPrompt(message);
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `I've built a pipeline called **${spec.name}** with ${spec.nodes.length} nodes. Here's a summary:`,
          pipelineSpec: spec,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setGeneratedSpec(spec);
      } catch {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "I couldn't generate a pipeline from that description. Could you provide more details about what you want the agent to do?",
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsGenerating(false);
      }
    },
    [input, isGenerating],
  );

  const handleTemplateSelect = (prompt: string) => {
    if (prompt) {
      handleSend(prompt);
    } else {
      setShowTemplates(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto px-4">
      {/* Header — only when no messages */}
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
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
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
            ))}
            {isGenerating && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-2 text-sm flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Building your pipeline...
                </div>
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
              : "Describe changes to your pipeline..."
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
