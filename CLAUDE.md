# Dalinar

Dalinar orchestrates Jasnah (memory) and Sazed (planning) for AI-augmented development.

## Before Starting Work

1. Search memories for prior context on the area you're working in:
   ```bash
   JASNAH="${JASNAH_ROOT:-$HOME/.local/share/jasnah}"
   bun run "$JASNAH/scripts/search-memory.ts" "<relevant query>"
   ```

2. If working on an epic, run analysis with context:
   ```bash
   bun run packages/orchestrator/src/analyze-with-context.ts EPIC-XXX
   ```

## After Completing Work

1. Extract session memories:
   ```bash
   JASNAH="${JASNAH_ROOT:-$HOME/.local/share/jasnah}"
   bun run "$JASNAH/scripts/extract-inline.ts" --root "$PWD" --source "session-description"
   ```

## Orchestrator Pipelines

- **analyze-with-context**: `bun run packages/orchestrator/src/analyze-with-context.ts EPIC-XXX [--force] [--notes]`
  Searches Jasnah → runs Sazed analysis → extracts knowledge back → vault sync

- **implement-ticket**: `bun run packages/orchestrator/src/implement-ticket.ts PROJ-123 [--analyze] [--worktree]`
  Gathers context → optional analysis → optional worktree → outputs implementation plan

- **audit**: `bun run packages/orchestrator/src/audit.ts [--extract] [--json]`
  Scans memory store for recurring blockers, decision oscillation, knowledge gaps

- **dialectic**: `bun run packages/orchestrator/src/dialectic.ts "decision question" [--extract]`
  Adversarial reasoning — generates isolated opposing analyses for high-stakes decisions

- **reflect**: `bun run packages/orchestrator/src/reflect.ts --sprint sprint-XX [--dry-run]`
  Post-sprint retrospective capture — feeds corrections back as memories

- **vault-sync**: `bun run packages/orchestrator/src/vault-sync.ts [project-root]`
  Sync .memory/ to Obsidian vault Work Log folder (opt-in via `WORK_LOG_PATH`)

## Skills Available

- **jasnah-debug-trace**: Structured debugging with trace utilities (Agans' 9 Rules)
- **jasnah-query**: Database querying via psql
- **jasnah-search-memory**: Semantic memory search
- **using-git-worktrees**: Workspace isolation for feature work
- **jira**: Full ticket lifecycle (fetch → implement → PR → comment)
- **dialectic**: Adversarial reasoning for architectural decisions (see skills/dialectic/)

## Architecture

- `packages/protocol/` — Shared types, retention math, secret filtering, vault config
- `packages/orchestrator/` — Cross-system pipelines (analyze-with-context, implement-ticket, vault-sync)
  - `src/effect/` — Effect.ts typed pipeline layer (see `packages/orchestrator/MIGRATION.md`)
- `modules/jasnah/` — Memory extraction and retrieval (git submodule)
- `modules/sazed/` — Epic analysis and task decomposition (git submodule)
- `skills/` — Cross-project skills (worktrees, jira, dialectic)

### Effect.ts Layer (packages/orchestrator/src/effect/)

All 6 orchestrator pipelines have Effect.ts versions with typed errors, injectable services, and test layers. CLI entrypoints try the Effect pipeline first with a fallback to the original async function.

- **Services**: `JasnahService`, `SazedService`, `HoidService` — Context.Tag services wrapping subprocess calls
- **Errors**: `Schema.TaggedError` types — `SubprocessError`, `JasnahError`, `SazedError`, `VaultSyncError`, `FileOperationError`, `TicketStateError`, `ParseError`, `HoidError`
- **Runtime**: `OrchestratorLive` layer + `runCli` helper for error-to-exit-code mapping
- **Ticket protocol**: State machine with `Data.tagged` unions + `Match.value` exhaustive transitions
- **WAL**: Crash-safe `orders-next.json → orders.json` promotion via `Effect.acquireRelease`
- **Context snapshots**: Schema.Class types + SHA-256 content hashing + Ref-based caching

Tests: `bun test packages/orchestrator/src/effect/`

## Conventions

- Cosmere naming: all projects use Brandon Sanderson's Cosmere universe names
- Package namespace: `@dalinar/*`
- Note types: domain-fact, architecture, api-contract, glossary, lesson-learned
- Retention: Ebbinghaus forgetting curve with type-specific half-life multipliers
- Vault sync: opt-in via `WORK_LOG_PATH` env var (coexists with HoldGate in same vault)
