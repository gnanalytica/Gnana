# Gnana

**Provider-agnostic AI agent framework with a no-code builder.**

Build, orchestrate, and deploy intelligent agents that analyze, plan, and execute — across any LLM provider, any tool, any workflow.

## What is Gnana?

Gnana (Sanskrit: knowledge/wisdom) is a standalone agent orchestration framework that lets you:

- **Define agents** with custom tools, system prompts, and model routing
- **Use any LLM** — Claude, Gemini, GPT, OpenRouter (200+ models), or your own
- **Connect tools** via MCP protocol or custom handlers
- **Build visually** with a no-code agent builder and connector hub
- **Integrate anywhere** via REST API, WebSocket, and TypeScript SDK

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  CONSUMERS (your apps)                                       │
│  PM Tool    CRM    Slack Bot    Dashboard                    │
│       └────────┴────────┴──────────┘                         │
│                    @gnana/client SDK                          │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│  GNANA SERVER                                                │
│  REST API + WebSocket (Hono)                                 │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Agent Runtime (@gnana/core)                         │    │
│  │  Pipeline: Analyze → Plan → Approve → Execute        │    │
│  │  LLM Router: Anthropic | Google | OpenAI | OpenRouter│    │
│  │  Tools: MCP Servers + Custom Handlers + Connectors   │    │
│  └──────────────────────────────────────────────────────┘    │
│  PostgreSQL (Drizzle ORM)                                    │
└──────────────────────────────────────────────────────────────┘
```

## Packages

| Package                     | Description                                        |
| --------------------------- | -------------------------------------------------- |
| `@gnana/core`               | Agent runtime, pipeline engine, tool system, hooks |
| `@gnana/server`             | HTTP + WebSocket server (Hono)                     |
| `@gnana/client`             | TypeScript SDK for consumers                       |
| `@gnana/db`                 | Database schema + migrations (Drizzle)             |
| `@gnana/provider-anthropic` | Claude provider                                    |
| `@gnana/provider-google`    | Gemini provider                                    |
| `@gnana/provider-openai`    | OpenAI + OpenRouter provider                       |
| `@gnana/mcp`                | MCP client integration                             |

## Quick Start

```bash
# Install
pnpm install

# Configure
cp .env.example .env
# Add at least one LLM provider key

# Start
pnpm dev
```

## Status

**Pre-alpha** — Design spec complete, implementation starting. See [docs/DESIGN.md](docs/DESIGN.md) for the full architecture.

## License

MIT
