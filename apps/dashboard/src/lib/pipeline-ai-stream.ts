import type { PipelineSpec } from "@/types/pipeline";
import { generatePipelineFromPrompt } from "./pipeline-ai";

/**
 * Streaming version of generatePipelineFromPrompt.
 * Yields response text word-by-word, then returns the final PipelineSpec.
 */
export async function* streamPipelineResponse(
  prompt: string,
): AsyncGenerator<{ type: "text"; content: string } | { type: "spec"; spec: PipelineSpec }> {
  // Generate the spec in background
  const specPromise = generatePipelineFromPrompt(prompt);

  // Simulate streaming response text while waiting
  const thinkingPhrases = [
    "Analyzing",
    "your",
    "request...",
    "Building",
    "the",
    "pipeline",
    "structure.",
    "Connecting",
    "nodes",
    "and",
    "configuring",
    "edges.",
  ];

  for (const word of thinkingPhrases) {
    yield { type: "text", content: word + " " };
    await new Promise((r) => setTimeout(r, 30));
  }

  const spec = await specPromise;

  // Stream the summary
  const summary = `Done! I've built a pipeline called "${spec.name}" with ${spec.nodes.length} nodes and ${spec.edges.length} connections.`;
  const summaryWords = summary.split(" ");

  yield { type: "text", content: "\n\n" };

  for (const word of summaryWords) {
    yield { type: "text", content: word + " " };
    await new Promise((r) => setTimeout(r, 30));
  }

  yield { type: "spec", spec };
}
