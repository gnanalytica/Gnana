import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  ChatParams,
  ChatResponse,
  ToolChatParams,
  ChatResponseChunk,
  ContentBlock,
  ModelInfo,
  LLMToolDef,
} from "@gnana/provider-base";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : this.toAnthropicContent(m.content),
      })),
      ...(params.temperature !== undefined && { temperature: params.temperature }),
    });

    return this.normalizeResponse(response);
  }

  async chatWithTools(params: ToolChatParams): Promise<ChatResponse> {
    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : this.toAnthropicContent(m.content),
      })),
      tools: params.tools.map((t) => this.toAnthropicTool(t)),
      ...(params.temperature !== undefined && { temperature: params.temperature }),
    });

    return this.normalizeResponse(response);
  }

  async *chatStream(params: ChatParams): AsyncIterable<ChatResponseChunk> {
    const stream = this.client.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : this.toAnthropicContent(m.content),
      })),
      ...(params.temperature !== undefined && { temperature: params.temperature }),
    });

    yield* this.processStream(stream);
  }

  async *chatWithToolsStream(params: ToolChatParams): AsyncIterable<ChatResponseChunk> {
    const stream = this.client.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : this.toAnthropicContent(m.content),
      })),
      tools: params.tools.map((t) => this.toAnthropicTool(t)),
      ...(params.temperature !== undefined && { temperature: params.temperature }),
    });

    yield* this.processStream(stream);
  }

  listModels(): ModelInfo[] {
    return [
      { id: "claude-opus-4-20250514", name: "Claude Opus 4", contextWindow: 200000, maxOutputTokens: 32000 },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", contextWindow: 200000, maxOutputTokens: 16000 },
      { id: "claude-haiku-4-20250514", name: "Claude Haiku 4", contextWindow: 200000, maxOutputTokens: 8192 },
    ];
  }

  // ---- Private helpers ----

  private toAnthropicContent(content: ContentBlock[]): Anthropic.ContentBlockParam[] {
    return content.map((block) => {
      switch (block.type) {
        case "text":
          return { type: "text" as const, text: block.text };
        case "tool_use":
          return { type: "tool_use" as const, id: block.id, name: block.name, input: block.input };
        case "tool_result":
          return {
            type: "tool_result" as const,
            tool_use_id: block.toolUseId,
            content: block.content,
            ...(block.isError && { is_error: true }),
          };
      }
    });
  }

  private toAnthropicTool(tool: LLMToolDef): Anthropic.Tool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    };
  }

  private normalizeResponse(response: Anthropic.Message): ChatResponse {
    const content: ContentBlock[] = response.content.map((block) => {
      if (block.type === "text") {
        return { type: "text", text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      }
      // thinking/redacted_thinking blocks — skip
      return { type: "text" as const, text: "" };
    });

    return {
      content,
      stopReason: response.stop_reason === "tool_use" ? "tool_use" : response.stop_reason === "max_tokens" ? "max_tokens" : "end_turn",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
    };
  }

  private async *processStream(
    stream: ReturnType<typeof this.client.messages.stream>,
  ): AsyncIterable<ChatResponseChunk> {
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          yield {
            type: "tool_use_start",
            toolUse: { id: event.content_block.id, name: event.content_block.name },
          };
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "text_delta", text: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          yield { type: "tool_input_delta", text: event.delta.partial_json };
        }
      } else if (event.type === "content_block_stop") {
        yield { type: "tool_use_end" };
      } else if (event.type === "message_delta") {
        yield {
          type: "done",
          usage: {
            inputTokens: 0,
            outputTokens: event.usage.output_tokens,
          },
        };
      }
    }
  }
}
