# Gnana Agent Framework

Provider-agnostic AI agent framework with a no-code builder. See `docs/DESIGN.md` for full architecture spec.

## Architecture

- pnpm monorepo + Turborepo with packages under `packages/` and apps under `apps/`
- 4-phase agent pipeline: Analyze → Plan → Approve → Execute
- Packages: core, server (Hono), client SDK, db (Drizzle), providers (anthropic/google/openai), mcp, connectors
- Dashboard: Next.js app under `apps/dashboard/`

## Tech Stack

- Runtime: Node.js 22+ / Bun
- Language: TypeScript (strict) throughout — no loose JS
- Server: Hono (lightweight, universal)
- Database: PostgreSQL + Drizzle ORM
- Dashboard: Next.js 16 + shadcn/ui + Tailwind
- Monorepo: pnpm workspaces + Turborepo
- MCP: @modelcontextprotocol/sdk

## Conventions

- camelCase for all TypeScript interfaces and fields (not snake_case)
- Packages scoped under `@gnana/` (e.g., `@gnana/core`, `@gnana/server`)
- Connectors are tool factories — they produce ToolDefinition[], not execute actions directly
- Hooks over inheritance for consumer customization
- Event bus for decoupling runtime from transport layer

## Commands

- `pnpm install` — install all dependencies
- `pnpm dev` — start development
- `pnpm build` — build all packages (via Turborepo)

## Environment

- Copy `.env.example` to `.env` for local development
- Requires PostgreSQL and at least one LLM provider API key
- Server runs on port 4000 by default
