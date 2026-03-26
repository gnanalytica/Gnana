import type { DAGPipeline, DAGNode } from "./dag-executor.js";
import {
  evaluateExpression,
  validateExpression,
  type ExpressionScope,
} from "./expression-evaluator.js";

// ---- Public Types ----

export interface DryRunOptions {
  pipeline: DAGPipeline;
  triggerData?: unknown;
  /** For condition nodes: default branch when no expression or expression errors. */
  defaultConditionBranch?: "true" | "false";
  /** Maximum loop iterations during dry-run (lower than real to keep preview fast). */
  maxLoopIterations?: number;
  /** Mock data overrides per node ID. */
  mockData?: Record<string, unknown>;
}

export interface DryRunNodeResult {
  nodeId: string;
  nodeType: DAGNode["type"];
  /** Order in which this node would execute (0-indexed). */
  executionOrder: number;
  /** The mock input this node would receive. */
  mockInput: unknown;
  /** The mock output this node would produce. */
  mockOutput: unknown;
  /** For condition nodes: which branch was taken. */
  branchTaken?: "true" | "false";
  /** For loop nodes: how many iterations would run. */
  iterationCount?: number;
  /** For parallel nodes: branch count. */
  branchCount?: number;
  /** Duration estimate in ms (0 for instant nodes, rough estimate for LLM/tool). */
  estimatedDurationMs: number;
  /** Estimated token usage for LLM nodes. */
  estimatedTokens?: { input: number; output: number };
  /** Warnings (e.g., expression parse error, missing config). */
  warnings: string[];
}

export interface DryRunResult {
  /** Whether the dry-run completed without fatal errors. */
  success: boolean;
  /** Ordered list of nodes that would execute. */
  executionPath: DryRunNodeResult[];
  /** Node IDs that would NOT execute (skipped branches, unreachable nodes). */
  skippedNodeIds: string[];
  /** Total estimated token usage across all LLM nodes. */
  totalEstimatedTokens: { input: number; output: number };
  /** Pipeline-level validation warnings. */
  validationWarnings: string[];
  /** Fatal error if the dry-run could not complete. */
  error?: string;
}

// ---- Internal helpers ----

function buildAdjacencyList(
  pipeline: DAGPipeline,
): Map<string, { target: string; sourceHandle?: string }[]> {
  const adj = new Map<string, { target: string; sourceHandle?: string }[]>();
  for (const edge of pipeline.edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source)!.push({
      target: edge.target,
      sourceHandle: edge.sourceHandle,
    });
  }
  return adj;
}

function buildInDegree(pipeline: DAGPipeline): Map<string, number> {
  const inDeg = new Map<string, number>();
  for (const node of pipeline.nodes) inDeg.set(node.id, 0);
  for (const edge of pipeline.edges) {
    inDeg.set(edge.target, (inDeg.get(edge.target) ?? 0) + 1);
  }
  return inDeg;
}

function gatherMockInputs(
  nodeId: string,
  pipeline: DAGPipeline,
  results: Map<string, unknown>,
): unknown {
  const inputEdges = pipeline.edges.filter((e) => e.target === nodeId);
  if (inputEdges.length === 0) return {};
  if (inputEdges.length === 1) return results.get(inputEdges[0]!.source);
  const combined: Record<string, unknown> = {};
  for (const edge of inputEdges) {
    const key = edge.label ?? edge.source;
    combined[key] = results.get(edge.source);
  }
  return combined;
}

function identifyBranch(
  startNodeId: string,
  parallelNodeId: string,
  pipeline: DAGPipeline,
): string[] {
  const branchNodeIds: string[] = [];
  const visited = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current) || current === parallelNodeId) continue;
    visited.add(current);
    const node = pipeline.nodes.find((n) => n.id === current);
    if (!node || node.type === "merge") continue;
    branchNodeIds.push(current);
    const downstream = pipeline.edges.filter((e) => e.source === current).map((e) => e.target);
    queue.push(...downstream);
  }
  return branchNodeIds;
}

function validatePipeline(pipeline: DAGPipeline): string[] {
  const warnings: string[] = [];
  const triggers = pipeline.nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) {
    warnings.push("Pipeline has no trigger node");
  }
  const outputs = pipeline.nodes.filter((n) => n.type === "output");
  if (outputs.length === 0) {
    warnings.push("Pipeline has no output node");
  }
  // Check for orphan nodes (no incoming or outgoing edges and not a trigger)
  for (const node of pipeline.nodes) {
    if (node.type === "trigger") continue;
    const hasIncoming = pipeline.edges.some((e) => e.target === node.id);
    const hasOutgoing = pipeline.edges.some((e) => e.source === node.id);
    if (!hasIncoming && !hasOutgoing) {
      warnings.push(`Node '${node.id}' (${node.type}) is disconnected from the pipeline`);
    }
  }
  // Validate expressions in condition/transform/loop nodes
  for (const node of pipeline.nodes) {
    if (node.type === "condition" || node.type === "transform") {
      const expr = (node.data.expression as string) ?? "";
      if (expr && expr !== "true" && expr !== "false" && expr !== "if ...") {
        const validation = validateExpression(expr);
        if (!validation.valid) {
          warnings.push(`Node '${node.id}' has invalid expression: ${validation.error}`);
        }
      }
    }
    if (node.type === "loop") {
      const expr = (node.data.untilCondition as string) ?? (node.data.condition as string) ?? "";
      if (expr && expr !== "false") {
        const validation = validateExpression(expr);
        if (!validation.valid) {
          warnings.push(`Node '${node.id}' has invalid loop condition: ${validation.error}`);
        }
      }
    }
  }
  return warnings;
}

// ---- Mock Node Executors ----

function mockTriggerNode(triggerData: unknown): { mockOutput: unknown; warnings: string[] } {
  return { mockOutput: triggerData ?? {}, warnings: [] };
}

function mockLLMNode(
  node: DAGNode,
  mockInput: unknown,
): {
  mockOutput: unknown;
  estimatedDurationMs: number;
  estimatedTokens: { input: number; output: number };
  warnings: string[];
} {
  const systemPrompt = (node.data.systemPrompt as string) ?? "";
  const model = (node.data.model as string) ?? "unknown";
  const maxTokens = (node.data.maxTokens as number) ?? 4096;
  const warnings: string[] = [];

  if (!systemPrompt) {
    warnings.push("LLM node has no system prompt configured");
  }

  const inputStr = JSON.stringify(mockInput);
  const estimatedInputTokens = Math.ceil(inputStr.length / 4);
  const estimatedOutputTokens = Math.ceil(maxTokens / 4);

  return {
    mockOutput: {
      response: `[Mock LLM response for: ${systemPrompt.slice(0, 80)}]`,
      model,
    },
    estimatedDurationMs: 2000, // rough estimate for LLM call
    estimatedTokens: { input: estimatedInputTokens, output: estimatedOutputTokens },
    warnings,
  };
}

function mockToolNode(
  node: DAGNode,
  mockData: Record<string, unknown> | undefined,
): { mockOutput: unknown; estimatedDurationMs: number; warnings: string[] } {
  const toolName = (node.data.toolName as string) ?? (node.data.name as string) ?? "unknown";
  const warnings: string[] = [];

  if (toolName === "unknown") {
    warnings.push("Tool node has no tool name configured");
  }

  const output = mockData?.[node.id] ?? {
    result: `[Mock tool result for: ${toolName}]`,
    tool: toolName,
  };

  return { mockOutput: output, estimatedDurationMs: 500, warnings };
}

function mockConditionNode(
  node: DAGNode,
  mockInput: unknown,
  results: Map<string, unknown>,
  triggerData: unknown,
  runId: string,
  defaultBranch: "true" | "false",
): { branchTaken: "true" | "false"; mockOutput: unknown; warnings: string[] } {
  const expression = (node.data.expression as string) ?? "";
  const warnings: string[] = [];

  if (!expression || expression === "if ...") {
    warnings.push("Condition node has no expression; using default branch");
    return { branchTaken: defaultBranch, mockOutput: mockInput, warnings };
  }

  const scope: ExpressionScope = {
    input: mockInput,
    context: {
      triggerData,
      results: Object.fromEntries(results),
      runId,
    },
  };

  const evalResult = evaluateExpression(expression, scope);

  if (!evalResult.success) {
    warnings.push(`Expression evaluation failed: ${evalResult.error}; using default branch`);
    return { branchTaken: defaultBranch, mockOutput: mockInput, warnings };
  }

  const branchTaken = evalResult.value ? "true" : "false";
  return { branchTaken, mockOutput: mockInput, warnings };
}

function mockTransformNode(
  node: DAGNode,
  mockInput: unknown,
  results: Map<string, unknown>,
  triggerData: unknown,
  runId: string,
): { mockOutput: unknown; warnings: string[] } {
  const expression = (node.data.expression as string) ?? "";
  const warnings: string[] = [];

  if (!expression || expression === "Map data") {
    return { mockOutput: mockInput, warnings };
  }

  const scope: ExpressionScope = {
    input: mockInput,
    context: {
      triggerData,
      results: Object.fromEntries(results),
      runId,
    },
  };

  const evalResult = evaluateExpression(expression, scope);

  if (!evalResult.success) {
    warnings.push(`Transform expression failed: ${evalResult.error}; passing input through`);
    return { mockOutput: mockInput, warnings };
  }

  return { mockOutput: evalResult.value, warnings };
}

function mockMergeNode(
  node: DAGNode,
  mockInput: unknown,
): { mockOutput: unknown; warnings: string[] } {
  const strategy = (node.data.strategy as string) ?? "object";

  switch (strategy) {
    case "concat": {
      if (typeof mockInput === "object" && mockInput !== null && !Array.isArray(mockInput)) {
        const values = Object.values(mockInput as Record<string, unknown>);
        return { mockOutput: values.flatMap((v) => (Array.isArray(v) ? v : [v])), warnings: [] };
      }
      return { mockOutput: Array.isArray(mockInput) ? mockInput : [mockInput], warnings: [] };
    }
    case "first": {
      if (typeof mockInput === "object" && mockInput !== null && !Array.isArray(mockInput)) {
        const values = Object.values(mockInput as Record<string, unknown>);
        return {
          mockOutput: values.find((v) => v !== undefined && v !== null) ?? null,
          warnings: [],
        };
      }
      return { mockOutput: mockInput, warnings: [] };
    }
    case "deepMerge":
    case "object":
    default:
      return { mockOutput: mockInput, warnings: [] };
  }
}

// ---- Main Dry-Run Executor ----

/**
 * Execute a dry-run simulation of the pipeline.
 * No LLM calls, no tool executions, no side effects.
 */
export function executeDryRun(options: DryRunOptions): DryRunResult {
  const {
    pipeline,
    triggerData = {},
    defaultConditionBranch = "true",
    maxLoopIterations = 2,
    mockData,
  } = options;

  const executionPath: DryRunNodeResult[] = [];
  const mockResults = new Map<string, unknown>();
  const visitedNodeIds = new Set<string>();
  const validationWarnings = validatePipeline(pipeline);
  let executionOrder = 0;

  // Use a synthetic runId for expression evaluation context
  const runId = "dry-run";

  try {
    // Find trigger nodes
    const triggerNodes = pipeline.nodes.filter((n) => n.type === "trigger");
    if (triggerNodes.length === 0) {
      return {
        success: false,
        executionPath: [],
        skippedNodeIds: pipeline.nodes.map((n) => n.id),
        totalEstimatedTokens: { input: 0, output: 0 },
        validationWarnings,
        error: "Pipeline has no trigger node",
      };
    }

    const adjacency = buildAdjacencyList(pipeline);
    const inDegree = buildInDegree(pipeline);

    // Initialize with trigger nodes
    const queue: string[] = [];
    const pending = new Map<string, number>();

    for (const trigger of triggerNodes) {
      const { mockOutput, warnings } = mockTriggerNode(triggerData);
      mockResults.set(trigger.id, mockOutput);
      visitedNodeIds.add(trigger.id);
      executionPath.push({
        nodeId: trigger.id,
        nodeType: "trigger",
        executionOrder: executionOrder++,
        mockInput: triggerData,
        mockOutput,
        estimatedDurationMs: 0,
        warnings,
      });

      // Enqueue downstream
      const downstream = adjacency.get(trigger.id) ?? [];
      for (const next of downstream) {
        if (!pending.has(next.target)) {
          pending.set(next.target, inDegree.get(next.target) ?? 1);
        }
        pending.set(next.target, (pending.get(next.target) ?? 1) - 1);
        if (pending.get(next.target) === 0) {
          queue.push(next.target);
        }
      }
    }

    // BFS through the DAG
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visitedNodeIds.has(nodeId)) continue;

      const node = pipeline.nodes.find((n) => n.id === nodeId);
      if (!node) continue;

      const mockInput = gatherMockInputs(nodeId, pipeline, mockResults);
      let mockOutput: unknown = mockInput;
      let estimatedDurationMs = 0;
      let estimatedTokens: { input: number; output: number } | undefined;
      let branchTaken: "true" | "false" | undefined;
      let iterationCount: number | undefined;
      let branchCount: number | undefined;
      const warnings: string[] = [];

      switch (node.type) {
        case "llm": {
          const llmResult = mockLLMNode(node, mockInput);
          mockOutput = llmResult.mockOutput;
          estimatedDurationMs = llmResult.estimatedDurationMs;
          estimatedTokens = llmResult.estimatedTokens;
          warnings.push(...llmResult.warnings);
          break;
        }

        case "tool": {
          const toolResult = mockToolNode(node, mockData);
          mockOutput = toolResult.mockOutput;
          estimatedDurationMs = toolResult.estimatedDurationMs;
          warnings.push(...toolResult.warnings);
          break;
        }

        case "humanGate": {
          mockOutput = { approved: true, autoApproved: true };
          break;
        }

        case "condition": {
          const condResult = mockConditionNode(
            node,
            mockInput,
            mockResults,
            triggerData,
            runId,
            defaultConditionBranch,
          );
          mockOutput = condResult.mockOutput;
          branchTaken = condResult.branchTaken;
          warnings.push(...condResult.warnings);

          // Only enqueue the taken branch
          mockResults.set(nodeId, mockOutput);
          visitedNodeIds.add(nodeId);
          executionPath.push({
            nodeId,
            nodeType: node.type,
            executionOrder: executionOrder++,
            mockInput,
            mockOutput,
            branchTaken,
            estimatedDurationMs: 0,
            warnings,
          });

          const condDownstream = (adjacency.get(nodeId) ?? []).filter(
            (e) => !e.sourceHandle || e.sourceHandle === branchTaken,
          );
          for (const next of condDownstream) {
            if (!visitedNodeIds.has(next.target)) {
              queue.push(next.target);
            }
          }
          continue; // skip default downstream processing
        }

        case "transform": {
          const transformResult = mockTransformNode(
            node,
            mockInput,
            mockResults,
            triggerData,
            runId,
          );
          mockOutput = transformResult.mockOutput;
          warnings.push(...transformResult.warnings);
          break;
        }

        case "merge": {
          const mergeResult = mockMergeNode(node, mockInput);
          mockOutput = mergeResult.mockOutput;
          warnings.push(...mergeResult.warnings);
          break;
        }

        case "loop": {
          const maxIter = Math.min(maxLoopIterations, (node.data.maxIterations as number) ?? 10);
          iterationCount = maxIter;
          mockOutput = mockInput;

          // Try evaluating untilCondition to see if it terminates early
          const untilCond =
            (node.data.untilCondition as string) ?? (node.data.condition as string) ?? "false";
          for (let i = 0; i < maxIter; i++) {
            const scope: ExpressionScope = {
              input: mockOutput,
              context: {
                triggerData,
                results: Object.fromEntries(mockResults),
                iteration: i,
                runId,
              },
            };
            const condResult = evaluateExpression(untilCond, scope);
            if (condResult.success && !!condResult.value) {
              iterationCount = i + 1;
              break;
            }
          }
          break;
        }

        case "parallel": {
          const downstream = adjacency.get(nodeId) ?? [];
          branchCount = downstream.length;

          // "Execute" each branch mockly
          for (const edge of downstream) {
            const branchNodeIds = identifyBranch(edge.target, nodeId, pipeline);
            // Mock each branch node
            for (const branchNodeId of branchNodeIds) {
              if (visitedNodeIds.has(branchNodeId)) continue;
              const branchNode = pipeline.nodes.find((n) => n.id === branchNodeId);
              if (!branchNode) continue;

              const branchInput =
                gatherMockInputs(branchNodeId, pipeline, mockResults) ?? mockInput;
              // Simple mock for branch nodes
              let branchOutput: unknown = branchInput;
              const branchWarnings: string[] = [];
              let branchEstimatedTokens: { input: number; output: number } | undefined;
              let branchDuration = 0;

              if (branchNode.type === "llm") {
                const llmRes = mockLLMNode(branchNode, branchInput);
                branchOutput = llmRes.mockOutput;
                branchEstimatedTokens = llmRes.estimatedTokens;
                branchDuration = llmRes.estimatedDurationMs;
                branchWarnings.push(...llmRes.warnings);
              } else if (branchNode.type === "tool") {
                const toolRes = mockToolNode(branchNode, mockData);
                branchOutput = toolRes.mockOutput;
                branchDuration = toolRes.estimatedDurationMs;
                branchWarnings.push(...toolRes.warnings);
              } else if (branchNode.type === "transform") {
                const trResult = mockTransformNode(
                  branchNode,
                  branchInput,
                  mockResults,
                  triggerData,
                  runId,
                );
                branchOutput = trResult.mockOutput;
                branchWarnings.push(...trResult.warnings);
              }

              mockResults.set(branchNodeId, branchOutput);
              visitedNodeIds.add(branchNodeId);
              executionPath.push({
                nodeId: branchNodeId,
                nodeType: branchNode.type,
                executionOrder: executionOrder++,
                mockInput: branchInput,
                mockOutput: branchOutput,
                estimatedDurationMs: branchDuration,
                estimatedTokens: branchEstimatedTokens,
                warnings: branchWarnings,
              });
            }
          }

          mockOutput = mockInput;
          break;
        }

        case "output": {
          mockOutput = mockInput;
          break;
        }

        default:
          mockOutput = mockInput;
      }

      mockResults.set(nodeId, mockOutput);
      visitedNodeIds.add(nodeId);
      executionPath.push({
        nodeId,
        nodeType: node.type,
        executionOrder: executionOrder++,
        mockInput,
        mockOutput,
        branchTaken,
        iterationCount,
        branchCount,
        estimatedDurationMs,
        estimatedTokens,
        warnings,
      });

      // Enqueue downstream (condition handles its own via continue above)
      const downstream = adjacency.get(nodeId) ?? [];
      for (const next of downstream) {
        if (!visitedNodeIds.has(next.target) && !queue.includes(next.target)) {
          const targetNode = pipeline.nodes.find((n) => n.id === next.target);
          if (targetNode?.type === "merge") {
            const inputEdges = pipeline.edges.filter((e) => e.target === next.target);
            const allReady = inputEdges.every((e) => visitedNodeIds.has(e.source));
            if (allReady) queue.push(next.target);
          } else {
            queue.push(next.target);
          }
        }
      }
    }

    // Compute skipped nodes
    const allNodeIds = pipeline.nodes.map((n) => n.id);
    const skippedNodeIds = allNodeIds.filter((id) => !visitedNodeIds.has(id));

    // Aggregate token estimates
    const totalEstimatedTokens = { input: 0, output: 0 };
    for (const nodeResult of executionPath) {
      if (nodeResult.estimatedTokens) {
        totalEstimatedTokens.input += nodeResult.estimatedTokens.input;
        totalEstimatedTokens.output += nodeResult.estimatedTokens.output;
      }
    }

    return {
      success: true,
      executionPath,
      skippedNodeIds,
      totalEstimatedTokens,
      validationWarnings,
    };
  } catch (error) {
    return {
      success: false,
      executionPath,
      skippedNodeIds: pipeline.nodes.map((n) => n.id).filter((id) => !visitedNodeIds.has(id)),
      totalEstimatedTokens: { input: 0, output: 0 },
      validationWarnings,
      error: error instanceof Error ? error.message : "Unknown dry-run error",
    };
  }
}
