import type { RunContext, Plan, ExecutionResult, StepResult, Artifact } from "./types.js";

export async function executePipeline(ctx: RunContext): Promise<void> {
  await ctx.events.emit("run:started", ctx.run);

  try {
    // 1. Analysis phase
    await ctx.store.updateStatus(ctx.run.id, "analyzing");
    await ctx.events.emit("run:status_changed", { runId: ctx.run.id, status: "analyzing" });
    const analysis = await analyzePhase(ctx);
    await ctx.store.updateAnalysis(ctx.run.id, analysis);
    await ctx.events.emit("run:analysis_complete", { runId: ctx.run.id, analysis });
    await ctx.agent.hooks?.onAnalysisComplete?.(ctx, analysis);

    // 2. Planning phase
    await ctx.store.updateStatus(ctx.run.id, "planning");
    await ctx.events.emit("run:status_changed", { runId: ctx.run.id, status: "planning" });
    const plan = await planPhase(ctx, analysis);
    await ctx.store.updatePlan(ctx.run.id, plan);
    await ctx.events.emit("run:plan_complete", { runId: ctx.run.id, plan });
    await ctx.agent.hooks?.onPlanComplete?.(ctx, plan);

    // 3. Approval gate
    if (ctx.agent.approval === "required") {
      await ctx.store.updateStatus(ctx.run.id, "awaiting_approval");
      await ctx.events.emit("run:awaiting_approval", { runId: ctx.run.id, plan });
      return; // Pipeline pauses — resumed by approve/reject API
    }

    // 4. Auto-approve → execute
    await ctx.store.updateStatus(ctx.run.id, "approved");
    await executePhase(ctx, plan);
  } catch (error) {
    await ctx.store.updateStatus(ctx.run.id, "failed");
    await ctx.events.emit("run:failed", { runId: ctx.run.id, error });
    await ctx.agent.hooks?.onError?.(
      ctx,
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  }
}

export async function resumePipeline(ctx: RunContext, plan: Plan): Promise<void> {
  await ctx.store.updateStatus(ctx.run.id, "approved");
  await ctx.events.emit("run:approved", { runId: ctx.run.id });
  await ctx.agent.hooks?.onApproval?.(ctx);
  await executePhase(ctx, plan);
}

export async function rejectRun(ctx: RunContext, reason?: string): Promise<void> {
  await ctx.store.updateStatus(ctx.run.id, "rejected");
  await ctx.events.emit("run:rejected", { runId: ctx.run.id, reason });
  await ctx.agent.hooks?.onRejection?.(ctx, reason);
}

// ---- Phase implementations ----

async function analyzePhase(ctx: RunContext): Promise<unknown> {
  const tools = ctx.tools.listTools();
  const maxRounds = ctx.agent.maxToolRounds ?? 10;

  const messages: { role: "user" | "assistant"; content: string }[] = [
    {
      role: "user",
      content: `Analyze the following request and gather information using available tools.\n\nTrigger: ${ctx.trigger.type}\nData: ${JSON.stringify(ctx.trigger.data)}`,
    },
  ];

  let analysis = "";

  for (let round = 0; round < maxRounds; round++) {
    const response = await ctx.llm.chatWithTools("analysis", {
      systemPrompt: ctx.agent.systemPrompt,
      messages,
      tools,
    });

    // Extract text content
    for (const block of response.content) {
      if (block.type === "text") {
        analysis = block.text;
      }
    }

    // If no tool use, analysis is complete
    if (response.stopReason !== "tool_use") break;

    // Process tool calls
    const assistantContent = response.content;
    messages.push({ role: "assistant", content: JSON.stringify(assistantContent) });

    const toolResults: string[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        await ctx.events.emit("run:tool_called", {
          runId: ctx.run.id,
          tool: block.name,
          input: block.input,
        });
        await ctx.store.addLog(ctx.run.id, {
          timestamp: new Date(),
          stage: "analyzing",
          type: "tool_call",
          message: `Calling tool: ${block.name}`,
          data: block.input,
        });

        let input: unknown = block.input;
        if (ctx.agent.hooks?.beforeToolCall) {
          input = await ctx.agent.hooks.beforeToolCall(block.name, input);
        }

        let result = await ctx.tools.execute(block.name, input);

        if (ctx.agent.hooks?.afterToolCall) {
          result = await ctx.agent.hooks.afterToolCall(block.name, input, result);
        }

        await ctx.events.emit("run:tool_result", { runId: ctx.run.id, tool: block.name, result });
        toolResults.push(`[Tool: ${block.name}] ${result}`);
      }
    }

    messages.push({ role: "user", content: toolResults.join("\n\n") });
  }

  return { summary: analysis };
}

async function planPhase(ctx: RunContext, analysis: unknown): Promise<Plan> {
  const response = await ctx.llm.chat("planning", {
    systemPrompt: `${ctx.agent.systemPrompt}\n\nYou are in the planning phase. Based on the analysis, create a structured plan. Respond with valid JSON matching this schema: { "summary": string, "steps": [{ "order": number, "description": string, "toolCalls": string[] }] }`,
    messages: [
      {
        role: "user",
        content: `Analysis results:\n${JSON.stringify(analysis)}\n\nCreate a step-by-step execution plan.`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Planning phase returned no text content");
  }

  try {
    return JSON.parse(text.text) as Plan;
  } catch {
    // If LLM didn't return valid JSON, wrap as a single-step plan
    return {
      summary: text.text,
      steps: [{ order: 1, description: text.text }],
    };
  }
}

async function executePhase(ctx: RunContext, plan: Plan): Promise<void> {
  await ctx.store.updateStatus(ctx.run.id, "executing");
  await ctx.events.emit("run:status_changed", { runId: ctx.run.id, status: "executing" });

  const stepResults: StepResult[] = [];
  const artifacts: Artifact[] = [];

  for (const step of plan.steps) {
    await ctx.store.addLog(ctx.run.id, {
      timestamp: new Date(),
      stage: "executing",
      type: "info",
      message: `Executing step ${step.order}: ${step.description}`,
    });

    try {
      const response = await ctx.llm.chatWithTools("execution", {
        systemPrompt: `${ctx.agent.systemPrompt}\n\nYou are executing step ${step.order} of a plan: "${step.description}". Use the available tools to complete this step.`,
        messages: [
          {
            role: "user",
            content: `Execute this step: ${step.description}\n\nFull plan context: ${JSON.stringify(plan)}`,
          },
        ],
        tools: ctx.tools.listTools(),
      });

      const textContent = response.content.find((b) => b.type === "text");
      stepResults.push({
        stepOrder: step.order,
        status: "completed",
        output: textContent?.type === "text" ? textContent.text : "",
      });
    } catch (error) {
      stepResults.push({
        stepOrder: step.order,
        status: "failed",
        output: error instanceof Error ? error.message : String(error),
      });

      const result: ExecutionResult = { status: "failed", stepResults, artifacts };
      await ctx.store.updateResult(ctx.run.id, result);
      await ctx.store.updateStatus(ctx.run.id, "failed");
      await ctx.events.emit("run:failed", { runId: ctx.run.id, result });
      return;
    }
  }

  const result: ExecutionResult = { status: "completed", stepResults, artifacts };
  await ctx.store.updateResult(ctx.run.id, result);
  await ctx.store.updateStatus(ctx.run.id, "completed");
  await ctx.events.emit("run:completed", { runId: ctx.run.id, result });
  await ctx.agent.hooks?.onExecutionComplete?.(ctx, result);
}
