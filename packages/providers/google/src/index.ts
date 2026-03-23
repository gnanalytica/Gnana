import { GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import type {
  LLMProvider,
  ChatParams,
  ChatResponse,
  ToolChatParams,
  ChatResponseChunk,
  ContentBlock,
  ModelInfo,
  LLMToolDef,
  Message,
} from "@gnana/provider-base";

export class GoogleProvider implements LLMProvider {
  name = "google";
  private client: GoogleGenAI;

  constructor(apiKey?: string) {
    this.client = new GoogleGenAI({ apiKey: apiKey ?? "" });
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const contents = this.toGeminiContents(params.messages);

    const response = await this.client.models.generateContent({
      model: params.model,
      contents,
      config: {
        systemInstruction: params.systemPrompt,
        maxOutputTokens: params.maxTokens ?? 4096,
        ...(params.temperature !== undefined && { temperature: params.temperature }),
      },
    });

    return this.normalizeResponse(response, params.model);
  }

  async chatWithTools(params: ToolChatParams): Promise<ChatResponse> {
    const contents = this.toGeminiContents(params.messages);

    const response = await this.client.models.generateContent({
      model: params.model,
      contents,
      config: {
        systemInstruction: params.systemPrompt,
        maxOutputTokens: params.maxTokens ?? 4096,
        ...(params.temperature !== undefined && { temperature: params.temperature }),
        tools: [{ functionDeclarations: params.tools.map((t) => this.toGeminiFunctionDecl(t)) }],
      },
    });

    return this.normalizeResponse(response, params.model);
  }

  async *chatStream(params: ChatParams): AsyncIterable<ChatResponseChunk> {
    const contents = this.toGeminiContents(params.messages);

    const response = await this.client.models.generateContentStream({
      model: params.model,
      contents,
      config: {
        systemInstruction: params.systemPrompt,
        maxOutputTokens: params.maxTokens ?? 4096,
        ...(params.temperature !== undefined && { temperature: params.temperature }),
      },
    });

    for await (const chunk of response) {
      const text = chunk.text;
      if (text) {
        yield { type: "text_delta", text };
      }
    }
    yield { type: "done" };
  }

  async *chatWithToolsStream(params: ToolChatParams): AsyncIterable<ChatResponseChunk> {
    const contents = this.toGeminiContents(params.messages);

    const response = await this.client.models.generateContentStream({
      model: params.model,
      contents,
      config: {
        systemInstruction: params.systemPrompt,
        maxOutputTokens: params.maxTokens ?? 4096,
        ...(params.temperature !== undefined && { temperature: params.temperature }),
        tools: [{ functionDeclarations: params.tools.map((t) => this.toGeminiFunctionDecl(t)) }],
      },
    });

    for await (const chunk of response) {
      const text = chunk.text;
      if (text) {
        yield { type: "text_delta", text };
      }
      // Function calls in streaming
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.functionCall) {
            yield {
              type: "tool_use_start",
              toolUse: {
                id: `call_${Date.now()}`,
                name: part.functionCall.name ?? "",
                input: (part.functionCall.args as Record<string, unknown>) ?? {},
              },
            };
            yield { type: "tool_use_end" };
          }
        }
      }
    }
    yield { type: "done" };
  }

  listModels(): ModelInfo[] {
    return [
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
      },
    ];
  }

  // ---- Private helpers ----

  private toGeminiContents(messages: Message[]): Content[] {
    return messages.map((m) => {
      const parts: Part[] = [];

      if (typeof m.content === "string") {
        parts.push({ text: m.content });
      } else {
        for (const block of m.content) {
          switch (block.type) {
            case "text":
              parts.push({ text: block.text });
              break;
            case "tool_use":
              parts.push({
                functionCall: { name: block.name, args: block.input },
              });
              break;
            case "tool_result":
              parts.push({
                functionResponse: {
                  name: block.toolUseId,
                  response: { result: block.content },
                },
              });
              break;
          }
        }
      }

      return {
        role: m.role === "assistant" ? "model" : "user",
        parts,
      };
    });
  }

  private toGeminiFunctionDecl(tool: LLMToolDef): FunctionDeclaration {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    };
  }

  private normalizeResponse(response: unknown, model: string): ChatResponse {
    // The Google GenAI SDK response shape
    const resp = response as {
      candidates?: Array<{
        content?: { parts?: Part[] };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };

    const parts = resp.candidates?.[0]?.content?.parts ?? [];
    const content: ContentBlock[] = [];

    for (const part of parts) {
      if (part.text) {
        content.push({ type: "text", text: part.text });
      }
      if (part.functionCall) {
        content.push({
          type: "tool_use",
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: part.functionCall.name ?? "",
          input: (part.functionCall.args as Record<string, unknown>) ?? {},
        });
      }
    }

    const hasToolUse = content.some((c) => c.type === "tool_use");
    const finishReason = resp.candidates?.[0]?.finishReason;

    return {
      content,
      stopReason: hasToolUse
        ? "tool_use"
        : finishReason === "MAX_TOKENS"
          ? "max_tokens"
          : "end_turn",
      usage: {
        inputTokens: resp.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: resp.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model,
    };
  }
}
