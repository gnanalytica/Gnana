# Gnana Dashboard — No-Code Agent Builder Design Spec

## Overview

A no-code dashboard for building, managing, and monitoring AI agents. The dashboard is a Next.js 16 app (`apps/dashboard`) that consumes the Gnana API via `@gnana/client`.

**Goal:** Let anyone — developer or not — create, configure, and monitor AI agents through a visual interface, with progressive disclosure of complexity.

**Core philosophy:** Wizard gets you started fast. Pipeline canvas gives you power. Natural language (future) removes friction entirely.

---

## Architecture

```
apps/dashboard/                      Next.js 16 App Router
├── src/
│   ├── app/                         Route groups (App Router)
│   │   ├── (dashboard)/             Main dashboard layout
│   │   │   ├── page.tsx             Home — stats, recent runs, quick actions
│   │   │   ├── agents/              Agent management
│   │   │   │   ├── page.tsx         Agent library (list, search, create)
│   │   │   │   ├── new/page.tsx     Agent builder wizard
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx     Agent detail — config, run history
│   │   │   │       ├── edit/page.tsx Agent editor (wizard or canvas)
│   │   │   │       └── canvas/page.tsx Pipeline canvas editor
│   │   │   ├── runs/               Run management
│   │   │   │   ├── page.tsx        Run explorer (list, filter, search)
│   │   │   │   └── [id]/page.tsx   Run detail — live pipeline view
│   │   │   ├── connectors/         Connector hub
│   │   │   │   ├── page.tsx        Installed connectors
│   │   │   │   └── store/page.tsx  App store (browse, install)
│   │   │   └── settings/           Workspace settings
│   │   │       ├── page.tsx        General settings
│   │   │       ├── providers/page.tsx LLM provider config
│   │   │       └── api-keys/page.tsx API key management
│   │   └── layout.tsx              Root layout (collapsible sidebar)
│   ├── components/
│   │   ├── layout/                 Sidebar, header, command palette
│   │   ├── agents/                 Wizard steps, agent cards
│   │   ├── canvas/                 Pipeline canvas, node editor
│   │   ├── runs/                   Run timeline, phase viewer
│   │   ├── connectors/             Connector cards, app store
│   │   └── ui/                     shadcn/ui components
│   ├── lib/
│   │   ├── api.ts                  @gnana/client wrapper
│   │   ├── ws.ts                   WebSocket subscription hooks
│   │   └── theme.ts                System preference + toggle
│   └── hooks/                      React hooks
├── tailwind.config.ts
├── next.config.ts
└── package.json
```

**Tech stack:**

- Next.js 16 (App Router, RSC)
- shadcn/ui + Tailwind CSS (dark/light mode, system preference default)
- @xyflow/react (React Flow) for the pipeline canvas
- @gnana/client for API communication
- WebSocket for live run streaming

---

## Layout — Collapsible Sidebar

The dashboard uses a collapsible sidebar (GitHub/Notion style):

- **Collapsed state:** 48px wide, icon-only navigation
- **Expanded state:** 220px wide, icons + labels, on hover or toggle
- **Toggle:** Pin button to lock expanded/collapsed
- **Canvas mode:** Auto-collapses when pipeline canvas is open for maximum space

**Navigation items:**

1. Dashboard (home) — stats, recent runs, quick actions
2. Agents — library, builder, editor
3. Runs — explorer with filters
4. Connectors — installed + app store
5. Settings — providers, API keys, workspace
6. (Bottom) Theme toggle, user menu

**Command palette (⌘K):** Quick access to agents, runs, settings. Search across everything.

---

## Agent Builder — 4-Step Wizard

The primary creation flow. Gets users from zero to a working agent in under 5 minutes.

### Step 1: Identity

- Name, description, avatar (auto-generated from name)
- System prompt (text area with template suggestions)
- "Start from template" dropdown: PM Analyst, Code Reviewer, Report Generator, Support Agent, Data Analyst, Custom
- Templates pre-fill system prompt + suggested tools + model config

### Step 2: Models

- Select LLM for each pipeline phase:
  - **Analysis model** — default: Claude Sonnet
  - **Planning model** — default: Gemini Flash
  - **Execution model** — default: same as analysis
- Dropdown populated from registered providers
- "Test connection" button per model
- Advanced toggle: temperature, max tokens per phase

### Step 3: Tools & Connectors

- **Left panel:** Available tools from installed connectors + MCP servers
- **Right panel:** Selected tools for this agent
- Drag-and-drop or checkbox to add/remove
- Each tool shows: name, description, source connector, icon
- "Browse App Store" button → install new connectors
- "Connect MCP Server" → URL or stdio command
- "Add Custom Tool" → name, description, JSON Schema, webhook URL

### Step 4: Triggers & Approval

- Trigger types (checkbox): manual, webhook, assignment, mention
  - Webhook: auto-generated URL + secret, copy button
  - Manual: "Run Now" button on agent detail page
- Approval mode: Required (default) / Auto-approve / Conditional
- Max execution time: 5 min default, configurable
- "Test Run" button with sample payload → runs the agent and shows result inline

**On completion:** Agent is created via `POST /api/agents`. User is taken to the agent detail page.

---

## Pipeline Canvas — Hybrid Editor

Available from agent detail → "Edit in Canvas" or when creating advanced agents.

### Pipeline View (default)

A structured left-to-right flow mirroring Gnana's 4-phase pipeline:

```
[Trigger] → [Analyze] → [Plan] → [Approve] → [Execute]
```

Each phase is a **lane** (colored section) containing:

- **Model selector** — which LLM handles this phase
- **Tool slots** — which tools are available in this phase
- **Hook slots** — lifecycle callbacks (onAnalysisComplete, onPlanComplete, etc.)
- **Config panel** — click a phase to open a right-side config drawer

The pipeline view is NOT an arbitrary node editor. It enforces Gnana's sequential pipeline structure. This is intentional — it maps 1:1 to the runtime.

### Free-form Sub-canvas (Execute phase)

Within the Execute phase, users can switch to a free-form node editor for complex execution flows:

- Drag-and-drop nodes: tool calls, conditions, loops, sub-agent calls
- Wire connections between nodes
- Supports branching (if/else based on step results)
- Supports parallel execution of independent steps

**Implementation:** Built with @xyflow/react (React Flow). Custom node types for each Gnana concept (tool call, condition, sub-agent, human checkpoint).

### Canvas Node Types

| Node           | Purpose                   | Inputs            | Outputs           |
| -------------- | ------------------------- | ----------------- | ----------------- |
| **Trigger**    | What starts the run       | —                 | trigger payload   |
| **LLM Call**   | Call a model              | prompt, context   | response          |
| **Tool Call**  | Execute a tool            | tool name, input  | result            |
| **Condition**  | Branch on value           | expression        | true/false paths  |
| **Human Gate** | Pause for approval        | plan              | approved/rejected |
| **Sub-Agent**  | Delegate to another agent | agent ID, payload | result            |
| **Output**     | Final result              | data              | —                 |

---

## Run Explorer

### Run List

Paginated, filterable list of all runs across all agents.

**Columns:** Status (color dot), Agent name, Trigger type, Started, Duration, Model, Token usage
**Filters:** Status (analyzing, planning, awaiting_approval, executing, completed, failed), Agent, Date range, Trigger type
**Real-time:** New runs appear at top via WebSocket. Status dots animate during active runs.

### Run Detail — Live Pipeline View

The flagship feature. Shows the full agent reasoning pipeline in real-time.

**Layout:** Horizontal pipeline phases, each expandable:

```
[Trigger] → [Analyzing...] → [Planning] → [Awaiting Approval] → [Executing] → [Completed]
   ✓            ●
```

Each phase expands to show:

- **LLM reasoning** — the full model output, streamed in real-time during active runs
- **Tool calls** — each tool invocation with input/output, timing, success/fail
- **Token usage** — input/output tokens per phase
- **Timing** — duration of each phase

**Approval gate UI:**

- When a run reaches `awaiting_approval`, the plan is displayed with:
  - Structured step list (from the Plan)
  - "Approve" button (green) + "Reject" button (red)
  - Optional modifications text field
  - Who approved/rejected + timestamp

**Live streaming:**

- WebSocket connection to `/ws/runs/:id`
- Text streams token-by-token during analysis/planning
- Tool calls appear as they happen
- Status transitions animate in real-time

---

## Connector Hub & App Store

### Installed Connectors

Grid of cards showing installed connector instances:

- Icon, name, status (active/disconnected)
- Tool count exposed by this connector
- "Test Connection" button
- Last used timestamp

### App Store

Browsable directory of available integrations, powered by Nango for OAuth:

**Categories:** Communication (Slack, Teams, Discord), Development (GitHub, GitLab, Linear, Jira), CRM (HubSpot, Salesforce), Productivity (Notion, Google Workspace, Airtable), Database (Postgres, MySQL, MongoDB), Custom (HTTP API, MCP Server, Webhook)

**Each app card shows:**

- Icon, name, category
- Brief description
- "Install" / "Connected" status
- Tool count

**Install flow:**

1. Click "Install" on an app
2. OAuth redirect (handled by Nango) or API key input
3. On success, connector is created via `POST /api/connectors`
4. Tools auto-discovered and shown
5. Connector available in agent builder wizard (Step 3)

**MCP Server connection:**

- "Add MCP Server" button
- Input: stdio command or HTTP URL
- Auto-discovers available tools
- Added as a connector instance

---

## Settings

### Providers

- Register LLM providers with API keys
- Test connection per provider
- View available models per provider
- Set default model routing (which model for which phase)

### API Keys

- Generate API keys for `@gnana/client` SDK consumers
- Revoke/rotate keys
- Usage stats per key

### General

- Workspace name, timezone
- Default approval mode
- Max concurrent runs
- Theme preference (light/dark/system)

---

## Design System

- **Component library:** shadcn/ui (consistent, accessible, customizable)
- **Styling:** Tailwind CSS with CSS variables for theming
- **Theme:** System preference default with manual toggle (light/dark)
- **Colors:**
  - Pipeline phases: purple (trigger), blue (analyze), green (plan), amber (approve), pink (execute)
  - Status: green (completed), amber (awaiting), blue (active), red (failed), gray (queued)
- **Typography:** Inter (UI), JetBrains Mono (code/prompts)
- **Icons:** Lucide Icons (consistent with shadcn/ui)
- **Canvas:** @xyflow/react with custom themed nodes matching the design system

---

## Data Flow

```
Dashboard (Next.js)
    │
    ├── REST: @gnana/client SDK
    │   ├── GET/POST /api/agents
    │   ├── GET/POST /api/runs
    │   ├── POST /api/runs/:id/approve
    │   ├── GET/POST /api/connectors
    │   └── GET /api/providers
    │
    └── WebSocket: /ws/runs/:id
        ├── run:status_changed
        ├── run:analysis_complete
        ├── run:plan_complete
        ├── run:tool_called
        ├── run:tool_result
        └── run:token (streaming)
```

The dashboard is a **pure API consumer**. No direct database access. Everything goes through `@gnana/server` via `@gnana/client`.

---

## v1 Page Summary

| Page                 | Priority | Description                            |
| -------------------- | -------- | -------------------------------------- |
| Dashboard home       | P0       | Stats, recent runs, quick actions      |
| Agent library        | P0       | List, search, create agents            |
| Agent builder wizard | P0       | 4-step creation flow                   |
| Agent detail         | P0       | Config, run history, edit, canvas      |
| Pipeline canvas      | P0       | Hybrid pipeline + free-form editor     |
| Run explorer         | P0       | List, filter, search runs              |
| Run detail (live)    | P0       | Real-time pipeline view with streaming |
| Connector hub        | P1       | Installed connectors                   |
| App store            | P1       | Browse, install integrations (Nango)   |
| Settings / Providers | P1       | LLM provider config                    |
| Settings / API keys  | P1       | Key management                         |
| Command palette (⌘K) | P1       | Quick search across everything         |

---

## Not in v1

- Natural language agent creation (Phase 3)
- Multi-agent orchestration / crew builder (Phase 4)
- Flow builder with visual sub-workflows (Phase 4)
- Usage analytics and cost dashboard (Phase 4)
- Multi-tenancy / workspace switching (Phase 4)
- Scheduled/cron triggers (Phase 2)
- Prompt IDE / A/B testing (Phase 3)
