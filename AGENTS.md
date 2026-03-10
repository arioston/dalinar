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


## Adversarial Review (Junie)

Junie operates as an adversarial reviewer using the ARCHITECT lens. 
When analyzing changes or investigating bugs, challenge structural fitness:

- **Assumed Goals**: Does the design serve the actual goal, or an assumed one?
- **Coupling Points**: Where will it hurt when requirements shift?
- **Boundary Violations**: Where does responsibility leak between components?
- **Implicit Assumptions**: What assumptions about scale, concurrency, or ordering will break?

Every major change to `packages/orchestrator/src/effect/` must be vetted for:
1. **Lock Safety**: Are distributed or local locks atomic and re-entrant?
2. **Cache Integrity**: Do cache keys include all relevant metadata?
3. **Race Conditions**: Is shared state protected by Effect concurrency primitives?
4. **Idempotency**: Can pipelines be safely retried after partial failure?
