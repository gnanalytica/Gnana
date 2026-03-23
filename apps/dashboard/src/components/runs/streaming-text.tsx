"use client";

import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface StreamingTextProps {
  text: string;
  isStreaming?: boolean;
  className?: string;
}

export function StreamingText({ text, isStreaming, className }: StreamingTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "font-mono text-sm bg-muted/50 rounded-md p-4 max-h-[400px] overflow-y-auto whitespace-pre-wrap",
        className,
      )}
    >
      {text}
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-primary ml-0.5 animate-pulse" />
      )}
    </div>
  );
}
