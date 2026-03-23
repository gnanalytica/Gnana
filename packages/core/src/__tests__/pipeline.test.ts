import { describe, it, expect, vi } from "vitest";
import { executePipeline, resumePipeline, rejectRun } from "../pipeline.js";
import { createEventBus } from "../event-bus.js";
import type {
  RunContext,
  Run,
  AgentDefinition,
  RunStore,
  LLMRouter,
  ToolExecutor,
  Plan,
  EventBus,
  TriggerPayload,
} from "../types.js";
import type { ChatResponse } from "@gnana/provider-base";

// ---- Helpers to build mock objects ----

function makeMockRun(overrides?: Partial<Run>): Run {
  return {
    id: "run-1",
    agentId: "agent-1",
    status: "queued",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: "agent-1",
    name: "Test Agent",
    description: "A test agent",
    systemPrompt: "You are a test agent.",
    tools: [],
    llm: {
      analysis: { provider: "mock", model: "mock-model" },
      planning: { provider: "mock", model: "mock-model" },
    },
    triggers: [{ type: "manual" }],
    approval: "auto",
    ...overrides,
  };
}

function makeMockStore(): RunStore {
  return {
    getRun: vi.fn(async () => makeMockRun()),
    updateStatus: vi.fn(async () => {}),
    updateAnalysis: vi.fn(async () => {}),
    updatePlan: vi.fn(async () => {}),
    updateResult: vi.fn(async () => {}),
    addLog: vi.fn(async () => {}),
  };
}

function makeTextResponse(text: string): ChatResponse {
  return {
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    model: "mock-model",
  };
}

function makePlanResponse(plan: Plan): ChatResponse {
  return makeTextResponse(JSON.stringify(plan));
}

function makeMockLLM(plan: Plan): LLMRouter {
  return {
    chat: vi.fn(async () => makePlanResponse(plan)),
    chatWithTools: vi.fn(async () =>
      makeTextResponse("Analysis complete: the request looks good."),
    ),
  };
}

function makeMockTools(): ToolExecutor {
  return {
    execute: vi.fn(async () => "tool result"),
    listTools: vi.fn(() => []),
  };
}

const defaultPlan: Plan = {
  summary: "Execute the task",
  steps: [{ order: 1, description: "Do the thing" }],
};

function makeMockTrigger(): TriggerPayload {
  return {
    type: "manual",
    data: { prompt: "test prompt" },
  };
}

function makeContext(overrides?: {
  run?: Partial<Run>;
  agent?: Partial<AgentDefinition>;
  store?: RunStore;
  llm?: LLMRouter;
  tools?: ToolExecutor;
  events?: EventBus;
  trigger?: TriggerPayload;
}): RunContext {
  return {
    run: makeMockRun(overrides?.run),
    agent: makeMockAgent(overrides?.agent),
    store: overrides?.store ?? makeMockStore(),
    llm: overrides?.llm ?? makeMockLLM(defaultPlan),
    tools: overrides?.tools ?? makeMockTools(),
    events: overrides?.events ?? createEventBus(),
    trigger: overrides?.trigger ?? makeMockTrigger(),
  };
}

// ---- Tests ----

describe("executePipeline", () => {
  it("should go through all 4 phases when approval is auto", async () => {
    const store = makeMockStore();
    const events = createEventBus();
    const statusChanges: string[] = [];
    events.on("run:status_changed", (data) => {
      const payload = data as { status: string };
      statusChanges.push(payload.status);
    });

    const ctx = makeContext({ store, events, agent: { approval: "auto" } });
    await executePipeline(ctx);

    // Should have progressed through all statuses
    expect(statusChanges).toEqual(["analyzing", "planning", "executing"]);

    // Should have updated store with status = completed
    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "analyzing");
    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "planning");
    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "approved");
    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "executing");
    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "completed");

    // Should have stored analysis and plan
    expect(store.updateAnalysis).toHaveBeenCalledTimes(1);
    expect(store.updatePlan).toHaveBeenCalledTimes(1);
    expect(store.updateResult).toHaveBeenCalledTimes(1);
  });

  it("should emit run:started and run:completed events", async () => {
    const events = createEventBus();
    const started = vi.fn();
    const completed = vi.fn();
    events.on("run:started", started);
    events.on("run:completed", completed);

    const ctx = makeContext({ events, agent: { approval: "auto" } });
    await executePipeline(ctx);

    expect(started).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("should pause at approval gate when approval is required", async () => {
    const store = makeMockStore();
    const events = createEventBus();
    const awaitingApproval = vi.fn();
    events.on("run:awaiting_approval", awaitingApproval);

    const ctx = makeContext({
      store,
      events,
      agent: { approval: "required" },
    });
    await executePipeline(ctx);

    // Should have stopped at awaiting_approval
    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "awaiting_approval");
    expect(awaitingApproval).toHaveBeenCalledTimes(1);

    // Should NOT have reached executing or completed
    expect(store.updateStatus).not.toHaveBeenCalledWith("run-1", "executing");
    expect(store.updateStatus).not.toHaveBeenCalledWith("run-1", "completed");
    expect(store.updateResult).not.toHaveBeenCalled();
  });

  it("should call agent hooks at each phase", async () => {
    const hooks = {
      onAnalysisComplete: vi.fn(async () => {}),
      onPlanComplete: vi.fn(async () => {}),
      onExecutionComplete: vi.fn(async () => {}),
    };

    const ctx = makeContext({ agent: { approval: "auto", hooks } });
    await executePipeline(ctx);

    expect(hooks.onAnalysisComplete).toHaveBeenCalledTimes(1);
    expect(hooks.onPlanComplete).toHaveBeenCalledTimes(1);
    expect(hooks.onExecutionComplete).toHaveBeenCalledTimes(1);
  });

  it("should handle LLM errors in analysis phase", async () => {
    const store = makeMockStore();
    const events = createEventBus();
    const failedHandler = vi.fn();
    events.on("run:failed", failedHandler);

    const llm: LLMRouter = {
      chat: vi.fn(),
      chatWithTools: vi.fn(async () => {
        throw new Error("LLM connection failed");
      }),
    };

    const ctx = makeContext({ store, events, llm });
    await expect(executePipeline(ctx)).rejects.toThrow("LLM connection failed");

    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "failed");
    expect(failedHandler).toHaveBeenCalledTimes(1);
  });

  it("should handle LLM errors in planning phase", async () => {
    const store = makeMockStore();
    const llm: LLMRouter = {
      chat: vi.fn(async () => {
        throw new Error("Planning LLM error");
      }),
      chatWithTools: vi.fn(async () => makeTextResponse("Analysis done")),
    };

    const ctx = makeContext({ store, llm });
    await expect(executePipeline(ctx)).rejects.toThrow("Planning LLM error");

    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "failed");
  });

  it("should handle LLM errors in execution phase", async () => {
    const store = makeMockStore();

    // chatWithTools is called for analysis (first call succeeds) and execution (second call fails)
    let callCount = 0;
    const llm: LLMRouter = {
      chat: vi.fn(async () => makePlanResponse(defaultPlan)),
      chatWithTools: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // Analysis succeeds
          return makeTextResponse("Analysis done");
        }
        // Execution fails
        throw new Error("Execution LLM error");
      }),
    };

    const ctx = makeContext({ store, llm, agent: { approval: "auto" } });
    // executePipeline does not re-throw for execution step failure; it marks run as failed internally
    await executePipeline(ctx);

    // The pipeline catches step errors and marks the run as failed
    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "failed");
    expect(store.updateResult).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("should call onError hook when pipeline fails", async () => {
    const hooks = {
      onError: vi.fn(async () => {}),
    };

    const llm: LLMRouter = {
      chat: vi.fn(),
      chatWithTools: vi.fn(async () => {
        throw new Error("boom");
      }),
    };

    const ctx = makeContext({ llm, agent: { approval: "auto", hooks } });
    await expect(executePipeline(ctx)).rejects.toThrow("boom");

    expect(hooks.onError).toHaveBeenCalledTimes(1);
    expect(hooks.onError).toHaveBeenCalledWith(ctx, expect.objectContaining({ message: "boom" }));
  });

  it("should process tool calls during analysis phase", async () => {
    const tools = makeMockTools();
    const events = createEventBus();
    const toolCalledHandler = vi.fn();
    events.on("run:tool_called", toolCalledHandler);

    let callCount = 0;
    const llm: LLMRouter = {
      chat: vi.fn(async () => makePlanResponse(defaultPlan)),
      chatWithTools: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: return tool_use
          return {
            content: [
              {
                type: "tool_use" as const,
                id: "tool-call-1",
                name: "testTool",
                input: { arg: "value" },
              },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 20 },
            model: "mock-model",
          };
        }
        // Second call: return text (analysis done)
        return makeTextResponse("Analysis with tool results complete");
      }),
    };

    const ctx = makeContext({
      tools,
      events,
      llm,
      agent: { approval: "auto" },
    });
    await executePipeline(ctx);

    expect(tools.execute).toHaveBeenCalledWith("testTool", { arg: "value" });
    expect(toolCalledHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        tool: "testTool",
        input: { arg: "value" },
      }),
    );
  });

  it("should handle non-JSON plan response gracefully", async () => {
    const store = makeMockStore();
    const llm: LLMRouter = {
      chat: vi.fn(async () => makeTextResponse("This is not valid JSON")),
      chatWithTools: vi.fn(async () => makeTextResponse("Analysis complete")),
    };

    const ctx = makeContext({
      store,
      llm,
      agent: { approval: "auto" },
    });
    await executePipeline(ctx);

    // The plan phase wraps non-JSON text into a single-step plan
    expect(store.updatePlan).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        summary: "This is not valid JSON",
        steps: [{ order: 1, description: "This is not valid JSON" }],
      }),
    );
  });
});

describe("resumePipeline", () => {
  it("should continue execution after approval", async () => {
    const store = makeMockStore();
    const events = createEventBus();
    const approvedHandler = vi.fn();
    const completedHandler = vi.fn();
    events.on("run:approved", approvedHandler);
    events.on("run:completed", completedHandler);

    const plan: Plan = {
      summary: "The plan",
      steps: [{ order: 1, description: "Step one" }],
    };

    const ctx = makeContext({
      store,
      events,
      agent: { approval: "required" },
    });
    await resumePipeline(ctx, plan);

    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "approved");
    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "executing");
    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "completed");
    expect(approvedHandler).toHaveBeenCalledTimes(1);
    expect(completedHandler).toHaveBeenCalledTimes(1);
  });

  it("should call onApproval hook", async () => {
    const hooks = {
      onApproval: vi.fn(async () => {}),
    };

    const plan: Plan = {
      summary: "Plan",
      steps: [{ order: 1, description: "Step" }],
    };

    const ctx = makeContext({ agent: { approval: "required", hooks } });
    await resumePipeline(ctx, plan);

    expect(hooks.onApproval).toHaveBeenCalledTimes(1);
    expect(hooks.onApproval).toHaveBeenCalledWith(ctx);
  });

  it("should store execution result on success", async () => {
    const store = makeMockStore();
    const plan: Plan = {
      summary: "Plan",
      steps: [
        { order: 1, description: "First step" },
        { order: 2, description: "Second step" },
      ],
    };

    const ctx = makeContext({ store, agent: { approval: "required" } });
    await resumePipeline(ctx, plan);

    expect(store.updateResult).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        status: "completed",
        stepResults: expect.arrayContaining([
          expect.objectContaining({ stepOrder: 1, status: "completed" }),
          expect.objectContaining({ stepOrder: 2, status: "completed" }),
        ]),
      }),
    );
  });
});

describe("rejectRun", () => {
  it("should mark the run as rejected", async () => {
    const store = makeMockStore();

    const ctx = makeContext({ store });
    await rejectRun(ctx, "Not appropriate");

    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "rejected");
  });

  it("should emit run:rejected event with reason", async () => {
    const events = createEventBus();
    const rejectedHandler = vi.fn();
    events.on("run:rejected", rejectedHandler);

    const ctx = makeContext({ events });
    await rejectRun(ctx, "Policy violation");

    expect(rejectedHandler).toHaveBeenCalledTimes(1);
    expect(rejectedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        reason: "Policy violation",
      }),
    );
  });

  it("should call onRejection hook", async () => {
    const hooks = {
      onRejection: vi.fn(async () => {}),
    };

    const ctx = makeContext({ agent: { hooks } });
    await rejectRun(ctx, "Denied");

    expect(hooks.onRejection).toHaveBeenCalledTimes(1);
    expect(hooks.onRejection).toHaveBeenCalledWith(ctx, "Denied");
  });

  it("should work without a reason", async () => {
    const store = makeMockStore();
    const events = createEventBus();
    const rejectedHandler = vi.fn();
    events.on("run:rejected", rejectedHandler);

    const ctx = makeContext({ store, events });
    await rejectRun(ctx);

    expect(store.updateStatus).toHaveBeenCalledWith("run-1", "rejected");
    expect(rejectedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        reason: undefined,
      }),
    );
  });
});
