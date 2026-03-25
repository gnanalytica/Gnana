# Provider Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the provider management UI and API endpoints so users can configure, test, and manage their LLM provider API keys.

**Architecture:** Enhance existing provider CRUD routes with test/models endpoints. Build dashboard settings page with provider cards, add/edit dialog, and connection testing. Mask API keys on read, encrypt on write.

**Tech Stack:** Hono (server routes), Next.js + shadcn/ui (dashboard), Drizzle ORM, AES-256-GCM encryption

**Spec:** `docs/superpowers/specs/2026-03-25-provider-management-design.md`

---

## Task 1: API Enhancements — Schema, Validation, and Route Endpoints

**Files:**

- Modify: `packages/db/src/schema.ts` (add `isDefault` column to providers table)
- Modify: `packages/server/src/validation/schemas.ts` (add `openrouter`, `isDefault`, `updateProviderSchema`)
- Modify: `packages/server/src/routes/providers.ts` (add test, models, update, default endpoints; mask keys; filter disabled)

**Steps:**

- [ ] Add `isDefault` column to the providers table in `packages/db/src/schema.ts`:

  ```typescript
  // In the providers table definition, after the `enabled` field:
  isDefault: boolean("is_default").notNull().default(false),
  ```

  The full providers table becomes:

  ```typescript
  export const providers = pgTable(
    "providers",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      workspaceId: uuid("workspace_id").references(() => workspaces.id),
      name: text("name").notNull(),
      type: text("type").notNull(),
      apiKey: text("api_key").notNull(),
      baseUrl: text("base_url"),
      config: jsonb("config").notNull().default("{}"),
      enabled: boolean("enabled").notNull().default(true),
      isDefault: boolean("is_default").notNull().default(false),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index("providers_workspace_id_idx").on(table.workspaceId)],
  );
  ```

- [ ] Update `packages/server/src/validation/schemas.ts` — add `openrouter` to the type enum, add `isDefault` field, and create `updateProviderSchema`:

  Replace the entire Providers section:

  ```typescript
  // ──────────────────────────────────────
  // Providers
  // ──────────────────────────────────────

  export const createProviderSchema = z.object({
    type: z.enum(["anthropic", "google", "openai", "openrouter"], {
      message: "Type must be one of: anthropic, google, openai, openrouter",
    }),
    name: z.string().min(1, "Name is required").max(255),
    apiKey: z.string().min(1, "API key is required"),
    baseUrl: z.string().url().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    isDefault: z.boolean().optional(),
  });

  export const updateProviderSchema = z.object({
    type: z.enum(["anthropic", "google", "openai", "openrouter"], {
      message: "Type must be one of: anthropic, google, openai, openrouter",
    }).optional(),
    name: z.string().min(1, "Name is required").max(255).optional(),
    apiKey: z.string().min(1, "API key is required").optional(),
    baseUrl: z.string().url().nullable().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    isDefault: z.boolean().optional(),
  });

  export const testProviderSchema = z.object({
    type: z.enum(["anthropic", "google", "openai", "openrouter"], {
      message: "Type must be one of: anthropic, google, openai, openrouter",
    }),
    apiKey: z.string().min(1, "API key is required"),
    baseUrl: z.string().url().optional(),
  });
  ```

- [ ] Rewrite `packages/server/src/routes/providers.ts` with all new endpoints. Replace the entire file:

  ```typescript
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
      { id: "claude-opus-4-20250514", name: "Claude Opus 4", contextWindow: 200000, maxOutputTokens: 32000 },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", contextWindow: 200000, maxOutputTokens: 16000 },
      { id: "claude-haiku-4-20250514", name: "Claude Haiku 4", contextWindow: 200000, maxOutputTokens: 8192 },
    ],
    google: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 1048576, maxOutputTokens: 65536 },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: 1048576, maxOutputTokens: 65536 },
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
  ```

  **Note on route ordering:** The `POST /test` (unsaved credentials test) must be registered before `POST /:id/test` (stored provider test) to avoid Hono treating `"test"` as an `:id` param. In the code above, `/:id/test` is registered before `/test`, which works because Hono matches literal path segments before params. However, to be safe, the order above places the parameterized routes (`/:id/...`) before the literal `/test`. The Hono router is smart enough to match `/test` as a literal POST route. If issues arise during testing, swap the order so `POST /test` comes before `POST /:id/test`.

- [ ] Install provider SDK peer dependencies in the server package. These are already installed as workspace dependencies through the provider packages, but the server needs them for dynamic imports in the test endpoint. Add to `packages/server/package.json` dependencies:

  ```json
  "@anthropic-ai/sdk": "^0.39.0",
  "openai": "^4.77.0",
  "@google/genai": "^0.7.0"
  ```

  Run: `pnpm install`

- [ ] Generate the DB migration for the new `isDefault` column:

  ```bash
  pnpm --filter @gnana/db db:generate
  ```

- [ ] Typecheck and build:

  ```bash
  pnpm --filter @gnana/db typecheck && pnpm --filter @gnana/db build
  pnpm --filter @gnana/server typecheck && pnpm --filter @gnana/server build
  ```

- [ ] Commit:

  ```
  feat(server): provider API enhancements — test, models, update, default endpoints

  - Add isDefault column to providers table
  - Add openrouter to provider type enum, add updateProviderSchema and testProviderSchema
  - Add POST /:id/test and POST /test (unsaved) endpoints for connection testing
  - Add GET /:id/models endpoint returning static model lists
  - Add PUT /:id (update) and PUT /:id/default (set default) endpoints
  - Mask API keys with last 4 chars in list/create/update responses
  - Filter disabled providers by default, add ?includeDisabled=true query param
  ```

---

## Task 2: Provider Card Component

**Files:**

- Create: `apps/dashboard/src/components/settings/provider-card.tsx`

**Steps:**

- [ ] First, install the `@radix-ui/react-alert-dialog` dependency for the delete confirmation dialog. It is not currently in the dashboard's package.json:

  ```bash
  pnpm --filter @gnana/dashboard add @radix-ui/react-alert-dialog
  ```

- [ ] Create the AlertDialog shadcn component at `apps/dashboard/src/components/ui/alert-dialog.tsx`:

  ```typescript
  "use client";

  import * as React from "react";
  import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

  import { cn } from "@/lib/utils";
  import { buttonVariants } from "@/components/ui/button";

  const AlertDialog = AlertDialogPrimitive.Root;

  const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

  const AlertDialogPortal = AlertDialogPrimitive.Portal;

  const AlertDialogOverlay = React.forwardRef<
    React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
    React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
  >(({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
      ref={ref}
    />
  ));
  AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

  const AlertDialogContent = React.forwardRef<
    React.ElementRef<typeof AlertDialogPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
  >(({ className, ...props }, ref) => (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  ));
  AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

  const AlertDialogHeader = ({
    className,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => (
    <div
      className={cn(
        "flex flex-col space-y-2 text-center sm:text-left",
        className,
      )}
      {...props}
    />
  );
  AlertDialogHeader.displayName = "AlertDialogHeader";

  const AlertDialogFooter = ({
    className,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => (
    <div
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
        className,
      )}
      {...props}
    />
  );
  AlertDialogFooter.displayName = "AlertDialogFooter";

  const AlertDialogTitle = React.forwardRef<
    React.ElementRef<typeof AlertDialogPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
  >(({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Title
      ref={ref}
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  ));
  AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

  const AlertDialogDescription = React.forwardRef<
    React.ElementRef<typeof AlertDialogPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
  >(({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Description
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  ));
  AlertDialogDescription.displayName =
    AlertDialogPrimitive.Description.displayName;

  const AlertDialogAction = React.forwardRef<
    React.ElementRef<typeof AlertDialogPrimitive.Action>,
    React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
  >(({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Action
      ref={ref}
      className={cn(buttonVariants(), className)}
      {...props}
    />
  ));
  AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

  const AlertDialogCancel = React.forwardRef<
    React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
    React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
  >(({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Cancel
      ref={ref}
      className={cn(
        buttonVariants({ variant: "outline" }),
        "mt-2 sm:mt-0",
        className,
      )}
      {...props}
    />
  ));
  AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

  export {
    AlertDialog,
    AlertDialogPortal,
    AlertDialogOverlay,
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
  };
  ```

- [ ] Create `apps/dashboard/src/components/settings/provider-card.tsx`:

  ```typescript
  "use client";

  import { useState } from "react";
  import {
    MoreHorizontal,
    Pencil,
    Trash2,
    Star,
    Wifi,
    Loader2,
  } from "lucide-react";
  import { Card, CardContent } from "@/components/ui/card";
  import { Badge } from "@/components/ui/badge";
  import { Button } from "@/components/ui/button";
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  } from "@/components/ui/dropdown-menu";
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  } from "@/components/ui/alert-dialog";

  export type ProviderType = "anthropic" | "google" | "openai" | "openrouter";
  export type ConnectionStatus = "connected" | "error" | "untested";

  export interface ProviderRow {
    id: string;
    name: string;
    type: ProviderType;
    apiKey: string;
    baseUrl?: string | null;
    config: Record<string, unknown>;
    enabled: boolean;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
    // Client-side state (not from API)
    status?: ConnectionStatus;
    statusMessage?: string;
    modelCount?: number;
  }

  interface ProviderCardProps {
    provider: ProviderRow;
    onEdit: (provider: ProviderRow) => void;
    onDelete: (provider: ProviderRow) => void;
    onSetDefault: (provider: ProviderRow) => void;
    onTest: (provider: ProviderRow) => void;
    testing?: boolean;
  }

  const PROVIDER_COLORS: Record<ProviderType, string> = {
    anthropic: "bg-orange-500/10 text-orange-600 border-orange-200",
    google: "bg-blue-500/10 text-blue-600 border-blue-200",
    openai: "bg-green-500/10 text-green-600 border-green-200",
    openrouter: "bg-purple-500/10 text-purple-600 border-purple-200",
  };

  const PROVIDER_LABELS: Record<ProviderType, string> = {
    anthropic: "Anthropic",
    google: "Google",
    openai: "OpenAI",
    openrouter: "OpenRouter",
  };

  const STATUS_INDICATORS: Record<ConnectionStatus, { dot: string; label: string }> = {
    connected: { dot: "bg-green-500", label: "Connected" },
    error: { dot: "bg-red-500", label: "Error" },
    untested: { dot: "bg-gray-400", label: "Not tested" },
  };

  export function ProviderCard({
    provider,
    onEdit,
    onDelete,
    onSetDefault,
    onTest,
    testing,
  }: ProviderCardProps) {
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    const status = provider.status ?? "untested";
    const statusInfo = STATUS_INDICATORS[status];
    const colorClass = PROVIDER_COLORS[provider.type] ?? "";

    return (
      <>
        <Card className="transition-colors hover:border-foreground/20">
          <CardContent className="p-5">
            {/* Header row: icon area, name, default badge */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${colorClass}`}
                >
                  {provider.type.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold truncate">{provider.name}</h3>
                    {provider.isDefault && (
                      <Badge variant="secondary" className="shrink-0 gap-1 text-xs">
                        <Star className="h-3 w-3 fill-current" />
                        Default
                      </Badge>
                    )}
                  </div>
                  {/* Details row */}
                  <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                    <span>{PROVIDER_LABELS[provider.type]}</span>
                    <span>{"·"}</span>
                    {provider.modelCount !== undefined && (
                      <>
                        <span>
                          {provider.modelCount} {provider.modelCount === 1 ? "model" : "models"}
                        </span>
                        <span>{"·"}</span>
                      </>
                    )}
                    <div className="flex items-center gap-1.5">
                      <div className={`h-2 w-2 rounded-full ${statusInfo.dot}`} />
                      <span>{statusInfo.label}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Open menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(provider)}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onTest(provider)} disabled={testing}>
                    {testing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wifi className="h-4 w-4" />
                    )}
                    Test Connection
                  </DropdownMenuItem>
                  {!provider.isDefault && (
                    <DropdownMenuItem onClick={() => onSetDefault(provider)}>
                      <Star className="h-4 w-4" />
                      Set as Default
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Error message row */}
            {status === "error" && provider.statusMessage && (
              <div className="mt-3 rounded-md bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
                {provider.statusMessage}
              </div>
            )}

            {/* Masked API key */}
            <div className="mt-3 text-xs font-mono text-muted-foreground">
              {provider.apiKey}
            </div>
          </CardContent>
        </Card>

        {/* Delete confirmation dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete &ldquo;{provider.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the provider and its API key. Agents using this
                provider will fail until a new one is configured.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                onClick={() => {
                  onDelete(provider);
                  setDeleteDialogOpen(false);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }
  ```

- [ ] Typecheck and build:

  ```bash
  pnpm --filter @gnana/dashboard typecheck && pnpm --filter @gnana/dashboard build
  ```

- [ ] Commit:

  ```
  feat(dashboard): add ProviderCard component with status indicator, actions, delete confirmation

  - Create alert-dialog shadcn UI component (new dependency)
  - Create provider-card.tsx with connection status dots, default badge,
    masked API key display, dropdown actions, and delete confirmation dialog
  - Define ProviderRow and ProviderType types for reuse
  ```

---

## Task 3: Provider Form Dialog (Add/Edit with Test Connection)

**Files:**

- Create: `apps/dashboard/src/components/settings/provider-form-dialog.tsx`

**Steps:**

- [ ] Create `apps/dashboard/src/components/settings/provider-form-dialog.tsx`:

  ```typescript
  "use client";

  import { useState, useEffect, useCallback } from "react";
  import { Loader2, CheckCircle2, XCircle } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
  } from "@/components/ui/dialog";
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import { api } from "@/lib/api";
  import type { ProviderRow, ProviderType } from "./provider-card";

  interface ProviderFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    provider?: ProviderRow;
    onSaved: (provider: ProviderRow) => void;
  }

  const PROVIDER_TYPE_NAMES: Record<ProviderType, string> = {
    anthropic: "Anthropic",
    google: "Google",
    openai: "OpenAI",
    openrouter: "OpenRouter",
  };

  interface TestResult {
    ok: boolean;
    provider: string;
    error?: string;
    latencyMs: number;
    modelCount?: number;
  }

  export function ProviderFormDialog({
    open,
    onOpenChange,
    provider,
    onSaved,
  }: ProviderFormDialogProps) {
    const isEdit = !!provider;

    const [type, setType] = useState<ProviderType>("anthropic");
    const [name, setName] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [isDefault, setIsDefault] = useState(false);

    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<TestResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Reset form when dialog opens or provider changes
    useEffect(() => {
      if (open) {
        if (provider) {
          setType(provider.type);
          setName(provider.name);
          setApiKey("");
          setBaseUrl(provider.baseUrl ?? "");
          setIsDefault(provider.isDefault);
        } else {
          setType("anthropic");
          setName("Anthropic");
          setApiKey("");
          setBaseUrl("");
          setIsDefault(false);
        }
        setTestResult(null);
        setError(null);
      }
    }, [open, provider]);

    // Auto-fill name when type changes (add mode only)
    const handleTypeChange = useCallback(
      (newType: ProviderType) => {
        setType(newType);
        if (!isEdit) {
          setName(PROVIDER_TYPE_NAMES[newType]);
        }
        // Auto-fill base URL for OpenRouter
        if (newType === "openrouter" && !baseUrl) {
          setBaseUrl("https://openrouter.ai/api/v1");
        } else if (newType !== "openrouter" && baseUrl === "https://openrouter.ai/api/v1") {
          setBaseUrl("");
        }
        setTestResult(null);
      },
      [isEdit, baseUrl],
    );

    // Test connection handler
    const handleTest = useCallback(async () => {
      setTesting(true);
      setTestResult(null);
      setError(null);

      try {
        if (isEdit && !apiKey) {
          // Test stored credentials
          const res = await api.fetch(`/api/providers/${provider!.id}/test`, {
            method: "POST",
          });
          const result: TestResult = await res.json();
          setTestResult(result);
        } else {
          // Test unsaved credentials
          const res = await api.fetch("/api/providers/test", {
            method: "POST",
            body: JSON.stringify({
              type,
              apiKey,
              ...(baseUrl && { baseUrl }),
            }),
          });
          const result: TestResult = await res.json();
          setTestResult(result);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Test failed");
      } finally {
        setTesting(false);
      }
    }, [isEdit, apiKey, provider, type, baseUrl]);

    // Save handler
    const handleSave = useCallback(async () => {
      setSaving(true);
      setError(null);

      try {
        if (isEdit) {
          // Update existing provider
          const body: Record<string, unknown> = { name, isDefault };
          if (apiKey) body.apiKey = apiKey;
          if (type !== provider!.type) body.type = type;
          if (baseUrl || baseUrl !== (provider!.baseUrl ?? "")) body.baseUrl = baseUrl || null;

          const res = await api.fetch(`/api/providers/${provider!.id}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
          const updated: ProviderRow = await res.json();
          onSaved(updated);
        } else {
          // Create new provider
          const res = await api.fetch("/api/providers", {
            method: "POST",
            body: JSON.stringify({
              type,
              name,
              apiKey,
              ...(baseUrl && { baseUrl }),
              isDefault,
            }),
          });
          const created: ProviderRow = await res.json();
          onSaved(created);
        }
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save provider");
      } finally {
        setSaving(false);
      }
    }, [isEdit, type, name, apiKey, baseUrl, isDefault, provider, onSaved, onOpenChange]);

    const canSave = isEdit
      ? name.trim().length > 0
      : name.trim().length > 0 && apiKey.trim().length > 0;

    const canTest = isEdit
      ? true // Can test stored credentials even without new key
      : apiKey.trim().length > 0;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Provider" : "Add Provider"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the provider configuration."
                : "Connect an LLM provider to Gnana."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Provider Type */}
            <div className="space-y-2">
              <Label htmlFor="provider-type">Provider Type</Label>
              <Select
                value={type}
                onValueChange={(v) => handleTypeChange(v as ProviderType)}
                disabled={isEdit}
              >
                <SelectTrigger id="provider-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="provider-name">Name</Label>
              <Input
                id="provider-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Anthropic Production"
              />
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <Label htmlFor="provider-key">API Key</Label>
              <Input
                id="provider-key"
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setTestResult(null);
                }}
                placeholder={isEdit ? "Leave blank to keep current key" : "sk-..."}
              />
            </div>

            {/* Base URL — always shown for OpenRouter, optional for others */}
            {(type === "openrouter" || baseUrl) && (
              <div className="space-y-2">
                <Label htmlFor="provider-base-url">
                  Base URL {type !== "openrouter" && "(optional)"}
                </Label>
                <Input
                  id="provider-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                />
                <p className="text-xs text-muted-foreground">
                  {type === "openrouter"
                    ? "OpenRouter API base URL."
                    : "Only needed for custom proxies or OpenRouter."}
                </p>
              </div>
            )}

            {/* Test result inline display */}
            {testResult && (
              <div
                className={`rounded-md p-3 text-sm ${
                  testResult.ok
                    ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                    : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                }`}
              >
                <div className="flex items-center gap-2">
                  {testResult.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0" />
                  )}
                  <span className="font-medium">
                    {testResult.ok
                      ? `Connection successful (${testResult.latencyMs}ms)`
                      : "Connection failed"}
                  </span>
                </div>
                {testResult.ok && testResult.modelCount !== undefined && (
                  <p className="mt-1 ml-6">
                    {testResult.modelCount} {testResult.modelCount === 1 ? "model" : "models"}{" "}
                    available
                  </p>
                )}
                {!testResult.ok && testResult.error && (
                  <p className="mt-1 ml-6">{testResult.error}</p>
                )}
              </div>
            )}

            {/* Error display */}
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
                {error}
              </div>
            )}

            {/* Set as default checkbox */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="provider-default"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="provider-default" className="text-sm font-normal">
                Set as default provider
              </Label>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={!canTest || testing}
            >
              {testing && <Loader2 className="h-4 w-4 animate-spin" />}
              Test Connection
            </Button>
            <Button onClick={handleSave} disabled={!canSave || saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Save Changes" : "Add Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  ```

- [ ] Typecheck and build:

  ```bash
  pnpm --filter @gnana/dashboard typecheck && pnpm --filter @gnana/dashboard build
  ```

- [ ] Commit:

  ```
  feat(dashboard): add ProviderFormDialog for add/edit with inline test connection

  - Create provider-form-dialog.tsx with type selector, name, API key, base URL fields
  - Auto-fill name from type, auto-populate OpenRouter base URL
  - Test stored credentials (edit mode) or unsaved credentials (add mode)
  - Display inline test result (success with latency/model count, or error)
  - Support isDefault checkbox
  ```

---

## Task 4: Provider Settings Page (Full Rewrite)

**Files:**

- Modify: `apps/dashboard/src/app/(dashboard)/settings/providers/page.tsx` (full rewrite)

**Steps:**

- [ ] Rewrite `apps/dashboard/src/app/(dashboard)/settings/providers/page.tsx` replacing all placeholder content with real API integration:

  ```typescript
  "use client";

  import { useState, useEffect, useCallback } from "react";
  import { Plus, AlertTriangle } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import { Skeleton } from "@/components/ui/skeleton";
  import { api } from "@/lib/api";
  import {
    ProviderCard,
    type ProviderRow,
    type ConnectionStatus,
  } from "@/components/settings/provider-card";
  import { ProviderFormDialog } from "@/components/settings/provider-form-dialog";

  interface TestResult {
    ok: boolean;
    provider: string;
    error?: string;
    latencyMs: number;
    modelCount?: number;
  }

  export default function ProvidersPage() {
    const [providers, setProviders] = useState<ProviderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Dialog state
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingProvider, setEditingProvider] = useState<ProviderRow | undefined>(undefined);

    // Track which provider is currently being tested
    const [testingId, setTestingId] = useState<string | null>(null);

    // Fetch providers from API
    const fetchProviders = useCallback(async () => {
      try {
        setError(null);
        const res = await api.fetch("/api/providers");
        const json = await res.json();
        const data = (json.data ?? []) as ProviderRow[];
        // Preserve client-side status from previous state
        setProviders((prev) => {
          const statusMap = new Map(
            prev.map((p) => [
              p.id,
              { status: p.status, statusMessage: p.statusMessage, modelCount: p.modelCount },
            ]),
          );
          return data.map((p) => ({
            ...p,
            status: statusMap.get(p.id)?.status,
            statusMessage: statusMap.get(p.id)?.statusMessage,
            modelCount: statusMap.get(p.id)?.modelCount,
          }));
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load providers");
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => {
      fetchProviders();
    }, [fetchProviders]);

    // Test connection handler
    const handleTest = useCallback(async (provider: ProviderRow) => {
      setTestingId(provider.id);
      try {
        const res = await api.fetch(`/api/providers/${provider.id}/test`, {
          method: "POST",
        });
        const result: TestResult = await res.json();
        setProviders((prev) =>
          prev.map((p) =>
            p.id === provider.id
              ? {
                  ...p,
                  status: (result.ok ? "connected" : "error") as ConnectionStatus,
                  statusMessage: result.ok ? undefined : result.error,
                  modelCount: result.modelCount,
                }
              : p,
          ),
        );
      } catch (err) {
        setProviders((prev) =>
          prev.map((p) =>
            p.id === provider.id
              ? {
                  ...p,
                  status: "error" as ConnectionStatus,
                  statusMessage: err instanceof Error ? err.message : "Test failed",
                }
              : p,
          ),
        );
      } finally {
        setTestingId(null);
      }
    }, []);

    // Delete handler
    const handleDelete = useCallback(
      async (provider: ProviderRow) => {
        try {
          await api.fetch(`/api/providers/${provider.id}`, { method: "DELETE" });
          await fetchProviders();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to delete provider");
        }
      },
      [fetchProviders],
    );

    // Set default handler
    const handleSetDefault = useCallback(
      async (provider: ProviderRow) => {
        try {
          await api.fetch(`/api/providers/${provider.id}/default`, { method: "PUT" });
          await fetchProviders();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to set default provider");
        }
      },
      [fetchProviders],
    );

    // Edit handler
    const handleEdit = useCallback((provider: ProviderRow) => {
      setEditingProvider(provider);
      setDialogOpen(true);
    }, []);

    // Add handler
    const handleAdd = useCallback(() => {
      setEditingProvider(undefined);
      setDialogOpen(true);
    }, []);

    // After save callback
    const handleSaved = useCallback(() => {
      fetchProviders();
    }, [fetchProviders]);

    // Check if there is a default provider
    const hasDefault = providers.some((p) => p.isDefault);

    // ---- Render ----

    return (
      <div className="p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Providers</h1>
            <p className="text-muted-foreground mt-1">
              Manage LLM provider connections.
            </p>
          </div>
          <Button onClick={handleAdd}>
            <Plus className="h-4 w-4" />
            Add Provider
          </Button>
        </div>

        {/* No default provider warning */}
        {!loading && providers.length > 0 && !hasDefault && (
          <div className="flex items-center gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              No default provider set. Set a default provider so agents have a
              fallback LLM connection.
            </span>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
                <Skeleton className="h-3 w-40" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && providers.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
            <AlertTriangle className="h-10 w-10 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold">No LLM providers configured</h2>
            <p className="text-muted-foreground mt-2 max-w-md">
              Add an LLM provider to start running agents. Gnana supports
              Anthropic, Google, OpenAI, and OpenRouter.
            </p>
            <Button className="mt-6" onClick={handleAdd}>
              <Plus className="h-4 w-4" />
              Add Provider
            </Button>
          </div>
        )}

        {/* Provider cards grid */}
        {!loading && providers.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onSetDefault={handleSetDefault}
                onTest={handleTest}
                testing={testingId === provider.id}
              />
            ))}
          </div>
        )}

        {/* Add/Edit Dialog */}
        <ProviderFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          provider={editingProvider}
          onSaved={handleSaved}
        />
      </div>
    );
  }
  ```

- [ ] Typecheck and build:

  ```bash
  pnpm --filter @gnana/dashboard typecheck && pnpm --filter @gnana/dashboard build
  ```

- [ ] Commit:

  ```
  feat(dashboard): rewrite provider settings page with API integration

  - Full rewrite of /settings/providers page replacing placeholder data
  - Loading state with skeleton cards, empty state with CTA
  - Provider cards grid with test, edit, delete, set-default actions
  - No-default-provider warning banner
  - Real API integration via dashboard client for all CRUD operations
  ```

---

## Final Verification

- [ ] `pnpm install` (ensure all new dependencies are installed)
- [ ] `pnpm --filter @gnana/db db:generate` (generate migration for isDefault column)
- [ ] `pnpm typecheck` (all packages pass)
- [ ] `pnpm build` (all packages build successfully)
