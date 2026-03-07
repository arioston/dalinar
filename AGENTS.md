# Codex Agent Instructions

## Setup

- Runtime: Bun (not Node)
- Install: `bun install`

## Commands

- Run all tests: `bun test`
- Run specific tests: `bun test packages/orchestrator/src/effect/`
- Type check: `bunx tsc --noEmit` (from package dirs)

## Architecture

- Monorepo with workspaces: `packages/protocol`, `packages/orchestrator`
- Git submodules: `modules/jasnah`, `modules/sazed`, `modules/hoid`
- Effect.ts layer: `packages/orchestrator/src/effect/`
- Skills: `skills/` (local dirs + symlinks into submodules)

## Post-Edit Checks

After editing any `.ts` file, run:

```bash
bun test packages/orchestrator/
```

## Conventions

- Package namespace: `@dalinar/*`
- Error types: `Schema.TaggedError` from Effect
- Services: `Context.Tag` pattern
- All CLI entry points are `#!/usr/bin/env bun` scripts
- Cosmere naming: projects use Brandon Sanderson's Cosmere universe names
