# Advanced DAG Nodes & Dry-Run Preview -- Design Spec

**Date**: 2026-03-25
**Status**: Proposed
**Scope**: `@gnana/core` (expression evaluator, DAG executor enhancements, dry-run engine), `@gnana/server` (dry-run endpoint), `apps/dashboard` (preview UI)

---

## Problem

The DAG executor (`packages/core/src/dag-executor.ts`) supports all 10 node types but several have placeholder logic:

- **Condition node** uses `new Function()` with `with(data)` -- a security risk that also only does a simple truthiness check.
- **Loop node** evaluates `untilCondition` via `new Function()` but does not actually execute the loop body (downstream nodes); it just increments iteration metadata.
- **Parallel node** processes branches sequentially, one by one -- there is no concurrency.
- **Transform node** evaluates expressions via `new Function()` -- another security risk that returns raw strings for non-trivial expressions.
- **Merge node** collects inputs into an object keyed by edge label/source but offers no configurable merge strategies.

All nodes using `new Function()` or `eval()` are vulnerable to arbitrary code execution. Users can access `process`, `require`, `globalThis`, and any Node.js API through crafted expressions.

Additionally, there is no way to preview a pipeline execution without actually calling LLMs, tools, and external services. The existing `useExecutionPreview` hook in the dashboard does a client-side topological walk for animation purposes, but it does not simulate real branching, condition evaluation, or data flow.

---

## Goals

1. Replace all `new Function()` / `eval()` usage with a safe, sandboxed expression evaluator.
2. Upgrade condition, loop, parallel, transform, and merge nodes to production-quality logic.
3. Add a server-side dry-run mode that simulates execution with mock data -- same routing and branching as a real run, but no side effects.
4. Expose the dry-run in the dashboard with a "Preview" button alongside the existing "Run" button.

## Non-Goals

- Full scripting language (loops, function definitions, imports). The expression evaluator is intentionally limited.
- Real-time collaborative dry-run (multi-user preview). Single-user only for now.
- Cost estimation for LLM calls (requires provider-specific token counting; deferred to a later spec).

---

## 1. Expression Evaluator

### File: `packages/core/src/expression-evaluator.ts` (new)

A safe, zero-dependency expression evaluator. No `eval()`, no `new Function()`, no access to `globalThis`, `process`, `require`, or any Node.js API.

### Supported Syntax

| Category        | Operators / Features                                                | Examples                                                           |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ | ------ | ------------------------------------- |
| Field access    | `.` dot notation, `[]` bracket notation                             | `input.name`, `input["field-name"]`, `context.results.node1.score` |
| Comparison      | `==`, `!=`, `>`, `<`, `>=`, `<=`                                    | `input.score > 0.8`                                                |
| Logical         | `&&`, `                                                             |                                                                    | `, `!` | `input.approved && input.score > 0.5` |
| Arithmetic      | `+`, `-`, `*`, `/`, `%`                                             | `input.price * input.quantity`                                     |
| String ops      | `contains()`, `startsWith()`, `endsWith()`, `substring()`, `length` | `input.email.contains("@gmail")`                                   |
| Ternary         | `? :`                                                               | `input.score > 0.8 ? "high" : "low"`                               |
| Object literals | `{ key: value }`                                                    | `{ summary: input.text.substring(0, 100) }`                        |
| Array literals  | `[a, b, c]`                                                         | `[input.name, input.email]`                                        |
| Null coalescing | `??`                                                                | `input.nickname ?? input.name`                                     |
| Typeof          | `typeof`                                                            | `typeof input.data == "string"`                                    |

### Operator Precedence (highest to lowest)

1. `()` grouping, `.` `/` `[]` member access
2. `!`, unary `-`, `typeof`
3. `*`, `/`, `%`
4. `+`, `-`
5. `>`, `<`, `>=`, `<=`
6. `==`, `!=`
7. `&&`
8. `||`
9. `??`
10. `? :` ternary

### Variables

Two root variables are injected into every evaluation scope:

- **`input`** -- The node's input data (output of upstream node(s)). For merge nodes, this is the combined input object.
- **`context`** -- Run context object with:
  - `context.triggerData` -- Original trigger payload
  - `context.results` -- Map of `nodeId -> result` for all previously executed nodes
  - `context.iteration` -- Current loop iteration (only inside loop bodies, 0-indexed)
  - `context.runId` -- The current run ID

### TypeScript Interface

```typescript
// packages/core/src/expression-evaluator.ts

export interface ExpressionScope {
  input: unknown;
  context: ExpressionContext;
}

export interface ExpressionContext {
  triggerData?: unknown;
  results: Record<string, unknown>;
  iteration?: number;
  runId: string;
}

export interface ExpressionResult {
  success: boolean;
  value: unknown;
  error?: string;
}

/**
 * Parse and evaluate an expression string against the given scope.
 * Throws nothing -- always returns an ExpressionResult.
 */
export function evaluate(expression: string, scope: ExpressionScope): ExpressionResult;

/**
 * Validate an expression string without executing it.
 * Returns parse errors if the expression is malformed.
 */
export function validateExpression(expression: string): {
  valid: boolean;
  error?: string;
};
```

### Implementation Approach

Build a small recursive-descent parser that produces an AST, then a tree-walking evaluator:

**Lexer** -- Tokenize the expression string into tokens: identifiers, numbers, strings (single/double-quoted), operators, punctuation. Skip whitespace. Reject any token that looks like a function call unless it is in the allowlist (`contains`, `startsWith`, `endsWith`, `substring`, `toString`, `length`).

**Parser** -- Recursive descent following the operator precedence table above. Produces an AST with node types:

```typescript
type ASTNode =
  | { type: "literal"; value: string | number | boolean | null }
  | { type: "identifier"; name: string }
  | { type: "member"; object: ASTNode; property: ASTNode; computed: boolean }
  | { type: "unary"; operator: "!" | "-" | "typeof"; operand: ASTNode }
  | { type: "binary"; operator: string; left: ASTNode; right: ASTNode }
  | { type: "ternary"; test: ASTNode; consequent: ASTNode; alternate: ASTNode }
  | { type: "call"; callee: ASTNode; args: ASTNode[] }
  | { type: "object"; properties: { key: string; value: ASTNode }[] }
  | { type: "array"; elements: ASTNode[] };
```

**Evaluator** -- Tree-walk the AST. Variable resolution: `input` and `context` resolve to their scope values. Any other root identifier is an error. Method calls are only allowed on the allowlist -- the evaluator checks the method name against a hardcoded set and dispatches to the corresponding JS string/array method. No prototype chain walking. No constructor access. No `__proto__`.

**Security constraints**:

- Maximum expression length: 2048 characters.
- Maximum AST depth: 32 levels.
- Maximum evaluation steps: 10,000 (prevents infinite-ish expressions).
- Blocked identifiers: `constructor`, `__proto__`, `prototype`, `globalThis`, `window`, `global`, `process`, `require`, `import`, `eval`, `Function`.
- Method allowlist: `contains` (alias for `includes`), `startsWith`, `endsWith`, `substring`, `toString`, `toLowerCase`, `toUpperCase`, `trim`, `split`, `join`, `length`, `indexOf`, `slice`, `map`, `filter`, `includes`, `keys`, `values`, `entries`.

### Example Evaluations

```typescript
// Condition: check sentiment
evaluate('input.sentiment == "negative"', {
  input: { sentiment: "negative", text: "I hate this" },
  context: { results: {}, runId: "run-1" },
});
// => { success: true, value: true }

// Loop until: check approval
evaluate("input.approved == true", {
  input: { approved: false },
  context: { results: {}, iteration: 2, runId: "run-1" },
});
// => { success: true, value: false }

// Transform: reshape data
evaluate("{ summary: input.text.substring(0, 100), score: input.confidence * 100 }", {
  input: { text: "Long text here...", confidence: 0.85 },
  context: { results: {}, runId: "run-1" },
});
// => { success: true, value: { summary: "Long text here...", score: 85 } }

// Error handling
evaluate("input.nonexistent.deep.access", {
  input: { name: "test" },
  context: { results: {}, runId: "run-1" },
});
// => { success: false, value: undefined, error: "Cannot read property 'deep' of undefined" }
```

### Testing

Create `packages/core/src/__tests__/expression-evaluator.test.ts`:

- Arithmetic: `1 + 2 * 3` => 7, `(1 + 2) * 3` => 9
- Comparison: `input.x > 5`, `input.name == "alice"`
- Logical: `input.a && input.b`, `!input.done`
- String methods: `input.email.contains("@")`, `input.name.startsWith("Dr")`
- Object literals: `{ x: input.a + 1 }` => `{ x: <computed> }`
- Ternary: `input.score > 0.5 ? "pass" : "fail"`
- Null coalescing: `input.nickname ?? "Anonymous"`
- Security: expressions containing `process`, `require`, `constructor`, `__proto__` must fail
- Depth limit: deeply nested expression beyond 32 levels must fail
- Length limit: expression > 2048 chars must fail

---

## 2. Condition Node Enhancement

### Current Behavior (dag-executor.ts lines 491-507)

```typescript
// CURRENT -- uses new Function() with with() -- UNSAFE
const fn = new Function("data", `with(data) { return !!(${expression}); }`);
const value = fn(inputData) as boolean;
```

Defaults to `true` on error.

### New Behavior

Replace with the expression evaluator. Evaluate against `input` (the node's upstream data) and `context` (run-level context including previous node results).

```typescript
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

  const result = evaluate(expression, scope);

  if (!result.success) {
    // Log warning but treat as false (safe default -- do not execute the "true" branch on error)
    await ctx.events.emit("run:log", {
      runId: ctx.runId,
      nodeId: node.id,
      type: "expression_error",
      error: result.error,
      expression,
    });
    return { value: false, data: inputs };
  }

  return { value: !!result.value, data: inputs };
}
```

### Branching Logic (unchanged)

The existing branching logic in `executeDAG` is correct -- it filters downstream edges by `sourceHandle === "true"` or `sourceHandle === "false"`. No changes needed to the branching dispatch.

### Error Behavior Change

**Before**: expression error defaults to `true` (executes the true branch on failure).
**After**: expression error defaults to `false` (does NOT execute the true branch on failure). This is the safer default -- if the expression is broken, do not proceed with the affirmative branch. A warning event is emitted so the user can diagnose.

---

## 3. Loop Node Enhancement

### Current Behavior (dag-executor.ts lines 521-551)

The loop node checks its exit condition via `new Function()` and increments `__iteration` metadata, but it never actually executes the downstream "body" nodes. It just passes through the input with an iteration counter.

### New Behavior

The loop node must:

1. Identify its loop body -- the subgraph between the loop node and its corresponding merge point.
2. Execute the body nodes on each iteration.
3. Evaluate the `untilCondition` after each iteration using the expression evaluator.
4. Stop when `untilCondition` evaluates to true OR `maxIterations` is reached.

### Loop Body Identification

A loop node's body is defined by convention: the loop node connects to body nodes via edges, and the body terminates at a merge node (or at the first node that is also reachable from the loop's "done" handle). The loop node has two output handles:

- `"body"` -- edges to the first node(s) of the loop body
- `"done"` -- edge to the node that executes after the loop completes

The merge point of the loop body is identified as: the node(s) connected back to the loop node via edges with `sourceHandle === "loopback"`, OR the last nodes in the body subgraph (nodes whose only downstream edge targets the loop's "done" target or the loop node itself).

For the initial implementation, use a simpler approach: the loop node's `data.bodyNodeIds` explicitly lists the node IDs that form the loop body (set by the canvas builder when the user drags nodes inside a loop group). If `bodyNodeIds` is not set, fall back to: all nodes reachable from the loop's `"body"` handle edges, stopping before any node that has the same or lower topological rank as the loop node itself.

### Implementation

```typescript
async function executeLoopNode(
  node: DAGNode,
  inputs: unknown,
  ctx: DAGContext,
  results: NodeResults,
  pipeline: DAGPipeline,
): Promise<unknown> {
  const maxIterations = (node.data.maxIterations as number) ?? 10;
  const untilCondition = (node.data.untilCondition as string) ?? "false";
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

      // Merge body results back into the main results map
      for (const [nodeId, result] of bodyResults) {
        results.set(`${nodeId}__iter_${i}`, result);
      }
    }

    // Evaluate until condition
    const scope: ExpressionScope = {
      input: current,
      context: {
        triggerData: ctx.triggerData,
        results: Object.fromEntries(results),
        iteration: i,
        runId: ctx.runId,
      },
    };

    const condResult = evaluate(untilCondition, scope);
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
```

### Subgraph Execution Helper

This helper is also used by the parallel node. It executes a subset of pipeline nodes in topological order, isolated from the main execution flow:

```typescript
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

  // Topological sort within the subgraph
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

    // Execute the node (reuse existing node executor switch)
    const result = await executeNodeByType(node, nodeInput, ctx, parentResults, pipeline);
    subResults.set(nodeId, result);

    await ctx.events.emit("run:node_completed", { runId: ctx.runId, nodeId, result });
    await ctx.store.updateNodeResult(ctx.runId, nodeId, result);
  }

  return subResults;
}
```

### Data Model Changes

Add to `DAGNode.data` (loop type):

| Field            | Type       | Default   | Description                                                     |
| ---------------- | ---------- | --------- | --------------------------------------------------------------- |
| `maxIterations`  | `number`   | `10`      | Hard cap on iteration count                                     |
| `untilCondition` | `string`   | `"false"` | Expression evaluated after each iteration; loop stops when true |
| `bodyNodeIds`    | `string[]` | `[]`      | Explicit list of node IDs forming the loop body                 |

---

## 4. Parallel Node Enhancement

### Current Behavior (dag-executor.ts lines 185-189)

```typescript
case "parallel": {
  // Enqueue all downstream branches concurrently
  result = inputs;
  break;
}
```

The "parallel" node just passes inputs through, and downstream nodes are enqueued sequentially by the main BFS loop.

### New Behavior

True concurrent execution using `Promise.all()`. Each downstream branch gets its own copy of input data. The parallel node identifies its branches, spawns them simultaneously, and stores all branch results for the downstream merge node.

### Branch Identification

Each edge from the parallel node represents a separate branch. The branch consists of all nodes reachable from that edge's target until reaching a merge node (or a node with in-degree > 1 from outside the branch).

For the initial implementation, use explicit `data.branches` configuration:

```typescript
interface ParallelNodeData {
  /** Error handling strategy */
  onBranchError: "fail-all" | "continue-others";
  /** Per-branch timeout in milliseconds. 0 = no timeout. */
  branchTimeoutMs: number;
  /** Explicit branch definitions (optional; if absent, infer from edges) */
  branches?: {
    id: string;
    label: string;
    nodeIds: string[];
  }[];
}
```

### Implementation

```typescript
async function executeParallelNode(
  node: DAGNode,
  inputs: unknown,
  ctx: DAGContext,
  results: NodeResults,
  pipeline: DAGPipeline,
): Promise<unknown> {
  const onBranchError = (node.data.onBranchError as string) ?? "fail-all";
  const branchTimeoutMs = (node.data.branchTimeoutMs as number) ?? 0;

  // Identify branches from downstream edges
  const adjacency = buildAdjacencyList(pipeline);
  const downstream = adjacency.get(node.id) ?? [];

  if (downstream.length === 0) return inputs;

  // Each downstream edge is a separate branch
  const branchPromises = downstream.map(async (edge) => {
    const branchNodeIds = identifyBranch(edge.target, node.id, pipeline);
    const branchInput = structuredClone(inputs); // Deep copy for isolation

    const branchExecution = executeSubgraph(branchNodeIds, branchInput, ctx, results, pipeline);

    if (branchTimeoutMs > 0) {
      return Promise.race([
        branchExecution,
        timeout(branchTimeoutMs, `Branch starting at ${edge.target} timed out`),
      ]);
    }

    return branchExecution;
  });

  let branchResults: NodeResults[];

  if (onBranchError === "fail-all") {
    // All branches must succeed
    branchResults = await Promise.all(branchPromises);
  } else {
    // Continue others on failure
    const settled = await Promise.allSettled(branchPromises);
    branchResults = [];
    for (const result of settled) {
      if (result.status === "fulfilled") {
        branchResults.push(result.value);
      } else {
        await ctx.events.emit("run:log", {
          runId: ctx.runId,
          nodeId: node.id,
          type: "branch_error",
          error: result.reason?.message ?? "Unknown branch error",
        });
        // Push empty results for failed branch
        branchResults.push(new Map());
      }
    }
  }

  // Merge all branch results back into the main results map
  for (const br of branchResults) {
    for (const [nodeId, result] of br) {
      results.set(nodeId, result);
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

function timeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}
```

### Branch Identification Helper

```typescript
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
```

### Data Model Changes

Add to `DAGNode.data` (parallel type):

| Field             | Type                              | Default      | Description                        |
| ----------------- | --------------------------------- | ------------ | ---------------------------------- |
| `onBranchError`   | `"fail-all" \| "continue-others"` | `"fail-all"` | What happens when one branch fails |
| `branchTimeoutMs` | `number`                          | `0`          | Per-branch timeout; 0 = no timeout |

---

## 5. Transform Node Enhancement

### Current Behavior (dag-executor.ts lines 509-519)

```typescript
// CURRENT -- uses new Function() -- UNSAFE
const fn = new Function("data", `return (${expression})`);
return fn(inputs) as unknown;
```

### New Behavior

Replace with the expression evaluator. The transform node evaluates an expression against the node's input data and returns the result.

```typescript
async function executeTransformNode(
  node: DAGNode,
  inputs: unknown,
  ctx: DAGContext,
  results: NodeResults,
): Promise<unknown> {
  const expression = (node.data.expression as string) ?? "";
  if (!expression) return inputs;

  const scope: ExpressionScope = {
    input: inputs,
    context: {
      triggerData: ctx.triggerData,
      results: Object.fromEntries(results),
      runId: ctx.runId,
    },
  };

  const result = evaluate(expression, scope);

  if (!result.success) {
    await ctx.events.emit("run:log", {
      runId: ctx.runId,
      nodeId: node.id,
      type: "expression_error",
      error: result.error,
      expression,
    });
    // Return inputs unchanged on error (do not lose data)
    return inputs;
  }

  return result.value;
}
```

### Common Transform Patterns

Users will write expressions like:

```
// Reshape an object
{ summary: input.text.substring(0, 100), score: input.confidence * 100 }

// Extract a field
input.results.data

// Filter to relevant fields
{ name: input.name, email: input.email }

// Compute a derived value
input.price * input.quantity * (1 - input.discount)

// Conditional transform
input.status == "active" ? { active: true, label: input.name } : { active: false, label: "N/A" }
```

---

## 6. Merge Node Enhancement

### Current Behavior (dag-executor.ts lines 190-193)

```typescript
case "merge": {
  result = inputs;
  break;
}
```

The `gatherInputs` helper already collects all upstream results into an object keyed by edge label or source ID. The merge node just passes this through.

### New Behavior

Configurable merge strategies. The merge node's `data.strategy` field determines how inputs are combined.

### Strategies

| Strategy    | Behavior                                                                                                                    | Use Case                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `concat`    | Collect all inputs into a flat array. If an input is itself an array, its elements are spread.                              | Aggregating results from parallel branches       |
| `object`    | Merge all inputs into a single object, keyed by edge label (falls back to source node ID). Existing behavior, but explicit. | Combining named outputs from different branches  |
| `first`     | Return the first non-undefined input. Useful for parallel "race" patterns.                                                  | Taking the fastest result from parallel branches |
| `deepMerge` | Recursively merge all input objects. Later inputs override earlier ones for conflicting keys.                               | Combining partial results that share structure   |

### Implementation

```typescript
async function executeMergeNode(node: DAGNode, inputs: unknown, ctx: DAGContext): Promise<unknown> {
  const strategy = (node.data.strategy as string) ?? "object";

  switch (strategy) {
    case "concat": {
      if (typeof inputs === "object" && inputs !== null && !Array.isArray(inputs)) {
        const values = Object.values(inputs as Record<string, unknown>);
        // Flatten one level: if a value is an array, spread its elements
        return values.flatMap((v) => (Array.isArray(v) ? v : [v]));
      }
      return Array.isArray(inputs) ? inputs : [inputs];
    }

    case "first": {
      if (typeof inputs === "object" && inputs !== null && !Array.isArray(inputs)) {
        const values = Object.values(inputs as Record<string, unknown>);
        return values.find((v) => v !== undefined && v !== null) ?? null;
      }
      return inputs;
    }

    case "deepMerge": {
      if (typeof inputs === "object" && inputs !== null && !Array.isArray(inputs)) {
        const values = Object.values(inputs as Record<string, unknown>);
        return values.reduce((acc, val) => {
          if (typeof acc === "object" && acc !== null && typeof val === "object" && val !== null) {
            return deepMerge(acc as Record<string, unknown>, val as Record<string, unknown>);
          }
          return val ?? acc;
        }, {});
      }
      return inputs;
    }

    case "object":
    default: {
      // Current behavior: inputs are already an object keyed by label/sourceId
      return inputs;
    }
  }
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const targetVal = target[key];
    const sourceVal = source[key];
    if (
      typeof targetVal === "object" &&
      targetVal !== null &&
      !Array.isArray(targetVal) &&
      typeof sourceVal === "object" &&
      sourceVal !== null &&
      !Array.isArray(sourceVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}
```

### Data Model Changes

Add to `DAGNode.data` (merge type):

| Field      | Type                                             | Default    | Description                                        |
| ---------- | ------------------------------------------------ | ---------- | -------------------------------------------------- |
| `strategy` | `"concat" \| "object" \| "first" \| "deepMerge"` | `"object"` | How to combine inputs from multiple upstream nodes |

---

## 7. Dry-Run / Execution Preview

### Overview

A server-side dry-run mode that simulates pipeline execution without side effects. LLM calls return mock responses, tool calls return mock results, human gates auto-approve, but the execution path -- topological ordering, condition branching, loop iterations, parallel fan-out -- is real.

### File: `packages/core/src/dag-dry-run.ts` (new)

### TypeScript Interfaces

```typescript
// packages/core/src/dag-dry-run.ts

import type { DAGPipeline, DAGNode, DAGEdge } from "./dag-executor.js";
import type { ExpressionScope } from "./expression-evaluator.js";

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

/**
 * Execute a dry-run simulation of the pipeline.
 * No LLM calls, no tool executions, no side effects.
 */
export function executeDryRun(options: DryRunOptions): DryRunResult;
```

### Mock Implementations

Each node type has a mock executor that returns synthetic data:

| Node Type     | Mock Behavior                                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **trigger**   | Returns `triggerData` (or `{}`)                                                                                                                                                                                        |
| **llm**       | Returns `{ response: "[Mock LLM response for: {first 80 chars of systemPrompt}]", model: "{data.model}" }`. Estimates tokens: input = `JSON.stringify(mockInput).length / 4`, output = `(data.maxTokens ?? 4096) / 4`. |
| **tool**      | Returns `{ result: "[Mock tool result for: {data.toolName}]", tool: "{data.toolName}" }`. If `mockData[nodeId]` is provided, use that instead.                                                                         |
| **humanGate** | Auto-approves. Returns `{ approved: true, autoApproved: true }`.                                                                                                                                                       |
| **condition** | Evaluates expression using the expression evaluator against mock input. If expression cannot be evaluated, uses `defaultConditionBranch` (default: `"true"`).                                                          |
| **loop**      | Runs `min(maxLoopIterations ?? 2, data.maxIterations ?? 10)` iterations. Evaluates `untilCondition` if possible.                                                                                                       |
| **parallel**  | Identifies branches and "executes" them (mock) -- records branch count.                                                                                                                                                |
| **merge**     | Applies the configured merge strategy against mock inputs.                                                                                                                                                             |
| **transform** | Evaluates expression using the expression evaluator. Falls back to passing input through.                                                                                                                              |
| **output**    | Passes input through.                                                                                                                                                                                                  |

### Dry-Run Execution Flow

1. **Validate** the pipeline (reuse `validatePipeline` from the dashboard or add a core-level validator). Collect warnings.
2. **Topological sort** all nodes.
3. **Walk** the execution graph starting from trigger nodes, following the same BFS logic as `executeDAG`:
   - For each node, compute mock input from upstream mock outputs.
   - Execute the mock handler.
   - For condition nodes, evaluate the expression and follow the correct branch.
   - For parallel nodes, "execute" all branches.
   - For loop nodes, iterate the body with mock data.
   - Record the execution order, mock I/O, and any warnings.
4. **Compute skipped nodes** -- any node not visited during the walk.
5. **Aggregate token estimates** from all LLM nodes.
6. Return the `DryRunResult`.

### Server Endpoint

#### File: `packages/server/src/routes/runs.ts` (modify)

Add a `dryRun` field to the create run schema and a dedicated endpoint:

```typescript
// Add to createRunSchema in packages/server/src/validation/schemas.ts:
export const dryRunSchema = z.object({
  agentId: z.string().uuid("agentId must be a valid UUID"),
  triggerData: z.record(z.string(), z.unknown()).optional(),
  defaultConditionBranch: z.enum(["true", "false"]).optional(),
  maxLoopIterations: z.number().int().min(1).max(10).optional(),
  mockData: z.record(z.string(), z.unknown()).optional(),
});
```

New endpoint in `runRoutes`:

```typescript
// POST /api/runs/dry-run -- editor+
app.post(
  "/dry-run",
  requireRole("editor"),
  rateLimit({ windowMs: 60_000, maxRequests: 30 }), // More permissive than real runs
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const body = await c.req.json();
    const parsed = dryRunSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
          },
        },
        400,
      );
    }

    const data = parsed.data;

    // Fetch the agent's pipeline config
    const agent = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, data.agentId), eq(agents.workspaceId, workspaceId)));
    if (agent.length === 0) {
      return errorResponse(c, 404, "NOT_FOUND", "Agent not found");
    }

    const pipeline = agent[0]!.pipelineConfig as DAGPipeline;
    if (!pipeline?.nodes?.length) {
      return errorResponse(c, 400, "INVALID_PIPELINE", "Agent has no pipeline configured");
    }

    const result = executeDryRun({
      pipeline,
      triggerData: data.triggerData ?? {},
      defaultConditionBranch: data.defaultConditionBranch as "true" | "false" | undefined,
      maxLoopIterations: data.maxLoopIterations,
      mockData: data.mockData,
    });

    return c.json(result);
  },
);
```

This endpoint:

- Does NOT create a run record in the database (no side effects).
- Does NOT count against the workspace's monthly run limit.
- Has a more permissive rate limit (30/min vs 10/min for real runs).
- Is synchronous -- dry-runs are fast (no LLM calls) so no need for background job queue.

---

## 8. Dashboard: Preview Button & Visualization

### File: `apps/dashboard/src/components/canvas/execution-toolbar.tsx` (modify)

Add a "Preview" button alongside the existing playback controls. The preview button triggers a server-side dry-run and visualizes the result on the canvas.

### Updated Props Interface

```typescript
interface ExecutionToolbarProps {
  // Existing animation-based preview controls
  isRunning: boolean;
  isPaused: boolean;
  step: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onStep: () => void;
  // New: server-side dry-run
  onPreview: () => void;
  isPreviewLoading: boolean;
  previewResult: DryRunResult | null;
  onClearPreview: () => void;
}
```

### UI Changes

Add to the toolbar, before the existing play controls:

```tsx
{
  /* Dry-Run Preview Button */
}
<Button
  variant="ghost"
  size="sm"
  className="h-7 gap-1 text-xs"
  onClick={onPreview}
  disabled={isPreviewLoading || isRunning}
  title="Preview execution path (dry run)"
>
  {isPreviewLoading ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <Eye className="h-3.5 w-3.5" />
  )}
  Preview
</Button>;

{
  /* Separator */
}
<div className="h-4 w-px bg-border mx-1" />;

{
  /* Existing play/pause/step/reset controls */
}
```

When `previewResult` is non-null, show a summary badge:

```tsx
{
  previewResult && (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
      <span>{previewResult.executionPath.length} nodes</span>
      <span className="text-border">|</span>
      <span>
        ~{previewResult.totalEstimatedTokens.input + previewResult.totalEstimatedTokens.output}{" "}
        tokens
      </span>
      {previewResult.validationWarnings.length > 0 && (
        <>
          <span className="text-border">|</span>
          <span className="text-yellow-500">
            {previewResult.validationWarnings.length} warnings
          </span>
        </>
      )}
      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClearPreview}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
```

### File: `apps/dashboard/src/lib/canvas/use-dry-run.ts` (new)

React hook that manages dry-run state and API calls:

```typescript
import { useState, useCallback } from "react";
import type { DryRunResult } from "@gnana/core";

interface UseDryRunOptions {
  agentId: string;
  workspaceId: string;
}

interface UseDryRunReturn {
  preview: DryRunResult | null;
  isLoading: boolean;
  error: string | null;
  runPreview: (triggerData?: Record<string, unknown>) => Promise<void>;
  clearPreview: () => void;
}

export function useDryRun({ agentId, workspaceId }: UseDryRunOptions): UseDryRunReturn {
  const [preview, setPreview] = useState<DryRunResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPreview = useCallback(
    async (triggerData?: Record<string, unknown>) => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/runs/dry-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId,
            triggerData: triggerData ?? {},
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error?.message ?? "Dry run failed");
        }

        const result: DryRunResult = await response.json();
        setPreview(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    },
    [agentId],
  );

  const clearPreview = useCallback(() => {
    setPreview(null);
    setError(null);
  }, []);

  return { preview, isLoading, error, runPreview, clearPreview };
}
```

### Canvas Visualization

When a dry-run result is active, the canvas should visually indicate:

1. **Execution path highlighting**: Nodes in `executionPath` get a colored border/ring (e.g., blue glow). The ring intensity or label shows execution order.
2. **Skipped nodes dimming**: Nodes in `skippedNodeIds` are dimmed (reduced opacity).
3. **Branch indicators**: Condition nodes show which branch ("true" / "false") would be taken with a small badge.
4. **Warning badges**: Nodes with warnings show a yellow warning icon.
5. **Edge animation**: Edges along the execution path get a subtle animated dash pattern (same as the existing `useExecutionPreview` animation, but based on server data).

Implementation: pass the `DryRunResult` down to `pipeline-canvas.tsx`. In the node rendering, check if the node ID is in the execution path or skipped list and apply conditional className or style. This does not require changes to individual node components -- handle it at the `pipeline-canvas.tsx` level using React Flow's `nodeClassName` or by wrapping nodes.

```typescript
// In pipeline-canvas.tsx
const nodeClassName = useCallback(
  (node: Node) => {
    if (!dryRunResult) return "";
    const inPath = dryRunResult.executionPath.some((n) => n.nodeId === node.id);
    const isSkipped = dryRunResult.skippedNodeIds.includes(node.id);
    if (inPath) return "ring-2 ring-blue-500/50";
    if (isSkipped) return "opacity-40";
    return "";
  },
  [dryRunResult],
);
```

---

## Files Summary

### Create

| File                                                       | Description                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/core/src/expression-evaluator.ts`                | Safe expression parser + evaluator (lexer, recursive-descent parser, tree-walking evaluator) |
| `packages/core/src/dag-dry-run.ts`                         | Dry-run engine (mock executors, execution path computation, token estimation)                |
| `packages/core/src/__tests__/expression-evaluator.test.ts` | Unit tests for expression evaluator                                                          |
| `packages/core/src/__tests__/dag-dry-run.test.ts`          | Unit tests for dry-run engine                                                                |
| `apps/dashboard/src/lib/canvas/use-dry-run.ts`             | React hook for dry-run API calls and state                                                   |

### Modify

| File                                                         | Change                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/dag-executor.ts`                          | Replace `new Function()` calls in condition, transform, loop nodes with expression evaluator. Add `executeSubgraph` helper. Enhance parallel node with `Promise.all`. Enhance merge node with strategy support. Pass `results` and `pipeline` to node executors that need them. |
| `packages/core/src/index.ts`                                 | Export `evaluate`, `validateExpression`, `ExpressionScope`, `ExpressionContext`, `ExpressionResult` from expression-evaluator. Export `executeDryRun`, `DryRunOptions`, `DryRunResult`, `DryRunNodeResult` from dag-dry-run.                                                    |
| `packages/server/src/validation/schemas.ts`                  | Add `dryRunSchema` Zod schema.                                                                                                                                                                                                                                                  |
| `packages/server/src/routes/runs.ts`                         | Add `POST /dry-run` endpoint. Import `executeDryRun` from `@gnana/core`.                                                                                                                                                                                                        |
| `apps/dashboard/src/components/canvas/execution-toolbar.tsx` | Add Preview button, loading state, result summary badge, clear button.                                                                                                                                                                                                          |
| `apps/dashboard/src/components/canvas/pipeline-canvas.tsx`   | Accept `dryRunResult` prop, apply execution path highlighting and skipped node dimming via `nodeClassName`.                                                                                                                                                                     |

---

## Migration & Backward Compatibility

- **No database migration required**. Dry-runs do not create run records. Node `data` fields (`strategy`, `onBranchError`, `branchTimeoutMs`, `bodyNodeIds`, `untilCondition`) are already stored as JSON in the `pipelineConfig` column -- they are purely additive.
- **Expression evaluator is backward compatible**. Simple truthiness expressions like `"true"` or `"false"` work identically. Field access like `input.score > 0.8` works. The only breaking change is removing `with(data)` scoping -- expressions that relied on `with()` implicit variable resolution (e.g., bare `score > 0.8` instead of `input.score > 0.8`) will stop working. This is acceptable because `with()` is deprecated and the current usage is limited.
- **Existing pipelines with no `strategy` / `onBranchError` fields** will use defaults (`"object"` and `"fail-all"` respectively), which matches current behavior.

---

## Implementation Order

1. **Expression evaluator** (`expression-evaluator.ts` + tests) -- zero dependencies on other changes, unblocks everything else.
2. **Condition and transform node enhancement** -- swap `new Function()` for expression evaluator. Smallest change, highest security impact.
3. **Loop node enhancement** -- requires `executeSubgraph` helper.
4. **Parallel node enhancement** -- also uses `executeSubgraph`. Can be done in parallel with step 3.
5. **Merge node enhancement** -- standalone, can be done anytime after step 1.
6. **Dry-run engine** (`dag-dry-run.ts` + tests) -- depends on expression evaluator.
7. **Server endpoint** -- depends on dry-run engine.
8. **Dashboard UI** (`use-dry-run.ts`, toolbar, canvas highlighting) -- depends on server endpoint.

Estimated effort: 3-4 days for a single developer.

---

## Open Questions

1. **Expression editor in dashboard**: Should the config drawer for condition/transform/loop nodes include syntax highlighting and inline validation for expressions? This would improve UX significantly but adds scope. Recommendation: add a basic `validateExpression()` call on blur in the config drawer as part of this work; defer a full CodeMirror-based editor to a follow-up.
2. **Loop body auto-detection**: The spec proposes explicit `bodyNodeIds` with a fallback heuristic. Should the canvas auto-detect loop bodies when the user drags nodes into a loop group node? The group node infrastructure already exists (`group-node.tsx`). Recommendation: yes, populate `bodyNodeIds` from group children automatically.
3. **Dry-run caching**: Should dry-run results be cached (e.g., by pipeline hash)? Dry-runs are cheap (no LLM calls), so caching adds complexity for minimal benefit. Recommendation: no caching for v1.
