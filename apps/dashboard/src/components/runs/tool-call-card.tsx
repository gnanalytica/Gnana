"use client";

import { useState } from "react";
import { Wrench, ChevronDown, ChevronRight, Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ToolCallData {
  id: string;
  name: string;
  status: "completed" | "failed";
  duration: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

interface ToolCallCardProps {
  toolCall: ToolCallData;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <Wrench className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium flex-1 truncate">
          {toolCall.name}
        </span>
        <Badge
          variant="secondary"
          className={cn(
            "border-0 text-xs",
            toolCall.status === "completed"
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
              : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
          )}
        >
          {toolCall.status === "completed" ? (
            <Check className="h-3 w-3 mr-1" />
          ) : (
            <X className="h-3 w-3 mr-1" />
          )}
          {toolCall.status}
        </Badge>
        <Badge variant="outline" className="text-xs tabular-nums">
          {toolCall.duration}
        </Badge>
      </button>

      {isExpanded && (
        <CardContent className="border-t border-border px-4 py-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Input
            </p>
            <pre className="font-mono text-xs bg-muted/50 rounded-md p-3 overflow-x-auto">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Output
            </p>
            <pre className="font-mono text-xs bg-muted/50 rounded-md p-3 overflow-x-auto">
              {JSON.stringify(toolCall.output, null, 2)}
            </pre>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
