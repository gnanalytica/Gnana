# Gnana SaaS Platform — Design Specification

## Overview

Transform Gnana from a developer tool into a multi-tenant SaaS platform with full authentication, role-based access control, real-time streaming, pre-built connectors, and billing infrastructure.

---

## Sub-project 1: Auth & Identity

### Approach

Auth.js (NextAuth v5) on the Next.js dashboard handles all authentication flows. The Hono API server validates JWTs issued by Auth.js. This keeps auth logic in one place (dashboard) while the API stays stateless.

### Auth Providers

- **Google OAuth** — via `@auth/core/providers/google`
- **GitHub OAuth** — via `@auth/core/providers/github`
- **Email/Password** — via `@auth/core/providers/credentials` with bcrypt password hashing

### Database Schema (new tables)

```sql
-- Auth.js required tables (Drizzle adapter)
users (
  id            uuid PK DEFAULT gen_random_uuid(),
  name          text,
  email         text UNIQUE NOT NULL,
  email_verified timestamp,
  image         text,
  password_hash text,              -- null for OAuth users
  created_at    timestamp DEFAULT now(),
  updated_at    timestamp DEFAULT now()
)

accounts (
  id                   uuid PK DEFAULT gen_random_uuid(),
  user_id              uuid FK -> users.id ON DELETE CASCADE,
  type                 text NOT NULL,       -- "oauth" | "credentials"
  provider             text NOT NULL,       -- "google" | "github" | "credentials"
  provider_account_id  text NOT NULL,
  refresh_token        text,
  access_token         text,
  expires_at           integer,
  token_type           text,
  scope                text,
  id_token             text,
  UNIQUE(provider, provider_account_id)
)

sessions (
  id            uuid PK DEFAULT gen_random_uuid(),
  session_token text UNIQUE NOT NULL,
  user_id       uuid FK -> users.id ON DELETE CASCADE,
  expires       timestamp NOT NULL
)

verification_tokens (
  identifier    text NOT NULL,
  token         text UNIQUE NOT NULL,
  expires       timestamp NOT NULL,
  PRIMARY KEY (identifier, token)
)
```

### Auth Flow

1. User visits dashboard → Auth.js middleware checks session
2. No session → redirect to `/auth/signin`
3. Sign in via Google/GitHub/Email → Auth.js creates session + JWT
4. Dashboard includes JWT in API calls (`Authorization: Bearer <jwt>`)
5. Hono API middleware validates JWT signature and extracts `userId`
6. API resolves user's workspace from `userId` for scoped queries

### Dashboard Changes

- New route group: `app/(auth)/` with signin, signup, error pages
- Auth.js config in `auth.ts` at dashboard root
- Middleware in `middleware.ts` to protect `/(dashboard)/` routes
- Session provider wrapping the app layout

### API Changes

- New middleware: `authMiddleware` on all `/api/*` routes
- Validates JWT from Authorization header
- Extracts `userId` and `workspaceId` into Hono context
- Public routes exempt: `/health`, `/api/auth/*`

---

## Sub-project 2: Multi-tenancy & RBAC

### Tenancy Model

User-first with optional teams:

- Every user gets a **personal workspace** on signup (auto-created)
- Users can create **team workspaces** and invite members
- All resources (agents, runs, connectors, providers, API keys) are scoped to a workspace
- Users switch between workspaces in the dashboard

### Database Schema (new/modified tables)

```sql
-- Modify existing workspaces table
workspaces (
  id          uuid PK,
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  type        text NOT NULL DEFAULT 'personal',  -- 'personal' | 'team'
  owner_id    uuid FK -> users.id,               -- NEW
  plan_id     uuid FK -> plans.id,               -- NEW (sub-project 3)
  created_at  timestamp,
  updated_at  timestamp
)

-- NEW: workspace membership
workspace_members (
  id            uuid PK DEFAULT gen_random_uuid(),
  workspace_id  uuid FK -> workspaces.id ON DELETE CASCADE,
  user_id       uuid FK -> users.id ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'viewer',  -- 'owner' | 'admin' | 'editor' | 'viewer'
  invited_by    uuid FK -> users.id,
  accepted_at   timestamp,                       -- null = pending invite
  created_at    timestamp DEFAULT now(),
  UNIQUE(workspace_id, user_id)
)

-- NEW: workspace invites
workspace_invites (
  id            uuid PK DEFAULT gen_random_uuid(),
  workspace_id  uuid FK -> workspaces.id ON DELETE CASCADE,
  email         text NOT NULL,
  role          text NOT NULL DEFAULT 'viewer',
  invited_by    uuid FK -> users.id,
  token         text UNIQUE NOT NULL,
  expires_at    timestamp NOT NULL,
  created_at    timestamp DEFAULT now()
)
```

### Role Permissions

| Action                      | Owner | Admin | Editor | Viewer |
| --------------------------- | ----- | ----- | ------ | ------ |
| View agents/runs/connectors | Yes   | Yes   | Yes    | Yes    |
| Create/edit agents          | Yes   | Yes   | Yes    | No     |
| Trigger runs                | Yes   | Yes   | Yes    | No     |
| Approve/reject runs         | Yes   | Yes   | Yes    | No     |
| Manage connectors           | Yes   | Yes   | No     | No     |
| Manage providers/API keys   | Yes   | Yes   | No     | No     |
| Invite/remove members       | Yes   | Yes   | No     | No     |
| Change member roles         | Yes   | Yes   | No     | No     |
| Delete workspace            | Yes   | No    | No     | No     |
| Billing/plan changes        | Yes   | No    | No     | No     |

### API Changes

- Workspace-scoped middleware: resolves `workspaceId` from header (`X-Workspace-Id`) or default
- Role-checking middleware: `requireRole('editor')` etc.
- New routes: `/api/workspaces`, `/api/workspaces/:id/members`, `/api/workspaces/:id/invites`
- Modify existing `apiKeys` table: add `created_by` FK to users

### Dashboard Changes

- Workspace switcher in sidebar
- Team settings page: members list, invite form, role management
- Invite accept flow page

---

## Sub-project 3: Plans & Billing Scaffold

### Database Schema

```sql
plans (
  id              uuid PK DEFAULT gen_random_uuid(),
  name            text NOT NULL,           -- 'free' | 'pro' | 'enterprise'
  display_name    text NOT NULL,
  max_agents      integer NOT NULL,
  max_runs_month  integer NOT NULL,
  max_members     integer NOT NULL,
  max_connectors  integer NOT NULL,
  features        jsonb NOT NULL DEFAULT '{}',  -- feature flags
  price_monthly   integer NOT NULL DEFAULT 0,   -- cents
  price_yearly    integer NOT NULL DEFAULT 0,   -- cents
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamp DEFAULT now()
)

-- Seed data
INSERT INTO plans VALUES
  ('free',       'Free',       3, 100, 1,  3,  '{}', 0, 0),
  ('pro',        'Pro',        25, 5000, 10, 25, '{"priority_support": true}', 2900, 29000),
  ('enterprise', 'Enterprise', -1, -1, -1, -1, '{"sso": true, "audit_log": true}', 0, 0);

usage_records (
  id            uuid PK DEFAULT gen_random_uuid(),
  workspace_id  uuid FK -> workspaces.id,
  period        text NOT NULL,            -- '2026-03' (year-month)
  runs_count    integer NOT NULL DEFAULT 0,
  tokens_used   bigint NOT NULL DEFAULT 0,
  updated_at    timestamp DEFAULT now()
)
```

### Implementation

- Feature gate middleware: checks workspace plan limits before creating agents/runs
- Usage tracking: increment counters on run creation/completion
- Dashboard: settings/billing page showing current plan, usage, upgrade CTA
- No Stripe integration yet — just the data model and enforcement

---

## Sub-project 4: WebSocket Server

### Approach

Use Hono's WebSocket support via `@hono/node-server/ws` for the Hono API server. The event bus bridges server events to connected WebSocket clients.

### Protocol

```
Client connects: ws://server/ws/runs/:runId
  → Server authenticates via query param token or cookie
  → Server subscribes to event bus for that runId
  → Server pushes events as JSON messages

Message format:
{
  "event": "run:status_changed",
  "data": { "runId": "...", "status": "analyzing", ... },
  "timestamp": "2026-03-23T..."
}
```

### Events Streamed

- `run:status_changed` — stage transitions
- `run:log` — new log entries (analysis text, plan output, tool calls)
- `run:tool_called` — tool invocation start
- `run:tool_result` — tool result returned
- `run:completed` — final result
- `run:failed` — error occurred

### Implementation

- WebSocket upgrade handler in server
- Connection manager: tracks active connections per runId
- Event bus listener: forwards matching events to connected clients
- Auth: validate JWT from query param on connection
- Heartbeat/ping-pong for connection health

---

## Sub-project 5: Connectors

### Architecture

Connectors live in `packages/connectors/`. Each connector is a **tool factory** — it takes credentials/config and returns `ToolDefinition[]`.

```typescript
interface ConnectorFactory {
  type: string; // "http" | "github" | "slack"
  name: string;
  description: string;
  configSchema: JSONSchema; // what config fields the connector needs
  credentialFields: CredentialField[]; // what auth is needed
  createTools(config: ConnectorConfig): ToolDefinition[];
}
```

### Connectors to Build

**HTTP Connector** (`packages/connectors/http/`)

- Generic REST API connector
- Config: baseUrl, headers, auth (bearer/basic/api-key)
- Tools generated: one per endpoint defined in config
- Tool schema: method, path, query params, body

**GitHub Connector** (`packages/connectors/github/`)

- Auth: GitHub personal access token or OAuth app token
- Tools: list_repos, get_issue, create_issue, list_prs, get_pr, create_pr, get_file, search_code
- Uses Octokit SDK

**Slack Connector** (`packages/connectors/slack/`)

- Auth: Slack Bot OAuth token
- Tools: send_message, list_channels, read_channel, search_messages, add_reaction
- Uses Slack Web API SDK

### Registration Flow

1. User selects connector type in dashboard connector store
2. Fills in credentials and config
3. POST /api/connectors creates DB record with encrypted credentials
4. Connector factory generates tool definitions, saved to connector_tools table
5. When agent uses connector, tools are loaded from DB and executed via factory

---

## Sub-project 6: Tests & Migrations

### Test Strategy

- **Framework**: Vitest (already configured)
- **Coverage targets**: Core pipeline, server routes, auth middleware, RBAC

### Test Suites

```
packages/core/src/__tests__/
  pipeline.test.ts       — 4-phase pipeline with mock LLM
  llm-router.test.ts     — routing, retries, fallbacks
  tool-executor.test.ts  — tool registration and execution
  event-bus.test.ts      — pub/sub behavior

packages/server/src/__tests__/
  agents.test.ts         — CRUD endpoints
  runs.test.ts           — run lifecycle endpoints
  auth.test.ts           — JWT validation middleware
  rbac.test.ts           — role permission checks

packages/connectors/http/src/__tests__/
  http-connector.test.ts — tool generation and execution
```

### Database Migrations

- Generate initial migration from current schema: `pnpm --filter @gnana/db db:generate`
- Commit migration files to `packages/db/drizzle/` directory
- Add migration command to CI pipeline

---

## Implementation Order

1. **Auth & Identity** — foundation, everything depends on it
2. **Multi-tenancy & RBAC** — workspace scoping for all resources
3. **Plans & Billing scaffold** — limits enforcement
4. **WebSocket server** — real-time run streaming
5. **Connectors** — HTTP, GitHub, Slack
6. **Tests & Migrations** — validate everything, commit schema

Each sub-project is a separate PR-sized chunk that can be built, tested, and deployed independently.
