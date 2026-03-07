# Dalinar

Bun monorepo. Orchestrates Jasnah (memory), Sazed (planning), and Hoid (calendar).

## Before Starting Work

1. Search memories for prior context:
   ```bash
   JASNAH="${JASNAH_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/jasnah}"
   bun run "$JASNAH/scripts/search-memory.ts" "<relevant query>"
   ```

2. If working on an epic, run analysis with context:
   ```bash
   bun run packages/orchestrator/src/analyze-with-context.ts EPIC-XXX
   ```

## After Completing Work

1. Extract session memories:
   ```bash
   JASNAH="${JASNAH_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/jasnah}"
   bun run "$JASNAH/scripts/extract-inline.ts" --root "$PWD" --source "session-description"
   ```

## Orchestrator Pipelines

6 pipelines, each with legacy async + Effect.ts version (Effect tried first, falls back to legacy).

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

## Architecture

- `packages/protocol/` — Shared types, retention math, secret detection, taxonomy, frontmatter, vault config
- `packages/orchestrator/` — 6 cross-system pipelines (legacy + Effect.ts)
  - `src/effect/` — Typed pipeline layer (services, errors, ticket state machine, WAL, context snapshots)
- `modules/jasnah/` — Memory extraction and retrieval (git submodule)
- `modules/sazed/` — Epic analysis and task decomposition (git submodule)
- `modules/hoid/` — Calendar operations (git submodule)
- `skills/` — 12 agent skills (local + symlinks into submodules)

### Effect.ts Layer (packages/orchestrator/src/effect/)

- **Services**: `JasnahService`, `SazedService`, `HoidService` — Context.Tag services wrapping subprocess calls
- **Errors**: `Schema.TaggedError` types — `SubprocessError`, `JasnahError`, `SazedError`, `VaultSyncError`, `FileOperationError`, `TicketStateError`, `ParseError`, `HoidError`
- **Runtime**: `OrchestratorLive` layer + `runCli` helper for error-to-exit-code mapping
- **Ticket protocol**: State machine with `Data.tagged` unions + `Match.value` exhaustive transitions
- **WAL**: Crash-safe `orders-next.json → orders.json` promotion via `Effect.acquireRelease`
- **Context snapshots**: Schema.Class types + SHA-256 content hashing + Ref-based caching

Tests: `bun test packages/orchestrator/src/effect/`

## Skills

| Skill | Source | Description |
|-------|--------|-------------|
| `calendar` | local | Unified calendar operations |
| `dialectic` | local | Adversarial reasoning for decisions |
| `jira` | local | Full ticket lifecycle (fetch → implement → PR → comment) |
| `reducing-entropy` | local | Codebase size minimization |
| `using-git-worktrees` | local | Workspace isolation for feature work |
| `gsap-react` | hoid | GSAP + React animation patterns |
| `image-to-webp` | hoid | Image conversion via cwebp |
| `sanity-tools` | hoid | Sanity CMS operations |
| `jasnah-debug-trace` | jasnah | Structured debugging (Agans' 9 Rules) |
| `jasnah-export-memory` | jasnah | Transcript-based memory export |
| `jasnah-query` | jasnah | Database querying via psql |
| `jasnah-search-memory` | jasnah | Semantic memory search |

## Conventions

- Cosmere naming: all projects use Brandon Sanderson's Cosmere universe names
- Package namespace: `@dalinar/*`
- Note types: domain-fact, architecture, api-contract, glossary, lesson-learned
- Retention: Ebbinghaus forgetting curve with type-specific half-life multipliers
- Vault sync: opt-in via `WORK_LOG_PATH` env var (coexists with HoldGate in same vault)
