# Provider Management UI & API — Design Spec

## Overview

Complete the provider management story: enhance the existing CRUD API with connection testing and model listing, then replace the stub dashboard UI with a fully functional provider settings page. Users must be able to add, test, edit, delete, and set a default LLM provider from the dashboard.

## Current State

What exists today:

- **DB schema**: `providers` table with `id`, `workspaceId`, `name`, `type`, `apiKey` (encrypted), `baseUrl`, `config` (JSONB), `enabled`, `createdAt`, `updatedAt`
- **Server routes** (`packages/server/src/routes/providers.ts`): `GET /` (list), `POST /` (create), `DELETE /:id` (soft-delete via `enabled: false`)
- **Provider packages**: `@gnana/provider-anthropic`, `@gnana/provider-google`, `@gnana/provider-openai` — each implements `LLMProvider` with `chat()`, `chatWithTools()`, `listModels()`, streaming
- **Encryption**: AES-256-GCM via `packages/server/src/utils/encryption.ts` — keys encrypted before storage, `encrypt()`/`decrypt()` functions
- **Validation**: `createProviderSchema` in `packages/server/src/validation/schemas.ts` — Zod schema for type, name, apiKey, baseUrl, config
- **Dashboard**: `/settings/providers` page exists but renders hardcoded placeholder data with no API integration
- **Client SDK**: `DashboardClient` extends `GnanaClient` with auto-refresh on 401, exposed as `api` singleton

## 1. Provider API Enhancements

### 1.1 New Endpoints

#### `POST /api/providers/:id/test`

Validate that the stored API key works by instantiating the provider and calling `listModels()` (or a lightweight API call). Returns connection status.

```typescript
// Request: empty body (uses stored credentials)
// POST /api/providers/:id/test

// Response 200:
interface TestResult {
  ok: true;
  provider: string; // "anthropic"
  modelCount: number; // number of models returned
  latencyMs: number; // round-trip time
}

// Response 200 (failure — not 500, the test itself ran fine):
interface TestResult {
  ok: false;
  provider: string;
  error: string; // "Invalid API key" / "Network error" / etc.
}
```

**Implementation**: Requires `admin` role. Look up the provider row, `decrypt()` the apiKey, instantiate the provider class, call `listModels()` (for static lists) or make a lightweight API call to validate the key:

- **Anthropic**: `POST /v1/messages` with a minimal 1-token request, catch auth errors
- **Google**: `client.models.list()` or similar lightweight call
- **OpenAI / OpenRouter**: `GET /v1/models` via the OpenAI SDK

The key insight: `listModels()` on our providers currently returns a hardcoded static list and does NOT validate the API key. The `/test` endpoint must make an actual API call.

```typescript
// packages/server/src/routes/providers.ts

async function testProviderConnection(
  type: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const start = Date.now();
  try {
    switch (type) {
      case "anthropic": {
        const client = new Anthropic({ apiKey });
        // Minimal call — list models or send a tiny request
        await client.models.list();
        break;
      }
      case "openai":
      case "openrouter": {
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
        const client = new GoogleGenAI({ apiKey });
        await client.models.list();
        break;
      }
      default:
        return { ok: false, error: `Unknown provider type: ${type}`, latencyMs: 0 };
    }
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Connection failed",
      latencyMs: Date.now() - start,
    };
  }
}
```

#### `GET /api/providers/:id/models`

Return the list of available models for a configured provider.

```typescript
// Response 200:
interface ModelsResponse {
  models: ModelInfo[];
}

// ModelInfo (from @gnana/provider-base):
interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}
```

**Implementation**: Requires `viewer` role. Instantiate the provider, call `listModels()`. For now this returns the static hardcoded list from each provider class. Future enhancement: fetch dynamically from the provider API and cache.

### 1.2 Existing Endpoint Modifications

#### `GET /` — Mask API Keys

Current behavior returns `apiKey: "***"`. Change to show last 4 characters for identification:

```typescript
// Before:
{ ...p, apiKey: "***" }

// After:
function maskApiKey(encryptedKey: string): string {
  const decrypted = decrypt(encryptedKey);
  if (decrypted.length <= 4) return "****";
  return `${"*".repeat(Math.min(decrypted.length - 4, 20))}${decrypted.slice(-4)}`;
}
// Result: "********************ab3f"
```

#### `POST /` — Add `isDefault` Support

When creating a provider, allow setting `isDefault: true`. If set, clear `isDefault` on all other providers in the workspace first (only one default per workspace).

#### `PUT /:id` — New Update Endpoint

Currently missing. Add a full update endpoint:

```typescript
// PUT /api/providers/:id
// Body: Partial<CreateProviderInput> — all fields optional
// If apiKey is provided, re-encrypt it
// If isDefault is true, clear isDefault on other providers
```

#### `PUT /:id/default` — Set Default Provider

Dedicated endpoint to toggle the default provider:

```typescript
// PUT /api/providers/:id/default
// Body: empty
// Sets this provider as default, clears isDefault on all others in workspace
```

#### `DELETE /:id` — Hard Delete Option

Current behavior soft-deletes (sets `enabled: false`). Keep this, but consider: soft-deleted providers should not appear in the list by default. Add `?includeDisabled=true` query param to the list endpoint.

### 1.3 Validation Updates

Update `createProviderSchema` in `packages/server/src/validation/schemas.ts`:

```typescript
// Add "openrouter" to the type enum
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

export const updateProviderSchema = createProviderSchema.partial();
```

### 1.4 DB Schema Update

Add `isDefault` column to the providers table:

```typescript
// packages/db/src/schema.ts — providers table
isDefault: boolean("is_default").notNull().default(false),
```

Generate and apply migration via `pnpm --filter @gnana/db db:generate && pnpm --filter @gnana/db db:push`.

## 2. Provider Settings UI

### 2.1 Page Layout

**File**: `apps/dashboard/src/app/(dashboard)/settings/providers/page.tsx`

Full rewrite of the current stub. The page has three states:

**Empty state** (no providers configured):

```
┌─────────────────────────────────────────────────┐
│  ⚠ No LLM providers configured                 │
│                                                  │
│  Add an LLM provider to start running agents.   │
│  Gnana supports Anthropic, Google, OpenAI,      │
│  and OpenRouter.                                 │
│                                                  │
│          [ + Add Provider ]                      │
└─────────────────────────────────────────────────┘
```

**Provider list** (one or more providers):

```
┌─────────────────────────────────────────────────┐
│  Providers                    [ + Add Provider ] │
│  Manage LLM provider connections.                │
│                                                  │
│  ┌─────────────────────────────────────────────┐│
│  │ 🟢 Anthropic           ★ Default           ││
│  │ anthropic · 3 models · Connected            ││
│  │                    [Edit] [Delete] [Default]││
│  └─────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────┐│
│  │ 🟢 OpenAI                                  ││
│  │ openai · 4 models · Connected               ││
│  │                    [Edit] [Delete] [Default]││
│  └─────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────┐│
│  │ 🔴 Google                                   ││
│  │ google · 2 models · Error: Invalid API key  ││
│  │                    [Edit] [Delete] [Default]││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

**Loading state**: Skeleton cards while fetching from API.

### 2.2 Provider Card Component

**File**: `apps/dashboard/src/components/settings/provider-card.tsx`

```typescript
interface ProviderCardProps {
  provider: ProviderRow;
  onEdit: (provider: ProviderRow) => void;
  onDelete: (provider: ProviderRow) => void;
  onSetDefault: (provider: ProviderRow) => void;
  onTest: (provider: ProviderRow) => void;
}

interface ProviderRow {
  id: string;
  name: string;
  type: "anthropic" | "google" | "openai" | "openrouter";
  apiKey: string; // Masked: "********************ab3f"
  baseUrl?: string;
  config: Record<string, unknown>;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  // Client-side state (not from API):
  status?: "connected" | "error" | "untested";
  statusMessage?: string;
  modelCount?: number;
}
```

Card layout uses shadcn `Card` component:

- **Header row**: Provider icon (per type) + name + isDefault badge (star icon with "Default" text)
- **Details row**: type label, model count (e.g., "3 models"), connection status indicator (green dot = connected, red dot = error, gray dot = untested)
- **Error row** (conditional): if status is "error", show error message in muted red text
- **Actions row**: three icon buttons via shadcn `DropdownMenu` on a "..." trigger:
  - Edit — opens ProviderFormDialog in edit mode
  - Test Connection — calls `POST /test`, updates card status
  - Set as Default — calls `PUT /:id/default` (hidden if already default)
  - Delete — confirmation dialog, then `DELETE /:id`

**Provider type icons**: Use simple text/emoji indicators or provider brand colors:

- Anthropic: orange-brown accent
- Google: blue accent
- OpenAI: green accent
- OpenRouter: purple accent

### 2.3 Provider Form Dialog

**File**: `apps/dashboard/src/components/settings/provider-form-dialog.tsx`

Reusable dialog for both "Add" and "Edit" modes.

```typescript
interface ProviderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: ProviderRow; // If provided, edit mode; otherwise, add mode
  onSaved: (provider: ProviderRow) => void;
}
```

**Dialog content:**

```
┌──────────────────────────────────────────┐
│  Add Provider / Edit Provider            │
│  Connect an LLM provider to Gnana.       │
│                                          │
│  Provider Type                           │
│  ┌────────────────────────────────────┐  │
│  │ ● Anthropic  ○ Google             │  │
│  │ ○ OpenAI     ○ OpenRouter         │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Name                                    │
│  [ Anthropic                         ]   │
│                                          │
│  API Key                                 │
│  [ ●●●●●●●●●●●●●●●●●●●●            ]   │
│                                          │
│  Base URL (optional)                     │
│  [ https://...                       ]   │
│  Only needed for OpenRouter or proxies.  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ ✓ Connection successful (1,203ms) │  │
│  │   3 models available              │  │
│  └────────────────────────────────────┘  │
│                                          │
│  □ Set as default provider               │
│                                          │
│       [Test Connection]     [Save]       │
└──────────────────────────────────────────┘
```

**Behavior:**

1. **Provider type selector**: Radio group with 4 options. On change, auto-fill the Name field with the type name (e.g., selecting "anthropic" sets name to "Anthropic"). User can override.
2. **Name**: Text input, auto-filled from type but editable.
3. **API Key**: Password input. In edit mode, shows placeholder "Leave blank to keep current key". Only sent to API if changed.
4. **Base URL**: Text input, only shown/relevant for OpenRouter (auto-populated with `https://openrouter.ai/api/v1`) or custom proxies. Hidden by default, shown via "Advanced" toggle or always visible for OpenRouter type.
5. **Test Connection button**: Calls `POST /api/providers/:id/test` (edit mode) or creates a temporary test. Shows inline result:
   - Success: green check + latency + model count
   - Failure: red X + error message
   - Loading: spinner
6. **Save button**: Enabled when type + name + apiKey are filled. Calls `POST /` (add) or `PUT /:id` (edit).
7. **isDefault checkbox**: "Set as default provider"

**For new providers (add mode)**: The test flow requires the key to be saved first (since `/test` operates on stored providers). Two approaches:

- **Option A (recommended)**: Add a `POST /api/providers/test` endpoint that accepts `{ type, apiKey, baseUrl }` in the request body and tests without saving. This allows testing before committing.
- **Option B**: Save first as disabled, test, then enable.

Go with Option A. Add this endpoint:

```typescript
// POST /api/providers/test  (no :id — tests credentials without saving)
// Body: { type: "anthropic" | "google" | "openai" | "openrouter", apiKey: string, baseUrl?: string }
// Response: same TestResult shape
```

### 2.4 Delete Confirmation

Use shadcn `AlertDialog`:

```
┌──────────────────────────────────────┐
│  Delete "Anthropic"?                 │
│                                      │
│  This will remove the provider and   │
│  its API key. Agents using this      │
│  provider will fail until a new one  │
│  is configured.                      │
│                                      │
│           [Cancel]  [Delete]         │
└──────────────────────────────────────┘
```

### 2.5 Data Fetching

Use `useEffect` + the dashboard `api` client. No need for React Query at this stage — the data is small and changes infrequently.

```typescript
// Fetch providers list
const res = await api.fetch("/api/providers");
const { data, total } = await res.json();

// Test connection
const res = await api.fetch(`/api/providers/${id}/test`, { method: "POST" });
const result: TestResult = await res.json();

// Fetch models
const res = await api.fetch(`/api/providers/${id}/models`);
const { models } = await res.json();

// Create provider
const res = await api.fetch("/api/providers", {
  method: "POST",
  body: JSON.stringify({ type, name, apiKey, baseUrl, isDefault }),
});

// Update provider
const res = await api.fetch(`/api/providers/${id}`, {
  method: "PUT",
  body: JSON.stringify({ name, apiKey, baseUrl, isDefault }),
});

// Delete provider
const res = await api.fetch(`/api/providers/${id}`, { method: "DELETE" });

// Set default
const res = await api.fetch(`/api/providers/${id}/default`, { method: "PUT" });

// Test without saving (for add flow)
const res = await api.fetch("/api/providers/test", {
  method: "POST",
  body: JSON.stringify({ type, apiKey, baseUrl }),
});
```

## 3. Model Listing

When a user clicks "Edit" on a provider or after a successful connection test, fetch and display the model list.

### 3.1 Model List Display

Show inside the edit dialog or as an expandable section on the provider card:

```
Available Models (3)
┌──────────────────────────────────────────────┐
│ claude-opus-4-20250514                       │
│ Claude Opus 4 · 200K context · 32K output    │
├──────────────────────────────────────────────┤
│ claude-sonnet-4-20250514                     │
│ Claude Sonnet 4 · 200K context · 16K output  │
├──────────────────────────────────────────────┤
│ claude-haiku-4-20250514                      │
│ Claude Haiku 4 · 200K context · 8K output    │
└──────────────────────────────────────────────┘
```

Each row shows:

- Model ID (monospace, copyable)
- Display name + context window + max output tokens (where available)

This is read-only / informational. Model selection for agents happens in the canvas LLM node config, not here.

### 3.2 Model Info Component

```typescript
interface ModelListProps {
  models: ModelInfo[];
  loading?: boolean;
}
```

Simple list using shadcn `Card` or a plain `div` with borders. Show skeleton rows while loading.

## 4. Files to Create/Modify

### Modify

| File                                                             | Changes                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/src/routes/providers.ts`                        | Add `POST /:id/test`, `POST /test`, `GET /:id/models`, `PUT /:id`, `PUT /:id/default` endpoints. Import `decrypt` and provider classes. Update list endpoint to mask keys with last 4 chars and filter disabled by default. |
| `packages/server/src/validation/schemas.ts`                      | Add `"openrouter"` to type enum. Add `updateProviderSchema`. Add `isDefault` field.                                                                                                                                         |
| `packages/db/src/schema.ts`                                      | Add `isDefault` column to providers table.                                                                                                                                                                                  |
| `apps/dashboard/src/app/(dashboard)/settings/providers/page.tsx` | Full rewrite: replace placeholder data with API calls, render ProviderCard list, empty state, loading state, wire up Add Provider dialog.                                                                                   |

### Create

| File                                                              | Purpose                                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/dashboard/src/components/settings/provider-card.tsx`        | Provider card component with status indicator, actions dropdown, default badge.    |
| `apps/dashboard/src/components/settings/provider-form-dialog.tsx` | Add/Edit provider dialog with type selector, API key input, test connection, save. |

## 5. API Route Summary

| Method   | Path                         | Role   | Description                                       |
| -------- | ---------------------------- | ------ | ------------------------------------------------- |
| `GET`    | `/api/providers`             | viewer | List providers (masked keys, filter disabled)     |
| `POST`   | `/api/providers`             | admin  | Create provider (encrypt key, optional isDefault) |
| `PUT`    | `/api/providers/:id`         | admin  | Update provider (re-encrypt key if changed)       |
| `DELETE` | `/api/providers/:id`         | admin  | Soft-delete provider                              |
| `POST`   | `/api/providers/:id/test`    | admin  | Test stored provider connection                   |
| `POST`   | `/api/providers/test`        | admin  | Test credentials without saving                   |
| `GET`    | `/api/providers/:id/models`  | viewer | List available models for provider                |
| `PUT`    | `/api/providers/:id/default` | admin  | Set provider as workspace default                 |

## 6. Edge Cases

- **No ENCRYPTION_KEY set**: `encrypt()` already falls back to plaintext storage with a warning log. The UI does not need to handle this — it is a server deployment concern.
- **Invalid provider type**: Zod validation rejects at the API layer. The UI only offers 4 choices so this cannot happen from the dashboard.
- **Duplicate provider names**: Allowed. Users might have "Anthropic (prod)" and "Anthropic (test)".
- **OpenRouter base URL**: Auto-populated when type is "openrouter". The OpenAI provider class handles OpenRouter via `baseURL` option.
- **API key rotation**: User edits provider, enters new key, tests, saves. Old key is overwritten. No key history.
- **Race condition on default**: Use a transaction when setting `isDefault` — clear all, then set one.
- **Deleted default provider**: If the current default is deleted, no provider is default. The UI should surface a warning: "No default provider set."
