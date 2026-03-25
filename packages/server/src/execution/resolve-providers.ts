import { AnthropicProvider } from "@gnana/provider-anthropic";
import { GoogleProvider } from "@gnana/provider-google";
import { OpenAIProvider } from "@gnana/provider-openai";
import type { LLMProvider } from "@gnana/provider-base";
import { LLMRouterImpl } from "@gnana/core";
import type { LLMRouter, RouterConfig } from "@gnana/core";
import { eq, and } from "@gnana/db";
import { providers } from "@gnana/db";
import type { Database } from "@gnana/db";
import { decrypt } from "../utils/encryption.js";
import { jobLog } from "../logger.js";

/**
 * Build an LLMRouter for a given workspace.
 *
 * Priority:
 * 1. Workspace providers from the DB (filtered by workspaceId + enabled=true)
 * 2. Server-level env var fallbacks for any provider types not already covered
 *
 * The returned LLMRouter uses a default route config that maps common task
 * types ("analysis", "planning", "execution") to whichever providers are
 * available. The first registered provider of each type becomes the primary;
 * all registered providers are added to the fallback chain.
 */
export async function resolveProviders(db: Database, workspaceId: string): Promise<LLMRouter> {
  const log = jobLog.child({ fn: "resolveProviders", workspaceId });

  // -- 1. Load workspace providers from DB --
  const rows = await db
    .select()
    .from(providers)
    .where(and(eq(providers.workspaceId, workspaceId), eq(providers.enabled, true)));

  const providerMap = new Map<string, LLMProvider>();

  for (const row of rows) {
    const apiKey = decrypt(row.apiKey);

    try {
      switch (row.type) {
        case "anthropic": {
          providerMap.set("anthropic", new AnthropicProvider(apiKey));
          break;
        }
        case "google": {
          providerMap.set("google", new GoogleProvider(apiKey));
          break;
        }
        case "openai": {
          providerMap.set("openai", new OpenAIProvider(apiKey));
          break;
        }
        case "openrouter": {
          providerMap.set(
            "openrouter",
            new OpenAIProvider(apiKey, {
              baseURL: row.baseUrl ?? "https://openrouter.ai/api/v1",
            }),
          );
          break;
        }
        default:
          log.warn({ type: row.type }, "Unknown provider type — skipping");
      }
    } catch (err) {
      log.error({ err, providerType: row.type }, "Failed to instantiate workspace provider");
    }
  }

  // -- 2. Env-var fallbacks for missing provider types --
  if (!providerMap.has("anthropic") && process.env.ANTHROPIC_API_KEY) {
    providerMap.set("anthropic", new AnthropicProvider(process.env.ANTHROPIC_API_KEY));
    log.debug("Using ANTHROPIC_API_KEY env fallback");
  }

  if (!providerMap.has("google") && process.env.GOOGLE_AI_KEY) {
    providerMap.set("google", new GoogleProvider(process.env.GOOGLE_AI_KEY));
    log.debug("Using GOOGLE_AI_KEY env fallback");
  }

  if (!providerMap.has("openai") && process.env.OPENAI_API_KEY) {
    providerMap.set("openai", new OpenAIProvider(process.env.OPENAI_API_KEY));
    log.debug("Using OPENAI_API_KEY env fallback");
  }

  if (!providerMap.has("openrouter") && process.env.OPENROUTER_API_KEY) {
    providerMap.set(
      "openrouter",
      new OpenAIProvider(process.env.OPENROUTER_API_KEY, {
        baseURL: "https://openrouter.ai/api/v1",
      }),
    );
    log.debug("Using OPENROUTER_API_KEY env fallback");
  }

  if (providerMap.size === 0) {
    log.warn("No LLM providers configured — router will throw on first request");
  }

  // -- 3. Build a default RouterConfig --
  // Pick the first available provider for the primary routes.
  const primaryProvider = pickPrimary(providerMap);
  const fallbackChain = Array.from(providerMap.keys());

  const routerConfig: RouterConfig = {
    routes: {
      analysis: {
        provider: primaryProvider.name,
        model: defaultModel(primaryProvider.name),
      },
      planning: {
        provider: primaryProvider.name,
        model: defaultModel(primaryProvider.name),
      },
      execution: {
        provider: primaryProvider.name,
        model: defaultModel(primaryProvider.name),
      },
    },
    fallbackChain,
    retries: 2,
  };

  return new LLMRouterImpl(routerConfig, providerMap);
}

/** Return the first available provider, preferring anthropic → google → openai → openrouter. */
function pickPrimary(providerMap: Map<string, LLMProvider>): LLMProvider {
  for (const name of ["anthropic", "google", "openai", "openrouter"]) {
    const p = providerMap.get(name);
    if (p) return p;
  }

  // If no known provider, use whatever is first in the map.
  const first = providerMap.values().next().value;
  if (!first) {
    // Return a no-op sentinel so the router config is structurally valid.
    // The router will throw "All providers exhausted" when a request is made.
    return { name: "none" } as unknown as LLMProvider;
  }
  return first;
}

/** Return a sensible default model name for a given provider type. */
function defaultModel(providerName: string): string {
  switch (providerName) {
    case "anthropic":
      return "claude-sonnet-4-20250514";
    case "google":
      return "gemini-2.5-flash";
    case "openai":
      return "gpt-4.1-mini";
    case "openrouter":
      return "anthropic/claude-sonnet-4-20250514";
    default:
      return "unknown";
  }
}
