import type { PipelineSpec } from "@/types/pipeline";

export type StreamChunk =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "thinking_complete"; content: string }
  | { type: "question"; content: string }
  | {
      type: "pipeline";
      spec: PipelineSpec;
      message: string;
      suggestions?: string[];
      changes?: Array<{ action: string; nodeId?: string; description: string }>;
    }
  | { type: "error"; message: string };

export async function* streamPipelineResponse(
  message: string,
  options?: {
    pipeline?: PipelineSpec;
    mode?: "design" | "modify";
    history?: Array<{ role: string; content: string }>;
    focusedNodeId?: string;
    forceGenerate?: boolean;
  },
): AsyncGenerator<StreamChunk> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      pipeline: options?.pipeline,
      mode: options?.mode ?? "design",
      history: options?.history,
      focusedNodeId: options?.focusedNodeId,
      forceGenerate: options?.forceGenerate,
    }),
  });

  if (!response.ok) {
    yield { type: "error", message: `Server error: ${response.status}` };
    return;
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(trimmed.slice(6));
        if (data.type === "done") return;
        yield data as StreamChunk;
      } catch {
        // Skip malformed SSE lines
      }
    }
  }
}
