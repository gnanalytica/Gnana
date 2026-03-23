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

## Deployment & Infrastructure

- **Production server**: Fly.io (Fly Machines — scale-to-zero, 35+ regions)
- **Production database**: Fly Postgres (with auto-backups)
- **Dashboard**: Vercel (when apps/dashboard is built)
- **Dev database**: Neon free tier (cloud Postgres, zero local setup) or local Postgres
- **CI/CD**: GitHub Actions — test/build on PR, deploy on merge to main
- **Docker**: Production builds only — developers use native `pnpm dev`, never Docker locally
- **Staged deploys**: PR → preview app, main → staging, git tag → production

## Local Dev Setup

- `pnpm install && pnpm dev` — works on Windows, macOS, and Linux
- No Docker required for development
- Postgres via Neon (recommended), Postgres.app (macOS), or local install
- Copy `.env.example` to `.env`, add a DATABASE_URL and at least one LLM API key

## Conventions

- camelCase for all TypeScript interfaces and fields (not snake_case)
- Packages scoped under `@gnana/` (e.g., `@gnana/core`, `@gnana/server`)
- Connectors are tool factories — they produce ToolDefinition[], not execute actions directly
- Hooks over inheritance for consumer customization
- Event bus for decoupling runtime from transport layer
- Cross-platform scripts only — no `rm -rf` in package.json, use node scripts or rimraf

## Commands

- `pnpm install` — install all dependencies
- `pnpm dev` — start all packages in dev mode (Turborepo)
- `pnpm build` — build all packages
- `pnpm test` — run all tests
- `pnpm typecheck` — type-check all packages
- `pnpm format` — format with Prettier
- `pnpm --filter @gnana/db db:generate` — generate Drizzle migration
- `pnpm --filter @gnana/db db:push` — push schema to database

## Environment

- Copy `.env.example` to `.env` for local development
- Requires PostgreSQL (Neon free tier or local) and at least one LLM provider API key
- Server runs on port 4000 by default
- See `.env.example` for all variables with descriptions

## CI/CD Pipeline

- `.github/workflows/ci.yml` — runs on every PR: install, typecheck, build, test
- `.github/workflows/deploy.yml` — runs on push to main: build Docker image, deploy to Fly.io staging
- Production deploy: create a git tag `v*` to promote to production
- Preview apps: PRs get a preview deployment on Fly.io
