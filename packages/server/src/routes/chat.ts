import { Hono } from "hono";
import { eq, providers, type Database } from "@gnana/db";
import { rateLimit } from "../middleware/rate-limit.js";

export function chatRoutes(db: Database) {
  const app = new Hono();

  // POST /api/chat/pipeline — AI-powered pipeline generation/modification (20 req/min)
  app.post("/pipeline", rateLimit({ windowMs: 60_000, maxRequests: 20 }), async (c) => {
    const workspaceId = c.get("workspaceId") as string;
    const { message, pipeline, history } = await c.req.json();

    // Get the workspace's first configured provider
    const providerList = await db
      .select()
      .from(providers)
      .where(eq(providers.workspaceId, workspaceId))
      .limit(1);

    // Build system prompt for pipeline AI
    const systemPrompt = `You are Gnana, an AI agent builder assistant. You help users create and modify agent pipelines.

When the user describes what they want, respond with a JSON pipeline specification.

Available node types: trigger, llm, tool, humanGate, condition, loop, parallel, merge, transform, output.

When modifying a pipeline, return the full updated pipeline spec.

Always respond with valid JSON wrapped in \`\`\`json code blocks when generating or modifying pipelines.

Current pipeline state:
${pipeline ? JSON.stringify(pipeline, null, 2) : "Empty - no pipeline created yet"}`;

    if (!providerList[0]) {
      // No provider configured — return a helpful message with a template
      return c.json({
        message:
          "No LLM provider configured. Go to Settings > Providers to add one. Using a simple template for now.",
        pipeline: generateTemplatePipeline(message),
      });
    }

    const provider = providerList[0];

    try {
      // Call the LLM based on provider type
      let aiResponse: string;

      if (provider.type === "anthropic") {
        aiResponse = await callAnthropic(provider.apiKey, systemPrompt, message, history);
      } else if (provider.type === "openai") {
        aiResponse = await callOpenAI(
          provider.apiKey,
          systemPrompt,
          message,
          history,
          provider.baseUrl,
        );
      } else if (provider.type === "google") {
        aiResponse = await callGoogle(provider.apiKey, systemPrompt, message, history);
      } else {
        aiResponse = "Unsupported provider type. Please configure Anthropic, OpenAI, or Google.";
      }

      // Extract pipeline spec from response if present
      const pipelineMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
      let updatedPipeline = null;
      if (pipelineMatch) {
        try {
          updatedPipeline = JSON.parse(pipelineMatch[1]!);
        } catch {
          // Ignore JSON parse errors
        }
      }

      return c.json({
        message:
          aiResponse.replace(/```json[\s\S]*?```/g, "").trim() || "Here's your updated pipeline.",
        pipeline: updatedPipeline,
      });
    } catch (error) {
      return c.json({
        message: `Error calling AI: ${error instanceof Error ? error.message : "Unknown error"}. Using template instead.`,
        pipeline: generateTemplatePipeline(message),
      });
    }
  });

  return app;
}

function generateTemplatePipeline(description: string) {
  // Simple template generation as fallback
  return {
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 0, y: 150 },
        data: { triggerType: "manual", label: "Manual Trigger" },
      },
      {
        id: "llm-1",
        type: "llm",
        position: { x: 250, y: 100 },
        data: {
          label: "Analyze",
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          systemPrompt: description,
        },
      },
      {
        id: "llm-2",
        type: "llm",
        position: { x: 500, y: 100 },
        data: {
          label: "Plan",
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
        },
      },
      {
        id: "gate-1",
        type: "humanGate",
        position: { x: 750, y: 150 },
        data: { label: "Approval", approvalMode: "required" },
      },
      {
        id: "llm-3",
        type: "llm",
        position: { x: 1000, y: 100 },
        data: {
          label: "Execute",
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
        },
      },
      {
        id: "output-1",
        type: "output",
        position: { x: 1250, y: 150 },
        data: { label: "Result" },
      },
    ],
    edges: [
      { source: "trigger-1", target: "llm-1" },
      { source: "llm-1", target: "llm-2" },
      { source: "llm-2", target: "gate-1" },
      { source: "gate-1", target: "llm-3" },
      { source: "llm-3", target: "output-1" },
    ],
  };
}

async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  message: string,
  history?: Array<{ role: string; content: string }>,
): Promise<string> {
  const messages = [
    ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    }),
  });

  const data = (await res.json()) as {
    content?: Array<{ text?: string }>;
  };
  return data.content?.[0]?.text ?? "No response from AI.";
}

async function callOpenAI(
  apiKey: string,
  systemPrompt: string,
  message: string,
  history?: Array<{ role: string; content: string }>,
  baseUrl?: string | null,
): Promise<string> {
  const messages = [
    { role: "system", content: systemPrompt },
    ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  const url = baseUrl ?? "https://api.openai.com/v1";
  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages,
      max_tokens: 4096,
    }),
  });

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "No response from AI.";
}

async function callGoogle(
  apiKey: string,
  systemPrompt: string,
  message: string,
  history?: Array<{ role: string; content: string }>,
): Promise<string> {
  const contents = [
    ...(history ?? []).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts: [{ text: message }] },
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
      }),
    },
  );

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "No response from AI.";
}
