---
name: gnana-project-context
description: Gnana is a provider-agnostic AI agent framework extracted from Gnanalytica PM, with 4-phase pipeline and no-code builder
type: project
---

Gnana is being built as a standalone agent orchestration framework, extracted from the existing Gnanalytica PM product's in-app agent.

**Why:** Three goals — (1) serve as Gnanalytica's internal AI infrastructure, (2) open-source framework, (3) hosted SaaS product.

**How to apply:** All implementation should follow docs/DESIGN.md spec. Phase 1 focuses on core runtime + providers + Hono server + client SDK. TypeScript strict throughout, camelCase conventions, pnpm + Turborepo monorepo.
