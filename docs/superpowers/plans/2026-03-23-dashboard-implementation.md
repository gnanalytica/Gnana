# Dashboard — No-Code Agent Builder Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Gnana no-code dashboard — a Next.js app with agent builder wizard, hybrid pipeline canvas, live run explorer, connector hub, and app store.

**Architecture:** Next.js 16 App Router app at `apps/dashboard/` consuming `@gnana/server` via `@gnana/client`. shadcn/ui for components, Tailwind for styling, React Flow for pipeline canvas, WebSocket for live streaming. Pure API consumer — no direct DB access.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui, @xyflow/react, @gnana/client, Lucide Icons

**Spec:** `docs/superpowers/specs/2026-03-23-no-code-dashboard-design.md`

---

## File Structure

```
apps/dashboard/
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── postcss.config.js
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root layout — providers, fonts
│   │   ├── globals.css                   # Tailwind + CSS variables
│   │   └── (dashboard)/
│   │       ├── layout.tsx                # Dashboard layout — collapsible sidebar
│   │       ├── page.tsx                  # Home — stats, recent runs
│   │       ├── agents/
│   │       │   ├── page.tsx              # Agent library
│   │       │   ├── new/page.tsx          # Agent builder wizard
│   │       │   └── [id]/
│   │       │       ├── page.tsx          # Agent detail
│   │       │       └── canvas/page.tsx   # Pipeline canvas editor
│   │       ├── runs/
│   │       │   ├── page.tsx              # Run explorer
│   │       │   └── [id]/page.tsx         # Run detail (live)
│   │       ├── connectors/
│   │       │   ├── page.tsx              # Installed connectors
│   │       │   └── store/page.tsx        # App store
│   │       └── settings/
│   │           ├── page.tsx              # General settings
│   │           ├── providers/page.tsx    # LLM providers
│   │           └── api-keys/page.tsx     # API keys
│   ├── components/
│   │   ├── layout/
│   │   │   ├── sidebar.tsx              # Collapsible sidebar
│   │   │   ├── sidebar-item.tsx         # Nav item (icon + label)
│   │   │   ├── command-palette.tsx      # ⌘K search
│   │   │   └── theme-toggle.tsx         # Dark/light/system toggle
│   │   ├── agents/
│   │   │   ├── agent-card.tsx           # Card in agent library
│   │   │   ├── wizard/
│   │   │   │   ├── wizard-shell.tsx     # Step nav + container
│   │   │   │   ├── step-identity.tsx    # Step 1
│   │   │   │   ├── step-models.tsx      # Step 2
│   │   │   │   ├── step-tools.tsx       # Step 3
│   │   │   │   └── step-triggers.tsx    # Step 4
│   │   │   └── templates.ts            # Agent template definitions
│   │   ├── canvas/
│   │   │   ├── pipeline-canvas.tsx      # Main canvas component
│   │   │   ├── pipeline-lane.tsx        # Phase lane (analyze, plan, etc.)
│   │   │   ├── nodes/
│   │   │   │   ├── trigger-node.tsx
│   │   │   │   ├── llm-node.tsx
│   │   │   │   ├── tool-node.tsx
│   │   │   │   ├── condition-node.tsx
│   │   │   │   ├── human-gate-node.tsx
│   │   │   │   └── output-node.tsx
│   │   │   └── config-drawer.tsx        # Right-side config panel
│   │   ├── runs/
│   │   │   ├── run-list.tsx             # Paginated run table
│   │   │   ├── run-filters.tsx          # Status, agent, date filters
│   │   │   ├── pipeline-view.tsx        # Horizontal phase timeline
│   │   │   ├── phase-detail.tsx         # Expandable phase content
│   │   │   ├── tool-call-card.tsx       # Tool invocation display
│   │   │   ├── approval-gate.tsx        # Approve/reject UI
│   │   │   └── streaming-text.tsx       # Token-by-token text renderer
│   │   ├── connectors/
│   │   │   ├── connector-card.tsx       # Installed connector card
│   │   │   ├── app-card.tsx             # App store card
│   │   │   └── install-dialog.tsx       # OAuth/API key install flow
│   │   └── ui/                          # shadcn/ui components (generated)
│   ├── lib/
│   │   ├── api.ts                       # GnanaClient singleton
│   │   ├── hooks/
│   │   │   ├── use-agents.ts            # Agent CRUD hooks
│   │   │   ├── use-runs.ts              # Run hooks + WebSocket
│   │   │   ├── use-connectors.ts        # Connector hooks
│   │   │   └── use-providers.ts         # Provider hooks
│   │   ├── ws.ts                        # WebSocket manager
│   │   └── utils.ts                     # Formatting, dates, etc.
│   └── types/
│       └── index.ts                     # Dashboard-specific types
```

---

## Chunk 1: App Scaffold + Layout

### Task 1: Next.js app scaffold

**Files:**

- Create: `apps/dashboard/package.json`
- Create: `apps/dashboard/next.config.ts`
- Create: `apps/dashboard/tsconfig.json`
- Create: `apps/dashboard/tailwind.config.ts`
- Create: `apps/dashboard/postcss.config.js`
- Create: `apps/dashboard/src/app/globals.css`
- Create: `apps/dashboard/src/app/layout.tsx`
- Modify: `pnpm-workspace.yaml` (add `apps/*`)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@gnana/dashboard",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@gnana/client": "workspace:*",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "lucide-react": "^0.468.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.6.0",
    "next-themes": "^0.4.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create next.config.ts, tsconfig.json, tailwind.config.ts, postcss.config.js**

Standard Next.js 15+ config files. `tsconfig.json` extends `../../tsconfig.base.json` with `jsx: "preserve"`, path aliases `@/*` → `./src/*`. Tailwind config includes `darkMode: "class"`, content paths pointing to `./src/**/*.{ts,tsx}`, custom colors for pipeline phases.

- [ ] **Step 3: Create globals.css with CSS variables for theming**

Tailwind directives + CSS custom properties for light/dark theme. Define phase colors: `--phase-trigger`, `--phase-analyze`, `--phase-plan`, `--phase-approve`, `--phase-execute`. Status colors: `--status-completed`, `--status-failed`, etc.

- [ ] **Step 4: Create root layout.tsx**

Root layout with Inter + JetBrains Mono fonts, `ThemeProvider` from `next-themes`, metadata.

- [ ] **Step 5: Verify pnpm-workspace.yaml includes apps/**

Check `pnpm-workspace.yaml` already has `apps/*` pattern (it should from Phase 1 setup).

- [ ] **Step 6: Install dependencies and verify dev server starts**

Run: `pnpm install && pnpm --filter @gnana/dashboard dev`
Expected: Next.js dev server on http://localhost:3000

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/ pnpm-lock.yaml
git commit -m "feat: dashboard scaffold — Next.js 16, Tailwind, shadcn/ui theme"
```

---

### Task 2: shadcn/ui setup + base components

**Files:**

- Create: `apps/dashboard/components.json`
- Create: `apps/dashboard/src/lib/utils.ts`
- Create: `apps/dashboard/src/components/ui/` (generated by shadcn)

- [ ] **Step 1: Initialize shadcn/ui**

Run: `cd apps/dashboard && npx shadcn@latest init`
Select: New York style, Zinc base color, CSS variables.

- [ ] **Step 2: Add essential components**

Run: `npx shadcn@latest add button card input label select textarea tabs badge dialog dropdown-menu separator tooltip sheet command scroll-area avatar`

- [ ] **Step 3: Verify components render**

Create a minimal test page that renders a Button. Run dev server and check.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/
git commit -m "feat: shadcn/ui components — button, card, input, dialog, command palette"
```

---

### Task 3: Collapsible sidebar + dashboard layout

**Files:**

- Create: `apps/dashboard/src/components/layout/sidebar.tsx`
- Create: `apps/dashboard/src/components/layout/sidebar-item.tsx`
- Create: `apps/dashboard/src/components/layout/theme-toggle.tsx`
- Create: `apps/dashboard/src/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Build SidebarItem component**

A nav link component that shows icon-only when collapsed, icon+label when expanded. Uses `lucide-react` icons. Active state with colored background. Props: `icon`, `label`, `href`, `active`.

- [ ] **Step 2: Build Sidebar component**

Collapsible sidebar with:

- `isCollapsed` state (default: collapsed)
- Expand on hover (with 200ms delay to prevent flicker)
- Pin/unpin button to lock state
- Nav items: Home, Agents, Runs, Connectors, Settings
- Bottom section: theme toggle, user avatar

Width: 48px collapsed, 220px expanded. Transition: 200ms ease.

- [ ] **Step 3: Build ThemeToggle component**

Three-state toggle: System / Light / Dark. Uses `next-themes` `useTheme()`. Renders Sun/Moon/Monitor icons.

- [ ] **Step 4: Build dashboard layout**

`apps/dashboard/src/app/(dashboard)/layout.tsx`:

- Renders Sidebar on the left
- Main content area with `{children}` on the right
- Responsive: sidebar hidden on mobile, hamburger menu instead

- [ ] **Step 5: Create placeholder home page**

`apps/dashboard/src/app/(dashboard)/page.tsx`:
Simple "Welcome to Gnana" with stats placeholders.

- [ ] **Step 6: Verify sidebar works**

Run dev server. Check: collapsed state, hover expand, pin toggle, navigation links, theme toggle, responsive behavior.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/
git commit -m "feat: collapsible sidebar layout with theme toggle"
```

---

### Task 4: API client wrapper + hooks

**Files:**

- Create: `apps/dashboard/src/lib/api.ts`
- Create: `apps/dashboard/src/lib/ws.ts`
- Create: `apps/dashboard/src/lib/hooks/use-agents.ts`
- Create: `apps/dashboard/src/lib/hooks/use-runs.ts`
- Create: `apps/dashboard/src/lib/hooks/use-connectors.ts`
- Create: `apps/dashboard/src/lib/hooks/use-providers.ts`
- Create: `apps/dashboard/src/types/index.ts`

- [ ] **Step 1: Create API client singleton**

`apps/dashboard/src/lib/api.ts`:

```typescript
import { GnanaClient } from "@gnana/client";

export const api = new GnanaClient({
  url: process.env.NEXT_PUBLIC_GNANA_API_URL ?? "http://localhost:4000",
  apiKey: process.env.NEXT_PUBLIC_GNANA_API_KEY,
});
```

- [ ] **Step 2: Create dashboard types**

`apps/dashboard/src/types/index.ts`:
Define TypeScript types for Agent, Run, Connector, Provider matching the API response shapes. These are the dashboard's view of the data (not the backend types — those live in `@gnana/core`).

- [ ] **Step 3: Create useAgents hook**

React hook wrapping `api.agents.*` methods. Returns `{ agents, isLoading, create, update, delete }`. Uses React `useState` + `useEffect` for now (can upgrade to SWR/React Query later).

- [ ] **Step 4: Create useRuns hook**

React hook wrapping `api.runs.*` with WebSocket subscription. Returns `{ runs, isLoading, trigger, approve, reject, subscribe }`.

- [ ] **Step 5: Create WebSocket manager**

`apps/dashboard/src/lib/ws.ts`:
Thin wrapper over `api.runs.subscribe()` that handles reconnection and provides a React hook `useRunStream(runId)` returning real-time events.

- [ ] **Step 6: Create useConnectors and useProviders hooks**

Same pattern as useAgents.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/lib/ apps/dashboard/src/types/
git commit -m "feat: API client wrapper, React hooks, WebSocket manager"
```

---

## Chunk 2: Dashboard Home + Agent Library

### Task 5: Dashboard home page

**Files:**

- Create: `apps/dashboard/src/app/(dashboard)/page.tsx`

- [ ] **Step 1: Build stats cards row**

Three cards: Active Agents (count), Runs Today (count), Awaiting Approval (count with amber highlight). Data from `useAgents()` and `useRuns()`.

- [ ] **Step 2: Build recent runs list**

Last 5 runs in a compact table. Status badge, agent name, trigger type, time ago. Click → navigate to `/runs/:id`.

- [ ] **Step 3: Build quick actions**

Buttons: "Create Agent" → `/agents/new`, "View All Runs" → `/runs`. Prominent "Create Agent" CTA.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(dashboard\)/page.tsx
git commit -m "feat: dashboard home — stats cards, recent runs, quick actions"
```

---

### Task 6: Agent library page

**Files:**

- Create: `apps/dashboard/src/app/(dashboard)/agents/page.tsx`
- Create: `apps/dashboard/src/components/agents/agent-card.tsx`

- [ ] **Step 1: Build AgentCard component**

Card showing: name, description (truncated), model badge, tool count, trigger types, last run time. Click → `/agents/:id`.

- [ ] **Step 2: Build agents list page**

Header: "Agents" title + "Create Agent" button (→ `/agents/new`).
Search bar (filters by name/description).
Grid of AgentCards. Empty state: "No agents yet. Create your first agent."

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/
git commit -m "feat: agent library — grid view with search and create button"
```

---

### Task 7: Agent detail page

**Files:**

- Create: `apps/dashboard/src/app/(dashboard)/agents/[id]/page.tsx`

- [ ] **Step 1: Build agent detail page**

Header: Agent name + "Edit" button + "Edit in Canvas" button + "Run Now" button.
Tabs: Overview | Run History | Configuration.

**Overview tab:** System prompt preview, model config table, tool list, trigger list.
**Run History tab:** Filtered run list for this agent (reuse RunList component from chunk 5).
**Configuration tab:** Raw JSON view of agent config.

- [ ] **Step 2: Implement "Run Now" button**

Triggers `api.runs.trigger({ agentId, payload: {} })`. Shows toast on success. Navigates to run detail page.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(dashboard\)/agents/
git commit -m "feat: agent detail page — overview, run history, configuration tabs"
```

---

## Chunk 3: Agent Builder Wizard

### Task 8: Wizard shell

**Files:**

- Create: `apps/dashboard/src/components/agents/wizard/wizard-shell.tsx`
- Create: `apps/dashboard/src/app/(dashboard)/agents/new/page.tsx`

- [ ] **Step 1: Build WizardShell component**

Step indicator at top: Identity → Models → Tools → Triggers. Shows current step highlighted. Back/Next buttons at bottom. Stores wizard state in React state (not URL).

Props: `steps: WizardStep[]`, `onComplete: (data) => void`.

- [ ] **Step 2: Wire up the new agent page**

`agents/new/page.tsx` renders WizardShell with 4 steps. On complete, calls `api.agents.create(data)` and navigates to `/agents/:id`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/
git commit -m "feat: wizard shell — step navigation, state management"
```

---

### Task 9: Step 1 — Identity

**Files:**

- Create: `apps/dashboard/src/components/agents/wizard/step-identity.tsx`
- Create: `apps/dashboard/src/components/agents/templates.ts`

- [ ] **Step 1: Build template definitions**

`templates.ts`: Array of templates with name, description, systemPrompt, suggestedTools, modelConfig. Templates: PM Analyst, Code Reviewer, Report Generator, Support Agent, Data Analyst, Custom.

- [ ] **Step 2: Build StepIdentity component**

Form fields: Name (input), Description (textarea), System Prompt (textarea with character count).
"Start from template" dropdown — selecting a template fills in system prompt and pre-selects tools/models for later steps.
Auto-generated avatar from first letter of name.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/agents/
git commit -m "feat: wizard step 1 — identity with templates"
```

---

### Task 10: Step 2 — Models

**Files:**

- Create: `apps/dashboard/src/components/agents/wizard/step-models.tsx`

- [ ] **Step 1: Build StepModels component**

Three model selectors (dropdowns), one per pipeline phase:

- Analysis Model (required)
- Planning Model (required)
- Execution Model (optional, defaults to analysis model)

Dropdowns populated from `useProviders()` → list models per provider. Grouped by provider name.

"Advanced" collapsible section: temperature slider (0-1), max tokens input per phase.

"Test Connection" button per model — calls a simple test endpoint.

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/agents/wizard/step-models.tsx
git commit -m "feat: wizard step 2 — model selection per pipeline phase"
```

---

### Task 11: Step 3 — Tools & Connectors

**Files:**

- Create: `apps/dashboard/src/components/agents/wizard/step-tools.tsx`

- [ ] **Step 1: Build StepTools component**

Two-panel layout:

- **Left panel:** "Available Tools" — grouped by connector. Each tool: checkbox, name, description, connector icon. Search/filter bar.
- **Right panel:** "Selected Tools" — list of checked tools with remove button.

Data from `useConnectors()` → for each connector, list its tools.

Buttons at bottom: "Browse App Store" (link to `/connectors/store`), "Add MCP Server" (dialog: URL or command input), "Add Custom Tool" (dialog: name, description, JSON schema, webhook URL).

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/agents/wizard/step-tools.tsx
git commit -m "feat: wizard step 3 — tool selection with connector grouping"
```

---

### Task 12: Step 4 — Triggers & Approval

**Files:**

- Create: `apps/dashboard/src/components/agents/wizard/step-triggers.tsx`

- [ ] **Step 1: Build StepTriggers component**

**Trigger types** (checkboxes):

- Manual (always enabled)
- Webhook — shows auto-generated URL + secret with copy buttons
- Assignment — config for which field triggers
- Mention — config for mention pattern

**Approval mode** (radio buttons):

- Required (default) — human must approve every plan
- Auto-approve — pipeline runs without stopping
- Conditional — rule builder (future, disabled in v1)

**Max execution time:** Number input, default 5 minutes.

**Test Run** button — triggers a run with sample payload inline. Shows result in a dialog.

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/agents/wizard/step-triggers.tsx
git commit -m "feat: wizard step 4 — triggers, approval mode, test run"
```

---

## Chunk 4: Pipeline Canvas

### Task 13: React Flow setup

**Files:**

- Modify: `apps/dashboard/package.json` (add @xyflow/react)
- Create: `apps/dashboard/src/components/canvas/pipeline-canvas.tsx`
- Create: `apps/dashboard/src/app/(dashboard)/agents/[id]/canvas/page.tsx`

- [ ] **Step 1: Add @xyflow/react dependency**

Run: `pnpm --filter @gnana/dashboard add @xyflow/react`

- [ ] **Step 2: Build PipelineCanvas component**

Wrapper around `<ReactFlow>` with:

- Custom dark/light theme matching Gnana design system
- Controls (zoom, fit view)
- Background (dots pattern)
- MiniMap (bottom-right)
- Auto-layout: left-to-right (dagre or elk)

- [ ] **Step 3: Create canvas page**

`agents/[id]/canvas/page.tsx`: Loads agent config, renders PipelineCanvas. Auto-collapses sidebar on mount.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/
git commit -m "feat: pipeline canvas — React Flow setup with themed canvas"
```

---

### Task 14: Pipeline lane view

**Files:**

- Create: `apps/dashboard/src/components/canvas/pipeline-lane.tsx`

- [ ] **Step 1: Build PipelineLane component**

A structured node representing one pipeline phase. Contains:

- Phase label (colored: purple/blue/green/amber/pink)
- Model selector dropdown
- Tool slots (list of assigned tools)
- Hook indicators (icons showing active hooks)
- Click to open config drawer

Each lane is a custom React Flow node type.

- [ ] **Step 2: Build initial pipeline from agent config**

Function `agentToNodes(agent)` that converts an AgentDefinition into React Flow nodes + edges:

- Trigger node → Analyze lane → Plan lane → Approve gate → Execute lane

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/canvas/
git commit -m "feat: pipeline lane nodes — structured phase view"
```

---

### Task 15: Custom node types

**Files:**

- Create: `apps/dashboard/src/components/canvas/nodes/trigger-node.tsx`
- Create: `apps/dashboard/src/components/canvas/nodes/llm-node.tsx`
- Create: `apps/dashboard/src/components/canvas/nodes/tool-node.tsx`
- Create: `apps/dashboard/src/components/canvas/nodes/condition-node.tsx`
- Create: `apps/dashboard/src/components/canvas/nodes/human-gate-node.tsx`
- Create: `apps/dashboard/src/components/canvas/nodes/output-node.tsx`

- [ ] **Step 1: Build custom node components**

Each node type: styled card with icon, title, connection handles (inputs on left, outputs on right), and brief config display. Match the design system colors.

- [ ] **Step 2: Register node types with React Flow**

Create `nodeTypes` map and pass to `<ReactFlow>`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/canvas/nodes/
git commit -m "feat: custom canvas nodes — trigger, LLM, tool, condition, gate, output"
```

---

### Task 16: Config drawer

**Files:**

- Create: `apps/dashboard/src/components/canvas/config-drawer.tsx`

- [ ] **Step 1: Build ConfigDrawer component**

Right-side slide-out panel (Sheet from shadcn/ui). Opens when a node/lane is clicked. Content varies by node type:

- **Pipeline lane:** Model selector, tool checkboxes, hook config, temperature/max tokens
- **Tool node:** Tool name, input schema preview
- **Condition node:** Expression editor
- **Trigger node:** Trigger type config

"Save" button persists changes to agent config via API.

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/canvas/config-drawer.tsx
git commit -m "feat: canvas config drawer — node configuration panel"
```

---

## Chunk 5: Run Explorer + Live View

### Task 17: Run list page

**Files:**

- Create: `apps/dashboard/src/app/(dashboard)/runs/page.tsx`
- Create: `apps/dashboard/src/components/runs/run-list.tsx`
- Create: `apps/dashboard/src/components/runs/run-filters.tsx`

- [ ] **Step 1: Build RunFilters component**

Filter bar: Status dropdown (multi-select), Agent dropdown, Date range picker, Trigger type. Reset button.

- [ ] **Step 2: Build RunList component**

Table with columns: Status (colored badge), Agent name, Trigger, Started (relative time), Duration, Model, Tokens. Paginated (10 per page). Click row → `/runs/:id`.

Real-time: subscribe to WebSocket for new runs. New rows appear at top with subtle animation.

- [ ] **Step 3: Build runs page**

Header: "Runs" title. RunFilters + RunList. Empty state: "No runs yet."

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/
git commit -m "feat: run explorer — filterable, paginated run list"
```

---

### Task 18: Run detail — pipeline view

**Files:**

- Create: `apps/dashboard/src/app/(dashboard)/runs/[id]/page.tsx`
- Create: `apps/dashboard/src/components/runs/pipeline-view.tsx`
- Create: `apps/dashboard/src/components/runs/phase-detail.tsx`

- [ ] **Step 1: Build PipelineView component**

Horizontal timeline showing pipeline phases:

```
[Trigger ✓] → [Analyzing ●] → [Planning] → [Approval] → [Execute] → [Complete]
```

Each phase: icon, label, status indicator (✓ complete, ● active, ○ pending, ✗ failed). Active phase pulses. Connected by lines.

- [ ] **Step 2: Build PhaseDetail component**

Expandable section below each phase showing:

- LLM output text (monospace, JetBrains Mono)
- Tool calls list (tool name, input JSON, output, duration, status badge)
- Token usage (input/output)
- Timing (phase duration)

- [ ] **Step 3: Build run detail page**

Header: Run ID, agent name, status badge, started time, duration.
PipelineView below header.
Click any phase → expand PhaseDetail.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/
git commit -m "feat: run detail — pipeline phase view with expandable details"
```

---

### Task 19: Live streaming + approval gate

**Files:**

- Create: `apps/dashboard/src/components/runs/streaming-text.tsx`
- Create: `apps/dashboard/src/components/runs/approval-gate.tsx`
- Create: `apps/dashboard/src/components/runs/tool-call-card.tsx`

- [ ] **Step 1: Build StreamingText component**

Renders text token-by-token from WebSocket `run:token` events. Blinking cursor at end during streaming. Monospace font. Auto-scroll to bottom.

- [ ] **Step 2: Build ToolCallCard component**

Card showing a single tool invocation: tool name + icon, collapsible input/output JSON, duration badge, success/fail indicator.

- [ ] **Step 3: Build ApprovalGate component**

Displayed when run status is `awaiting_approval`:

- Plan display: numbered step list from the plan
- "Approve" button (green) + "Reject" button (red)
- Optional "Modifications" textarea
- On approve: `api.runs.approve(id, modifications)`
- On reject: `api.runs.reject(id, { reason })`

- [ ] **Step 4: Wire WebSocket into run detail page**

When viewing an active run, subscribe to `/ws/runs/:id`. Update phases in real-time: streaming text, tool calls appearing, status transitions animating.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/runs/
git commit -m "feat: live run streaming — real-time text, tool calls, approval gate"
```

---

## Chunk 6: Connectors, App Store, Settings

### Task 20: Connector hub

**Files:**

- Create: `apps/dashboard/src/app/(dashboard)/connectors/page.tsx`
- Create: `apps/dashboard/src/components/connectors/connector-card.tsx`

- [ ] **Step 1: Build ConnectorCard component**

Card: icon, name, status badge (active/disconnected), tool count, "Test Connection" button, "Remove" button. Click → expand to show tool list.

- [ ] **Step 2: Build connectors page**

Header: "Connectors" + "Browse App Store" button + "Add MCP Server" button.
Grid of ConnectorCards. Empty state with CTA to app store.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/
git commit -m "feat: connector hub — installed connectors grid"
```

---

### Task 21: App store

**Files:**

- Create: `apps/dashboard/src/app/(dashboard)/connectors/store/page.tsx`
- Create: `apps/dashboard/src/components/connectors/app-card.tsx`
- Create: `apps/dashboard/src/components/connectors/install-dialog.tsx`

- [ ] **Step 1: Build AppCard component**

Card: icon, name, category badge, description, "Install" / "Connected" button. Smaller than ConnectorCard — designed for browsing.

- [ ] **Step 2: Build InstallDialog component**

Dialog that opens on "Install" click:

- For OAuth apps: "Connect with [App]" button → redirects to Nango OAuth flow
- For API key apps: API key input field + "Connect" button
- For MCP servers: URL/command input
- On success: creates connector via API, closes dialog, shows toast

- [ ] **Step 3: Build app store page**

Header: "App Store" with search bar.
Category tabs: All, Communication, Development, CRM, Productivity, Database, Custom.
Grid of AppCards filtered by category + search.

App catalog is a static list initially (hardcoded JSON), with connected status from `useConnectors()`.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/
git commit -m "feat: app store — browse integrations, OAuth install flow"
```

---

### Task 22: Settings pages

**Files:**

- Create: `apps/dashboard/src/app/(dashboard)/settings/page.tsx`
- Create: `apps/dashboard/src/app/(dashboard)/settings/providers/page.tsx`
- Create: `apps/dashboard/src/app/(dashboard)/settings/api-keys/page.tsx`

- [ ] **Step 1: Build providers settings page**

Table of registered providers: name, type, model count, status.
"Add Provider" button → dialog: provider type dropdown (Anthropic/Google/OpenAI/OpenRouter), API key input, "Test Connection" button.

- [ ] **Step 2: Build API keys settings page**

Table of API keys: name, key prefix (first 8 chars), created date, last used.
"Generate Key" button → dialog showing the new key (one-time display).
"Revoke" button per key with confirmation.

- [ ] **Step 3: Build general settings page**

Form: workspace name, default approval mode (radio), max concurrent runs (number), theme preference (dropdown). Save button.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(dashboard\)/settings/
git commit -m "feat: settings — providers, API keys, general config"
```

---

### Task 23: Command palette

**Files:**

- Create: `apps/dashboard/src/components/layout/command-palette.tsx`
- Modify: `apps/dashboard/src/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Build CommandPalette component**

Uses shadcn/ui `<Command>` component (cmdk under the hood).
Opens with ⌘K (Ctrl+K on Windows/Linux).
Search across: agents (by name), runs (by ID), settings pages.
Results grouped by category. Arrow keys to navigate, Enter to select.

- [ ] **Step 2: Wire into dashboard layout**

Add `<CommandPalette />` to the dashboard layout. Register keyboard shortcut.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/layout/command-palette.tsx
git commit -m "feat: command palette — ⌘K search across agents, runs, settings"
```

---

### Task 24: Integration verification

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: All packages including dashboard build successfully.

- [ ] **Step 2: Type check**

Run: `pnpm typecheck`
Expected: No TypeScript errors.

- [ ] **Step 3: Format**

Run: `pnpm format`

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "chore: dashboard v1 complete — wizard, canvas, runs, connectors, settings"
```

---

## Summary

| Chunk                    | Tasks | What it delivers                                               |
| ------------------------ | ----- | -------------------------------------------------------------- |
| 1: Scaffold + Layout     | 1-4   | Next.js app, shadcn/ui, collapsible sidebar, API hooks         |
| 2: Home + Agents         | 5-7   | Dashboard stats, agent library, agent detail                   |
| 3: Agent Wizard          | 8-12  | 4-step builder (identity, models, tools, triggers)             |
| 4: Pipeline Canvas       | 13-16 | React Flow canvas, pipeline lanes, custom nodes, config drawer |
| 5: Run Explorer          | 17-19 | Run list, pipeline detail view, live streaming, approval gate  |
| 6: Connectors + Settings | 20-24 | Connector hub, app store, settings, command palette            |
