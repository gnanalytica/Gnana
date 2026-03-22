---
name: create-migration
description: Create a new Drizzle ORM migration with proper schema conventions for the @gnana/db package
disable-model-invocation: true
---

# Create Migration

Generate a new Drizzle ORM migration for the Gnana database.

## Usage

`/create-migration <description>` — e.g., `/create-migration add-connectors-table`

## Steps

1. Parse the migration description from the argument.
2. Check the current schema in `packages/db/src/schema/` to understand existing tables.
3. Create or update the schema file in `packages/db/src/schema/`:
   - Each logical group gets its own file (e.g., `agents.ts`, `runs.ts`, `connectors.ts`)
   - Re-export from `packages/db/src/schema/index.ts`

## Schema Conventions

- Use `pgTable` from drizzle-orm/pg-core
- Table names: plural, snake_case (e.g., `agents`, `run_logs`, `connector_tools`)
- Column names: snake_case in the database, camelCase in TypeScript via Drizzle's mapping
- All tables include: `id` (uuid, primary key, default random), `createdAt`, `updatedAt`
- All tables include nullable `workspaceId` (for future multi-tenancy)
- JSONB columns for flexible structured data (e.g., `toolsConfig`, `analysis`, `plan`)
- Encrypted columns for secrets (e.g., `credentials` on connectors)
- Use proper foreign key references with `onDelete` behavior
- Add indexes on commonly queried columns (status, agentId, workspaceId)

## After Schema Changes

4. Run `pnpm drizzle-kit generate` from the `packages/db` directory to generate the migration SQL.
5. Show the generated migration file for review.
6. Remind user to run `pnpm drizzle-kit migrate` to apply.
