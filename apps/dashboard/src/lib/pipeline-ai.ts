import type { PipelineSpec } from "@/types/pipeline";

/**
 * Generate a PipelineSpec from a natural-language description.
 *
 * In production this would call the backend which uses the workspace's
 * configured LLM provider. For now we do a smart heuristic parse that
 * creates a sensible pipeline from keywords in the prompt.
 */
export async function generatePipelineFromPrompt(prompt: string): Promise<PipelineSpec> {
  // Simulate network delay for realistic UX
  await new Promise((r) => setTimeout(r, 1200));

  const lower = prompt.toLowerCase();

  // Detect intent keywords
  const needsApproval =
    lower.includes("approv") || lower.includes("review") || lower.includes("confirm");
  const hasBranching =
    lower.includes("if ") || lower.includes("condition") || lower.includes("branch");
  const hasParallel =
    lower.includes("parallel") || lower.includes("simultaneous") || lower.includes("at the same time");
  const hasLoop =
    lower.includes("loop") || lower.includes("repeat") || lower.includes("each") || lower.includes("every");
  const hasSlack = lower.includes("slack");
  const hasGithub = lower.includes("github") || lower.includes("pr") || lower.includes("pull request");
  const hasEmail = lower.includes("email");
  const hasData =
    lower.includes("data") || lower.includes("database") || lower.includes("sql") || lower.includes("query");

  // Build nodes dynamically
  const nodes: PipelineSpec["nodes"] = [];
  const edges: PipelineSpec["edges"] = [];
  let x = 0;
  const yCenter = 200;
  const xStep = 240;

  function addNode(
    id: string,
    type: PipelineSpec["nodes"][number]["type"],
    data: Record<string, unknown>,
    yOffset = 0,
  ) {
    nodes.push({ id, type, position: { x, y: yCenter + yOffset }, data });
    x += xStep;
    return id;
  }

  // Always start with trigger
  const triggerId = addNode("trigger-1", "trigger", {
    triggerType: hasGithub ? "Webhook" : "Manual",
  });

  // Analysis LLM
  const analyzeId = addNode("analyze-1", "llm", {
    phase: "analyze",
    model: "Claude Sonnet 4",
    provider: "Anthropic",
    toolCount: 0,
  });
  edges.push({ source: triggerId, target: analyzeId });

  // Data tool if needed
  let lastId = analyzeId;
  if (hasData) {
    const toolId = addNode("data-tool-1", "tool", {
      name: "Query Database",
      description: "Execute SQL queries",
    });
    edges.push({ source: lastId, target: toolId });
    lastId = toolId;
  }

  // GitHub tool
  if (hasGithub) {
    const toolId = addNode("github-tool-1", "tool", {
      name: "GitHub",
      description: "Fetch PRs and code",
    });
    edges.push({ source: lastId, target: toolId });
    lastId = toolId;
  }

  // Plan LLM
  const planId = addNode("plan-1", "llm", {
    phase: "plan",
    model: "Claude Sonnet 4",
    provider: "Anthropic",
    toolCount: 0,
  });
  edges.push({ source: lastId, target: planId });
  lastId = planId;

  // Branching
  if (hasBranching) {
    const condId = addNode("condition-1", "condition", { expression: "meets criteria?" });
    edges.push({ source: lastId, target: condId });

    const execTrueId = addNode("exec-true", "llm", {
      phase: "execute",
      model: "GPT-4.1",
      provider: "OpenAI",
      toolCount: 2,
    });
    edges.push({ source: condId, target: execTrueId, sourceHandle: "true", label: "Yes" });

    const execFalseId = addNode("exec-false", "llm", {
      phase: "execute",
      model: "GPT-4.1",
      provider: "OpenAI",
      toolCount: 1,
    });
    // Offset false branch vertically
    const falseNode = nodes.find((n) => n.id === execFalseId);
    if (falseNode) falseNode.position.y += 150;
    edges.push({ source: condId, target: execFalseId, sourceHandle: "false", label: "No" });

    const mergeId = addNode("merge-1", "merge", { inputs: 2 });
    edges.push({ source: execTrueId, target: mergeId });
    edges.push({ source: execFalseId, target: mergeId });
    lastId = mergeId;
  } else if (hasParallel) {
    const parallelId = addNode("parallel-1", "parallel", { branches: 2 });
    edges.push({ source: lastId, target: parallelId });

    const b1Id = addNode("branch-1-exec", "llm", {
      phase: "execute",
      model: "Claude Sonnet 4",
      provider: "Anthropic",
      toolCount: 2,
    });
    edges.push({ source: parallelId, target: b1Id, sourceHandle: "branch-0" });

    const b2Id = addNode("branch-2-exec", "llm", {
      phase: "execute",
      model: "Claude Sonnet 4",
      provider: "Anthropic",
      toolCount: 2,
    });
    const b2Node = nodes.find((n) => n.id === b2Id);
    if (b2Node) b2Node.position.y += 150;
    edges.push({ source: parallelId, target: b2Id, sourceHandle: "branch-1" });

    const mergeId = addNode("merge-1", "merge", { inputs: 2 });
    edges.push({ source: b1Id, target: mergeId });
    edges.push({ source: b2Id, target: mergeId });
    lastId = mergeId;
  } else {
    // Simple approval + execute
    if (needsApproval) {
      const gateId = addNode("gate-1", "humanGate", { approval: "required" });
      edges.push({ source: lastId, target: gateId });
      lastId = gateId;
    }

    const execId = addNode("execute-1", "llm", {
      phase: "execute",
      model: "GPT-4.1",
      provider: "OpenAI",
      toolCount: 3,
    });
    edges.push({ source: lastId, target: execId });
    lastId = execId;
  }

  // Loop wrapper
  if (hasLoop) {
    const loopId = addNode("loop-1", "loop", { maxIterations: 10 });
    edges.push({ source: lastId, target: loopId });
    lastId = loopId;
  }

  // Notification tools
  if (hasSlack) {
    const slackId = addNode("slack-1", "tool", {
      name: "Slack",
      description: "Post to Slack channel",
    });
    edges.push({ source: lastId, target: slackId });
    lastId = slackId;
  }
  if (hasEmail) {
    const emailId = addNode("email-1", "tool", {
      name: "Email",
      description: "Send email notification",
    });
    edges.push({ source: lastId, target: emailId });
    lastId = emailId;
  }

  // Output
  const outputId = addNode("output-1", "output", { label: "Result" });
  edges.push({ source: lastId, target: outputId });

  // Derive name
  const name = deriveName(prompt);

  return {
    name,
    description: prompt.slice(0, 200),
    systemPrompt: `You are an AI agent. ${prompt}`,
    nodes,
    edges,
  };
}

function deriveName(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes("github") && lower.includes("slack")) return "GitHub → Slack Reporter";
  if (lower.includes("code review") || lower.includes("pull request")) return "Code Review Agent";
  if (lower.includes("support")) return "Support Agent";
  if (lower.includes("data") || lower.includes("sql")) return "Data Analyst";
  if (lower.includes("report")) return "Report Generator";
  // Fallback: capitalize first few words
  const words = prompt.split(/\s+/).slice(0, 4);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") + " Agent";
}
