import type { EventBus, LLMRouter, ToolExecutor } from "./types.js";
import { evaluateExpression, type ExpressionScope } from "./expression-evaluator.js";

// ---- DAG Types ----

export interface DAGNode {
  id: string;
  type:
    | "trigger"
    | "llm"
    | "tool"
    | "humanGate"
    | "condition"
    | "loop"
    | "parallel"
    | "merge"
    | "transform"
    | "output";
  data: Record<string, unknown>;
}

export interface DAGEdge {
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

export interface DAGPipeline {
  nodes: DAGNode[];
  edges: DAGEdge[];
}

export interface DAGContext {
  runId: string;
  agentId: string;
  pipeline: DAGPipeline;
  llm: LLMRouter;
  tools: ToolExecutor;
  events: EventBus;
  store: DAGRunStore;
  triggerData?: unknown;
}

export interface DAGRunStore {
  updateStatus(runId: string, status: string): Promise<void>;
  updateNodeResult(runId: string, nodeId: string, result: unknown): Promise<void>;
  getNodeResult(runId: string, nodeId: string): Promise<unknown>;
  updateResult(runId: string, result: unknown): Promise<void>;
  updateError(runId: string, error: string): Promise<void>;
}

// Node results are passed along edges
type NodeResults = Map<string, unknown>;

// ---- Main executor ----

export async function executeDAG(ctx: DAGContext): Promise<void> {
  const { pipeline, events, store } = ctx;
  const results: NodeResults = new Map();

  await events.emit("run:started", { runId: ctx.runId });
  await store.updateStatus(ctx.runId, "running");

  try {
    // Find trigger node(s) - entry points
    const triggerNodes = pipeline.nodes.filter((n) => n.type === "trigger");
    if (triggerNodes.length === 0) {
      throw new Error("Pipeline has no trigger node");
    }

    // Build adjacency list and in-degree map
    const adjacency = buildAdjacencyList(pipeline);
    const inDegree = buildInDegree(pipeline);

    // BFS execution from trigger nodes
    const queue: string[] = triggerNodes.map((n) => n.id);
    const executed = new Set<string>();
    const pending = new Map<string, number>(); // nodeId -> remaining inputs

    // Initialize trigger results
    for (const trigger of triggerNodes) {
      results.set(trigger.id, ctx.triggerData ?? {});
      executed.add(trigger.id);
      await events.emit("run:node_started", {
        runId: ctx.runId,
        nodeId: trigger.id,
        type: "trigger",
      });
      await events.emit("run:node_completed", {
        runId: ctx.runId,
        nodeId: trigger.id,
        result: ctx.triggerData,
      });
      await store.updateNodeResult(ctx.runId, trigger.id, ctx.triggerData);
    }

    // Process downstream nodes from triggers
    for (const triggerId of queue) {
      const downstream = adjacency.get(triggerId) ?? [];
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

    // Process remaining queue (skip already executed triggers)
    const toProcess = queue.filter((id) => !executed.has(id));

    for (const nodeId of toProcess) {
      const node = pipeline.nodes.find((n) => n.id === nodeId);
      if (!node || executed.has(nodeId)) continue;

      // Gather inputs from upstream nodes
      const inputs = gatherInputs(nodeId, pipeline, results);

      await events.emit("run:node_started", {
        runId: ctx.runId,
        nodeId,
        type: node.type,
      });
      await store.updateStatus(ctx.runId, `executing:${nodeId}`);

      let result: unknown;

      switch (node.type) {
        case "llm": {
          result = await executeLLMNode(node, inputs, ctx);
          break;
        }
        case "tool": {
          result = await executeToolNode(node, inputs, ctx);
          break;
        }
        case "humanGate": {
          // Pause execution - save state and return
          await store.updateStatus(ctx.runId, "awaiting_approval");
          await events.emit("run:awaiting_approval", {
            runId: ctx.runId,
            nodeId,
            inputs,
          });
          // Store partial results for resumption
          await store.updateNodeResult(ctx.runId, "__partial_results", Object.fromEntries(results));
          await store.updateNodeResult(ctx.runId, "__paused_at", nodeId);
          return; // Pipeline pauses here
        }
        case "condition": {
          result = await executeConditionNode(node, inputs, ctx, results);
          // For conditions, determine which branch to take
          const condResult = result as { value: boolean; data: unknown };
          const handle = condResult.value ? "true" : "false";
          // Only enqueue the matching branch
          const downstream = (adjacency.get(nodeId) ?? []).filter(
            (e) => !e.sourceHandle || e.sourceHandle === handle,
          );
          for (const next of downstream) {
            if (!executed.has(next.target)) {
              toProcess.push(next.target);
            }
          }
          results.set(nodeId, condResult.data);
          executed.add(nodeId);
          await events.emit("run:node_completed", {
            runId: ctx.runId,
            nodeId,
            result: condResult,
          });
          await store.updateNodeResult(ctx.runId, nodeId, condResult);
          continue; // Skip the default downstream processing
        }
        case "transform": {
          result = await executeTransformNode(node, inputs, ctx);
          break;
        }
        case "output": {
          result = inputs;
          await store.updateResult(ctx.runId, result);
          break;
        }
        case "parallel": {
          result = await executeParallelNode(node, inputs, ctx, results, pipeline);
          break;
        }
        case "merge": {
          result = executeMergeNode(node, inputs, pipeline);
          break;
        }
        case "loop": {
          result = await executeLoopNode(node, inputs, ctx, results, pipeline);
          break;
        }
        default:
          result = inputs;
      }

      results.set(nodeId, result);
      executed.add(nodeId);
      await events.emit("run:node_completed", { runId: ctx.runId, nodeId, result });
      await store.updateNodeResult(ctx.runId, nodeId, result);

      // Enqueue downstream nodes (condition handles its own branching via continue)
      const nodeType: string = node.type;
      if (nodeType !== "condition") {
        const downstream = adjacency.get(nodeId) ?? [];
        for (const next of downstream) {
          if (!executed.has(next.target) && !toProcess.includes(next.target)) {
            // Check if all inputs are ready (for merge nodes)
            const targetNode = pipeline.nodes.find((n) => n.id === next.target);
            if (targetNode?.type === "merge") {
              const inputEdges = pipeline.edges.filter((e) => e.target === next.target);
              const allReady = inputEdges.every((e) => executed.has(e.source));
              if (allReady) toProcess.push(next.target);
            } else {
              toProcess.push(next.target);
            }
          }
        }
      }
    }

    await store.updateStatus(ctx.runId, "completed");
    await events.emit("run:completed", {
      runId: ctx.runId,
      results: Object.fromEntries(results),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await store.updateError(ctx.runId, message);
    await store.updateStatus(ctx.runId, "failed");
    await events.emit("run:failed", { runId: ctx.runId, error: message });
  }
}

// ---- Resume DAG after human approval ----

export async function resumeDAG(ctx: DAGContext): Promise<void> {
  const { store, events, pipeline } = ctx;
  const pausedAt = (await store.getNodeResult(ctx.runId, "__paused_at")) as string;
  const partialResults = (await store.getNodeResult(ctx.runId, "__partial_results")) as Record<
    string,
    unknown
  >;

  if (!pausedAt || !partialResults) {
    throw new Error("Cannot resume: no paused state found");
  }

  // Rebuild results map
  const results: NodeResults = new Map(Object.entries(partialResults));

  // Mark the gate as passed
  results.set(pausedAt, { approved: true });

  await events.emit("run:approved", { runId: ctx.runId });
  await store.updateStatus(ctx.runId, "running");

  // Build graph structures
  const adjacency = buildAdjacencyList(pipeline);
  const executed = new Set(results.keys());

  // Find downstream nodes from the approved gate
  const toProcess: string[] = [];
  const downstream = adjacency.get(pausedAt) ?? [];
  for (const next of downstream) {
    if (!executed.has(next.target)) {
      toProcess.push(next.target);
    }
  }

  try {
    for (const nodeId of toProcess) {
      const node = pipeline.nodes.find((n) => n.id === nodeId);
      if (!node || executed.has(nodeId)) continue;

      const inputs = gatherInputs(nodeId, pipeline, results);

      await events.emit("run:node_started", {
        runId: ctx.runId,
        nodeId,
        type: node.type,
      });
      await store.updateStatus(ctx.runId, `executing:${nodeId}`);

      let result: unknown;

      switch (node.type) {
        case "llm":
          result = await executeLLMNode(node, inputs, ctx);
          break;
        case "tool":
          result = await executeToolNode(node, inputs, ctx);
          break;
        case "humanGate": {
          await store.updateStatus(ctx.runId, "awaiting_approval");
          await events.emit("run:awaiting_approval", {
            runId: ctx.runId,
            nodeId,
            inputs,
          });
          await store.updateNodeResult(ctx.runId, "__partial_results", Object.fromEntries(results));
          await store.updateNodeResult(ctx.runId, "__paused_at", nodeId);
          return;
        }
        case "condition": {
          result = await executeConditionNode(node, inputs, ctx, results);
          const condResult = result as { value: boolean; data: unknown };
          const handle = condResult.value ? "true" : "false";
          const condDownstream = (adjacency.get(nodeId) ?? []).filter(
            (e) => !e.sourceHandle || e.sourceHandle === handle,
          );
          for (const next of condDownstream) {
            if (!executed.has(next.target)) {
              toProcess.push(next.target);
            }
          }
          results.set(nodeId, condResult.data);
          executed.add(nodeId);
          await events.emit("run:node_completed", {
            runId: ctx.runId,
            nodeId,
            result: condResult,
          });
          await store.updateNodeResult(ctx.runId, nodeId, condResult);
          continue;
        }
        case "transform":
          result = await executeTransformNode(node, inputs, ctx);
          break;
        case "output":
          result = inputs;
          await store.updateResult(ctx.runId, result);
          break;
        case "parallel":
          result = await executeParallelNode(node, inputs, ctx, results, pipeline);
          break;
        case "merge":
          result = executeMergeNode(node, inputs, pipeline);
          break;
        case "loop":
          result = await executeLoopNode(node, inputs, ctx, results, pipeline);
          break;
        default:
          result = inputs;
      }

      results.set(nodeId, result);
      executed.add(nodeId);
      await events.emit("run:node_completed", { runId: ctx.runId, nodeId, result });
      await store.updateNodeResult(ctx.runId, nodeId, result);

      // Enqueue downstream (condition handles its own branching via continue)
      const resumeNodeType: string = node.type;
      if (resumeNodeType !== "condition") {
        const nextDownstream = adjacency.get(nodeId) ?? [];
        for (const next of nextDownstream) {
          if (!executed.has(next.target) && !toProcess.includes(next.target)) {
            const targetNode = pipeline.nodes.find((n) => n.id === next.target);
            if (targetNode?.type === "merge") {
              const inputEdges = pipeline.edges.filter((e) => e.target === next.target);
              const allReady = inputEdges.every((e) => executed.has(e.source));
              if (allReady) toProcess.push(next.target);
            } else {
              toProcess.push(next.target);
            }
          }
        }
      }
    }

    await store.updateStatus(ctx.runId, "completed");
    await events.emit("run:completed", {
      runId: ctx.runId,
      results: Object.fromEntries(results),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await store.updateError(ctx.runId, message);
    await store.updateStatus(ctx.runId, "failed");
    await events.emit("run:failed", { runId: ctx.runId, error: message });
  }
}

// ---- Helper functions ----

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

function gatherInputs(nodeId: string, pipeline: DAGPipeline, results: NodeResults): unknown {
  const inputEdges = pipeline.edges.filter((e) => e.target === nodeId);
  if (inputEdges.length === 0) return {};
  if (inputEdges.length === 1) return results.get(inputEdges[0]!.source);
  // Multiple inputs - combine into object keyed by label or source id
  const combined: Record<string, unknown> = {};
  for (const edge of inputEdges) {
    const key = edge.label ?? edge.source;
    combined[key] = results.get(edge.source);
  }
  return combined;
}

// ---- Node executors ----

async function executeLLMNode(node: DAGNode, inputs: unknown, ctx: DAGContext): Promise<unknown> {
  const data = node.data;
  const systemPrompt = (data.systemPrompt as string) ?? "";
  const temperature = (data.temperature as number) ?? 0.7;
  const maxTokens = (data.maxTokens as number) ?? 4096;

  // The LLMRouter.chat() takes a taskType string to select the route,
  // then params: { systemPrompt, messages, maxTokens, temperature }.
  // We use "execution" as the task type for DAG LLM nodes.
  const taskType = (data.taskType as string) ?? "execution";

  const messages = [
    {
      role: "user" as const,
      content: typeof inputs === "string" ? inputs : JSON.stringify(inputs),
    },
  ];

  const response = await ctx.llm.chat(taskType, {
    systemPrompt,
    messages,
    maxTokens,
    temperature,
  });

  await ctx.events.emit("run:log", {
    runId: ctx.runId,
    nodeId: node.id,
    type: "llm_response",
    content: response.content,
  });

  // Extract text content from response blocks
  const textContent = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");

  return textContent;
}

async function executeToolNode(node: DAGNode, inputs: unknown, ctx: DAGContext): Promise<unknown> {
  const toolName = (node.data.toolName as string) ?? (node.data.name as string) ?? "";

  await ctx.events.emit("run:tool_called", {
    runId: ctx.runId,
    nodeId: node.id,
    tool: toolName,
    input: inputs,
  });

  const result = await ctx.tools.execute(toolName, inputs);

  await ctx.events.emit("run:tool_result", {
    runId: ctx.runId,
    nodeId: node.id,
    tool: toolName,
    result,
  });

  return result;
}

async function executeConditionNode(
  node: DAGNode,
  inputs: unknown,
  ctx: DAGContext,
  results: NodeResults,
): Promise<{ value: boolean; data: unknown }> {
  const expression = (node.data.expression as string) ?? "true";

  const scope: ExpressionScope = {
    input: inputs,
    context: {
      triggerData: ctx.triggerData,
      results: Object.fromEntries(results),
      runId: ctx.runId,
    },
  };

  const result = evaluateExpression(expression, scope);

  if (!result.success) {
    await ctx.events.emit("run:log", {
      runId: ctx.runId,
      nodeId: node.id,
      type: "expression_error",
      error: result.error,
      expression,
    });
    // Safe default: false on error (do NOT execute the true branch)
    return { value: false, data: inputs };
  }

  return { value: !!result.value, data: inputs };
}

async function executeTransformNode(
  node: DAGNode,
  inputs: unknown,
  ctx: DAGContext,
): Promise<unknown> {
  const expression = (node.data.expression as string) ?? "";
  if (!expression) return inputs;

  // Build results map from already-executed nodes for context
  const scope = {
    input: inputs,
    context: {
      triggerData: ctx.triggerData,
      results: {} as Record<string, unknown>,
      runId: ctx.runId,
    },
  };

  try {
    return evaluateExpression(expression, scope);
  } catch (err) {
    console.warn(
      `[dag-executor] Transform expression failed for node ${node.id}: ${
        err instanceof Error ? err.message : String(err)
      }. Returning raw input.`,
    );
    return inputs;
  }
}

function executeMergeNode(node: DAGNode, inputs: unknown, pipeline: DAGPipeline): unknown {
  const strategy = (node.data.strategy as string) ?? "concat";

  switch (strategy) {
    case "object": {
      // Merge into single object using edge labels as keys.
      // gatherInputs already produces this when there are multiple edges,
      // but ensure we always return an object.
      if (typeof inputs === "object" && inputs !== null && !Array.isArray(inputs)) {
        return inputs;
      }
      // Single input - wrap with the edge label
      const inputEdges = pipeline.edges.filter((e) => e.target === node.id);
      if (inputEdges.length === 1) {
        const key = inputEdges[0]!.label ?? inputEdges[0]!.source;
        return { [key]: inputs };
      }
      return { value: inputs };
    }

    case "first": {
      // Return the first non-null input
      if (typeof inputs === "object" && inputs !== null && !Array.isArray(inputs)) {
        const values = Object.values(inputs as Record<string, unknown>);
        return values.find((v) => v != null) ?? null;
      }
      return inputs;
    }

    case "deepMerge": {
      // Deep merge all input objects
      if (typeof inputs === "object" && inputs !== null && !Array.isArray(inputs)) {
        const values = Object.values(inputs as Record<string, unknown>);
        let merged: Record<string, unknown> = {};
        for (const val of values) {
          if (typeof val === "object" && val !== null && !Array.isArray(val)) {
            merged = deepMerge(merged, val as Record<string, unknown>);
          }
        }
        return merged;
      }
      return inputs;
    }

    case "concat":
    default: {
      // Combine all inputs into a flat array
      if (typeof inputs === "object" && inputs !== null && !Array.isArray(inputs)) {
        const values = Object.values(inputs as Record<string, unknown>);
        const flat: unknown[] = [];
        for (const v of values) {
          if (Array.isArray(v)) {
            flat.push(...v);
          } else {
            flat.push(v);
          }
        }
        return flat;
      }
      return Array.isArray(inputs) ? inputs : [inputs];
    }
  }
}

/** Recursively deep-merge two plain objects. Arrays are concatenated. */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const tVal = target[key];
    const sVal = source[key];
    if (
      typeof tVal === "object" &&
      tVal !== null &&
      !Array.isArray(tVal) &&
      typeof sVal === "object" &&
      sVal !== null &&
      !Array.isArray(sVal)
    ) {
      result[key] = deepMerge(tVal as Record<string, unknown>, sVal as Record<string, unknown>);
    } else if (Array.isArray(tVal) && Array.isArray(sVal)) {
      result[key] = [...tVal, ...sVal];
    } else {
      result[key] = sVal;
    }
  }
  return result;
}

async function executeLoopNode(
  node: DAGNode,
  inputs: unknown,
  ctx: DAGContext,
  results: NodeResults,
  pipeline: DAGPipeline,
): Promise<unknown> {
  const maxIterations = (node.data.maxIterations as number) ?? 10;
  const untilCondition =
    (node.data.untilCondition as string) ?? (node.data.condition as string) ?? "false";
  const bodyNodeIds = (node.data.bodyNodeIds as string[]) ?? [];

  let current = inputs;

  for (let i = 0; i < maxIterations; i++) {
    await ctx.events.emit("run:log", {
      runId: ctx.runId,
      nodeId: node.id,
      type: "loop_iteration",
      iteration: i + 1,
      maxIterations,
    });

    // Execute body nodes in topological order
    if (bodyNodeIds.length > 0) {
      const bodyResults = await executeSubgraph(bodyNodeIds, current, ctx, results, pipeline);
      // The last body node's result becomes the new "current"
      const lastBodyNodeId = bodyNodeIds[bodyNodeIds.length - 1]!;
      current = bodyResults.get(lastBodyNodeId) ?? current;

      // Merge body results back into the main results map with iteration suffix
      for (const [nodeId, result] of bodyResults) {
        results.set(`${nodeId}__iter_${i}`, result);
      }
    }

    // Evaluate until condition using the safe expression evaluator
    const scope: ExpressionScope = {
      input: current,
      context: {
        triggerData: ctx.triggerData,
        results: Object.fromEntries(results),
        iteration: i,
        runId: ctx.runId,
      },
    };

    const condResult = evaluateExpression(untilCondition, scope);
    if (condResult.success && !!condResult.value) {
      await ctx.events.emit("run:log", {
        runId: ctx.runId,
        nodeId: node.id,
        type: "loop_condition_met",
        iteration: i + 1,
      });
      break;
    }
  }

  return current;
}

// ---- Subgraph execution helpers ----

function topologicalSortNodes(nodes: DAGNode[], edges: DAGEdge[]): string[] {
  const adjacency = new Map<string, string[]>();
  const inDeg = new Map<string, number>();

  for (const node of nodes) {
    adjacency.set(node.id, []);
    inDeg.set(node.id, 0);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDeg.set(edge.target, (inDeg.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const newDeg = (inDeg.get(next) ?? 1) - 1;
      inDeg.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  return order;
}

async function executeNodeByType(
  node: DAGNode,
  inputs: unknown,
  ctx: DAGContext,
  results: NodeResults,
  pipeline: DAGPipeline,
): Promise<unknown> {
  switch (node.type) {
    case "llm":
      return executeLLMNode(node, inputs, ctx);
    case "tool":
      return executeToolNode(node, inputs, ctx);
    case "condition": {
      const condResult = await executeConditionNode(node, inputs, ctx, results);
      return condResult;
    }
    case "transform":
      return executeTransformNode(node, inputs, ctx);
    case "merge":
      return executeMergeNode(node, inputs, pipeline);
    case "loop":
      return executeLoopNode(node, inputs, ctx, results, pipeline);
    case "parallel":
      return executeParallelNode(node, inputs, ctx, results, pipeline);
    case "output":
      return inputs;
    case "humanGate":
      // In subgraph context, auto-approve (loops/parallel cannot pause)
      return { approved: true };
    default:
      return inputs;
  }
}

async function executeSubgraph(
  nodeIds: string[],
  initialInput: unknown,
  ctx: DAGContext,
  parentResults: NodeResults,
  pipeline: DAGPipeline,
): Promise<NodeResults> {
  const subResults: NodeResults = new Map();
  const subNodes = pipeline.nodes.filter((n) => nodeIds.includes(n.id));
  const subEdges = pipeline.edges.filter(
    (e) => nodeIds.includes(e.source) && nodeIds.includes(e.target),
  );

  const order = topologicalSortNodes(subNodes, subEdges);

  for (const nodeId of order) {
    const node = subNodes.find((n) => n.id === nodeId);
    if (!node) continue;

    // Gather inputs: from subgraph results first, fall back to parent results, then initialInput
    const inputEdges = subEdges.filter((e) => e.target === nodeId);
    let nodeInput: unknown;
    if (inputEdges.length === 0) {
      nodeInput = initialInput;
    } else if (inputEdges.length === 1) {
      nodeInput =
        subResults.get(inputEdges[0]!.source) ??
        parentResults.get(inputEdges[0]!.source) ??
        initialInput;
    } else {
      const combined: Record<string, unknown> = {};
      for (const edge of inputEdges) {
        const key = edge.label ?? edge.source;
        combined[key] = subResults.get(edge.source) ?? parentResults.get(edge.source);
      }
      nodeInput = combined;
    }

    await ctx.events.emit("run:node_started", {
      runId: ctx.runId,
      nodeId,
      type: node.type,
    });

    const result = await executeNodeByType(node, nodeInput, ctx, parentResults, pipeline);
    subResults.set(nodeId, result);

    await ctx.events.emit("run:node_completed", { runId: ctx.runId, nodeId, result });
    await ctx.store.updateNodeResult(ctx.runId, nodeId, result);
  }

  return subResults;
}

// ---- Parallel execution helpers ----

/**
 * Starting from `startNodeId`, walk forward through the pipeline
 * collecting node IDs until we hit a merge node or circle back
 * to the parallel node.
 */
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
    if (!node) continue;

    // Stop at merge nodes -- they belong to the parent flow, not the branch
    if (node.type === "merge") continue;

    branchNodeIds.push(current);

    // Enqueue downstream nodes
    const downstream = pipeline.edges.filter((e) => e.source === current).map((e) => e.target);
    queue.push(...downstream);
  }

  return branchNodeIds;
}

function branchTimeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

async function executeParallelNode(
  node: DAGNode,
  inputs: unknown,
  ctx: DAGContext,
  results: NodeResults,
  pipeline: DAGPipeline,
): Promise<unknown> {
  const onBranchError = (node.data.onBranchError as string) ?? "continue";
  const branchTimeoutMs = (node.data.branchTimeoutMs as number) ?? 0;

  // Identify branches from downstream edges
  const adjacency = buildAdjacencyList(pipeline);
  const downstream = adjacency.get(node.id) ?? [];

  if (downstream.length === 0) return inputs;

  await ctx.events.emit("run:log", {
    runId: ctx.runId,
    nodeId: node.id,
    type: "parallel_start",
    branchCount: downstream.length,
  });

  // Each downstream edge is a separate branch
  const branchPromises = downstream.map(async (edge) => {
    const branchNodeIds = identifyBranch(edge.target, node.id, pipeline);
    // Deep copy input for isolation between branches
    let branchInput: unknown;
    try {
      branchInput = structuredClone(inputs);
    } catch {
      branchInput = JSON.parse(JSON.stringify(inputs));
    }

    const branchExecution = executeSubgraph(branchNodeIds, branchInput, ctx, results, pipeline);

    if (branchTimeoutMs > 0) {
      return Promise.race([
        branchExecution,
        branchTimeout(branchTimeoutMs, `Branch starting at ${edge.target} timed out`),
      ]);
    }

    return branchExecution;
  });

  let branchResults: NodeResults[];

  if (onBranchError === "fail-all") {
    branchResults = await Promise.all(branchPromises);
  } else {
    // Default: continue on error (fail-safe)
    const settled = await Promise.allSettled(branchPromises);
    branchResults = [];
    for (const settledResult of settled) {
      if (settledResult.status === "fulfilled") {
        branchResults.push(settledResult.value);
      } else {
        await ctx.events.emit("run:log", {
          runId: ctx.runId,
          nodeId: node.id,
          type: "branch_error",
          error:
            settledResult.reason instanceof Error
              ? settledResult.reason.message
              : "Unknown branch error",
        });
        branchResults.push(new Map());
      }
    }
  }

  // Merge all branch results back into the main results map
  for (const br of branchResults) {
    for (const [nodeId, brResult] of br) {
      results.set(nodeId, brResult);
    }
  }

  // Return the combined branch outputs as an array
  const branchOutputs = branchResults.map((br) => {
    const entries = [...br.entries()];
    const lastEntry = entries[entries.length - 1];
    return lastEntry ? lastEntry[1] : undefined;
  });

  return branchOutputs;
}
