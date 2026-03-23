import type { ChatParams, ChatResponse, LLMProvider, ToolChatParams } from "@gnana/provider-base";
import type { LLMRouter as ILLMRouter, RouterConfig, RouteConfig } from "./types.js";

export class LLMRouterImpl implements ILLMRouter {
  private config: RouterConfig;
  private providers: Map<string, LLMProvider>;

  constructor(config: RouterConfig, providers: Map<string, LLMProvider>) {
    this.config = config;
    this.providers = providers;
  }

  async chat(taskType: string, params: Omit<ChatParams, "model">): Promise<ChatResponse> {
    return this.routeRequest(taskType, (provider, model) => provider.chat({ ...params, model }));
  }

  async chatWithTools(
    taskType: string,
    params: Omit<ToolChatParams, "model">,
  ): Promise<ChatResponse> {
    return this.routeRequest(taskType, (provider, model) =>
      provider.chatWithTools({ ...params, model }),
    );
  }

  private async routeRequest(
    taskType: string,
    fn: (provider: LLMProvider, model: string) => Promise<ChatResponse>,
  ): Promise<ChatResponse> {
    const route = this.config.routes[taskType];
    if (!route) {
      throw new Error(`No route configured for task type: ${taskType}`);
    }

    const retries = this.config.retries ?? 2;
    const chain = this.buildFallbackChain(route);

    for (const { providerName, model } of chain) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await fn(provider, model);
        } catch (error) {
          const isLastAttempt = attempt === retries;
          if (isLastAttempt) break; // try next provider in chain

          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`All providers exhausted for task type: ${taskType}`);
  }

  private buildFallbackChain(primary: RouteConfig): { providerName: string; model: string }[] {
    const chain: { providerName: string; model: string }[] = [
      { providerName: primary.provider, model: primary.model },
    ];

    if (this.config.fallbackChain) {
      for (const providerName of this.config.fallbackChain) {
        if (providerName !== primary.provider) {
          // Fallback providers use the primary model name — consumers should configure compatible models
          chain.push({ providerName, model: primary.model });
        }
      }
    }

    return chain;
  }
}
