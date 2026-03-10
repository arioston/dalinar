# Agent Instructions

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

- Cosmere naming: all projects use Brandon Sanderson's Cosmere universe names
- Package namespace: `@dalinar/*`
- Note types: domain-fact, architecture, api-contract, glossary, lesson-learned
- Retention: Ebbinghaus forgetting curve with type-specific half-life multipliers
- Vault sync: opt-in via `WORK_LOG_PATH` env var (coexists with HoldGate in same vault)
- `JIRA_RATE_LIMIT`: Max Jira API requests/sec during forensics enrichment (default: 5)
- `SAZED_TIMEOUT`: Sazed subprocess timeout (default: 120s)
- Jira ticket cache: `.cache/jira-tickets.json` — persistent, never expires. Clear manually or via future `dalinar cache clear --jira` command
- Prior context transport: orchestrator writes task hierarchy + git evidence to `/tmp/dalinar-prior-context-*.md`, passes to Sazed via `--prior-context <file>` flag (not env vars)


## Local Effect Source

The Effect repository is cloned to `~/.local/share/effect-solutions/effect` for reference. 
Use this to explore APIs, find usage examples, and understand implementation 
details when the documentation isn't enough.


## Local Pi mono Source

The Pi mono repository is cloned to `~/.local/share/dalinar/pi-mono` for reference. 
Use this to explore APIs, find usage examples, and understand implementation 
details when the documentation isn't enough.
