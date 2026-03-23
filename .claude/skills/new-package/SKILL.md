---
name: new-package
description: Scaffold a new @gnana/* package with tsconfig, package.json, and src/index.ts
disable-model-invocation: true
---

# New Package Scaffold

Create a new package in the Gnana monorepo.

## Usage

`/new-package <package-name>` — e.g., `/new-package core`, `/new-package provider-anthropic`

## Steps

1. Parse the package name from the argument. Strip `@gnana/` prefix if provided.
2. Determine the directory:
   - Providers go in `packages/providers/<name>/` (strip `provider-` prefix for directory)
   - Connectors go in `packages/connectors/<name>/`
   - Everything else goes in `packages/<name>/`
3. Create the following files:

### package.json

```json
{
  "name": "@gnana/<package-name>",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "dev": "tsup src/index.ts --format esm --dts --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "tsup": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

Adjust devDependencies to use the versions from the root package.json catalog if available.

### tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

Adjust the `extends` path based on nesting depth (e.g., `../../../tsconfig.base.json` for providers).

### src/index.ts

```typescript
// @gnana/<package-name>
```

4. Add any cross-package dependencies specified by the user to package.json using `"workspace:*"` protocol.
5. Remind the user to run `pnpm install` to link the new package.
