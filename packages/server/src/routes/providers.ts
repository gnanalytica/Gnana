import { Hono } from "hono";
import { eq, and, desc, sql, providers, type Database } from "@gnana/db";
import { requireRole } from "../middleware/rbac.js";
import { cacheControl } from "../middleware/cache.js";
import { encrypt, decrypt } from "../utils/encryption.js";
import {
  createProviderSchema,
  updateProviderSchema,
  testProviderSchema,
} from "../validation/schemas.js";

// ---- Provider type metadata ----

type ProviderType = "anthropic" | "google" | "openai" | "openrouter";

interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

// Static model lists per provider (mirrors @gnana/provider-* packages)
const STATIC_MODELS: Record<ProviderType, ModelInfo[]> = {
  anthropic: [
    {
      id: "claude-opus-4-20250514",
      name: "Claude Opus 4",
      contextWindow: 200000,
      maxOutputTokens: 32000,
    },
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      contextWindow: 200000,
      maxOutputTokens: 16000,
    },
    {
      id: "claude-haiku-4-20250514",
      name: "Claude Haiku 4",
      contextWindow: 200000,
      maxOutputTokens: 8192,
    },
  ],
  google: [
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
  ],
  openai: [
    { id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1047576, maxOutputTokens: 32768 },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", contextWindow: 1047576, maxOutputTokens: 32768 },
    { id: "o3", name: "o3", contextWindow: 200000, maxOutputTokens: 100000 },
    { id: "o4-mini", name: "o4-mini", contextWindow: 200000, maxOutputTokens: 100000 },
  ],
  openrouter: [
    { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4 (OpenRouter)" },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash (OpenRouter)" },
    { id: "meta-llama/llama-4-maverick", name: "Llama 4 Maverick (OpenRouter)" },
  ],
};

// ---- Helper: mask API key showing last 4 chars ----

function maskApiKey(encryptedKey: string): string {
  const decrypted = decrypt(encryptedKey);
  if (decrypted.length <= 4) return "****";
  return `${"*".repeat(Math.min(decrypted.length - 4, 20))}${decrypted.slice(-4)}`;
}

// ---- Helper: test a provider connection by making a real API call ----

async function testProviderConnection(
  type: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ ok: boolean; error?: string; latencyMs: number; modelCount?: number }> {
  const start = Date.now();
  try {
    switch (type) {
      case "anthropic": {
        // Dynamic import to avoid bundling SDK in server if not used
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        await client.models.list();
        break;
      }
      case "openai":
      case "openrouter": {
        const { default: OpenAI } = await import("openai");
        const client = new OpenAI({
          apiKey,
          ...(type === "openrouter" && {
            baseURL: baseUrl ?? "https://openrouter.ai/api/v1",
          }),
        });
        await client.models.list();
        break;
      }
      case "google": {
        const { GoogleGenAI } = await import("@google/genai");
        const client = new GoogleGenAI({ apiKey });
        await client.models.list();
        break;
      }
      default:
        return { ok: false, error: `Unknown provider type: ${type}`, latencyMs: 0 };
    }
    const modelCount = STATIC_MODELS[type as ProviderType]?.length ?? 0;
    return { ok: true, latencyMs: Date.now() - start, modelCount };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Connection failed",
      latencyMs: Date.now() - start,
    };
  }
}

// ---- Routes ----

export function providerRoutes(db: Database) {
  const app = new Hono();

  // List providers — viewer+
  // Filters out disabled (soft-deleted) providers by default.
  // Pass ?includeDisabled=true to include them.
  app.get("/", requireRole("viewer"), cacheControl("private, max-age=60"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
    const offset = Number(c.req.query("offset")) || 0;
    const includeDisabled = c.req.query("includeDisabled") === "true";

    const whereClause = includeDisabled
      ? eq(providers.workspaceId, workspaceId)
      : and(eq(providers.workspaceId, workspaceId), eq(providers.enabled, true));

    const result = await db
      .select()
      .from(providers)
      .where(whereClause)
      .orderBy(desc(providers.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(providers)
      .where(whereClause);
    const total = countResult[0]?.count ?? 0;

    // Mask API keys — show last 4 chars for identification
    return c.json({
      data: result.map((p) => ({ ...p, apiKey: maskApiKey(p.apiKey) })),
      total,
      limit,
      offset,
    });
  });

  // Register provider — admin+
  app.post("/", requireRole("admin"), async (c) => {
    const workspaceId = c.get("workspaceId");
    const body = await c.req.json();
    const parsed = createProviderSchema.safeParse(body);
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

    // If isDefault, clear isDefault on all other providers in this workspace
    if (data.isDefault) {
      await db
        .update(providers)
        .set({ isDefault: false })
        .where(eq(providers.workspaceId, workspaceId));
    }

    const result = await db
      .insert(providers)
      .values({
        name: data.name,
        type: data.type,
        apiKey: encrypt(data.apiKey),
        baseUrl: data.baseUrl,
        config: data.config ?? {},
        isDefault: data.isDefault ?? false,
        workspaceId,
      })
      .returning();
    return c.json({ ...result[0], apiKey: maskApiKey(result[0]!.apiKey) }, 201);
  });

  // Update provider — admin+
  app.put("/:id", requireRole("admin"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    const body = await c.req.json();
    const parsed = updateProviderSchema.safeParse(body);
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

    // Build update set
    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updateSet.name = data.name;
    if (data.type !== undefined) updateSet.type = data.type;
    if (data.apiKey !== undefined) updateSet.apiKey = encrypt(data.apiKey);
    if (data.baseUrl !== undefined) updateSet.baseUrl = data.baseUrl;
    if (data.config !== undefined) updateSet.config = data.config;
    if (data.isDefault !== undefined) {
      // If setting as default, clear isDefault on all other providers first
      if (data.isDefault) {
        await db
          .update(providers)
          .set({ isDefault: false })
          .where(eq(providers.workspaceId, workspaceId));
      }
      updateSet.isDefault = data.isDefault;
    }

    const result = await db
      .update(providers)
      .set(updateSet)
      .where(and(eq(providers.id, id), eq(providers.workspaceId, workspaceId)))
      .returning();

    if (result.length === 0) {
      return c.json({ error: { code: "NOT_FOUND", message: "Provider not found" } }, 404);
    }

    return c.json({ ...result[0], apiKey: maskApiKey(result[0]!.apiKey) });
  });

  // Set default provider — admin+
  app.put("/:id/default", requireRole("admin"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");

    // Clear all defaults in workspace
    await db
      .update(providers)
      .set({ isDefault: false })
      .where(eq(providers.workspaceId, workspaceId));

    // Set this provider as default
    const result = await db
      .update(providers)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(providers.id, id), eq(providers.workspaceId, workspaceId)))
      .returning();

    if (result.length === 0) {
      return c.json({ error: { code: "NOT_FOUND", message: "Provider not found" } }, 404);
    }

    return c.json({ ...result[0], apiKey: maskApiKey(result[0]!.apiKey) });
  });

  // Test stored provider connection — admin+
  app.post("/:id/test", requireRole("admin"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");

    const result = await db
      .select()
      .from(providers)
      .where(and(eq(providers.id, id), eq(providers.workspaceId, workspaceId)))
      .limit(1);

    if (result.length === 0) {
      return c.json({ error: { code: "NOT_FOUND", message: "Provider not found" } }, 404);
    }

    const provider = result[0]!;
    const decryptedKey = decrypt(provider.apiKey);
    const testResult = await testProviderConnection(
      provider.type,
      decryptedKey,
      provider.baseUrl ?? undefined,
    );

    return c.json({
      ...testResult,
      provider: provider.type,
    });
  });

  // Test credentials without saving — admin+
  app.post("/test", requireRole("admin"), async (c) => {
    const body = await c.req.json();
    const parsed = testProviderSchema.safeParse(body);
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

    const { type, apiKey, baseUrl } = parsed.data;
    const testResult = await testProviderConnection(type, apiKey, baseUrl);

    return c.json({
      ...testResult,
      provider: type,
    });
  });

  // List models for a provider — viewer+
  app.get("/:id/models", requireRole("viewer"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");

    const result = await db
      .select()
      .from(providers)
      .where(and(eq(providers.id, id), eq(providers.workspaceId, workspaceId)))
      .limit(1);

    if (result.length === 0) {
      return c.json({ error: { code: "NOT_FOUND", message: "Provider not found" } }, 404);
    }

    const provider = result[0]!;
    const models = STATIC_MODELS[provider.type as ProviderType] ?? [];

    return c.json({ models });
  });

  // Delete provider — admin+
  app.delete("/:id", requireRole("admin"), async (c) => {
    const id = c.req.param("id");
    const workspaceId = c.get("workspaceId");
    await db
      .update(providers)
      .set({ enabled: false, updatedAt: new Date() })
      .where(and(eq(providers.id, id), eq(providers.workspaceId, workspaceId)));
    return c.json({ ok: true });
  });

  return app;
}
