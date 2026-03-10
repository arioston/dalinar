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

7 pipelines via unified `@effect/cli` entry point. Legacy entry points delegate to the CLI.

```bash
# Unified CLI (preferred)
bun run packages/orchestrator/src/effect/cli.ts <command> [options]

# Legacy entry points still work (delegate to CLI internally)
bun run packages/orchestrator/src/analyze-with-context.ts EPIC-XXX
```

- **analyze**: `dalinar analyze EPIC-XXX [--force] [--notes] [--forensics] [--stdout] [--datastore-introspect]`
  Searches Jasnah → fetches Jira task hierarchy → gathers git evidence from completed tasks → writes prior context to temp file → runs Sazed analysis with `--prior-context` → enriches forensics with Jira (cached, rate-limited) → extracts knowledge back (8 extraction rules) → vault sync

- **deep-analyze**: `dalinar deep-analyze EPIC-XXX [--force] [--notes] [--task-only]`
  Per-task deep analysis with sequential reduce

- **implement**: `dalinar implement PROJ-123 [--analyze] [--worktree]`
  Gathers context → optional analysis → optional worktree → outputs implementation plan

- **audit**: `dalinar audit [--extract] [--json] [--roots <dir>]`
  Scans memory store for recurring blockers, decision oscillation, knowledge gaps

- **dialectic**: `dalinar dialectic "decision question" [--extract]`
  Adversarial reasoning — generates isolated opposing analyses for high-stakes decisions

- **reflect**: `dalinar reflect --sprint sprint-XX [--dry-run]`
  Post-sprint retrospective capture — feeds corrections back as memories

- **vault-sync**: `dalinar vault-sync [project-root]`
  Sync .memory/ to Obsidian vault Work Log folder (opt-in via `WORK_LOG_PATH`)

## Architecture

- `packages/protocol/` — Shared types, retention math, secret detection, taxonomy, frontmatter, vault config, Sazed contract schemas (v1.2.0)
- `packages/orchestrator/` — 7 cross-system pipelines via unified @effect/cli
  - `src/effect/` — Typed pipeline layer (services, errors, ticket state machine, WAL, context snapshots)
  - `src/effect/cli.ts` — Unified CLI entry point with typed commands via `@effect/cli`
- `modules/jasnah/` — Memory extraction and retrieval (git submodule)
- `modules/sazed/` — Epic analysis and task decomposition (git submodule)
- `modules/hoid/` — Calendar operations (git submodule)
- `skills/` — 16 agent skills (local + symlinks into submodules)

### Effect.ts Layer (packages/orchestrator/src/effect/)

- **Services**: `JasnahService`, `SazedService`, `HoidService`, `JiraService` — Context.Tag services wrapping subprocess calls
- **Errors**: `Schema.TaggedError` types — `SubprocessError`, `JasnahError`, `SazedError`, `VaultSyncError`, `FileOperationError`, `TicketStateError`, `ParseError`, `HoidError`, `JiraError`
- **Runtime**: `OrchestratorLive` layer + `NodeRuntime.runMain` for signal handling and exit codes
- **Ticket protocol**: State machine with `Data.TaggedEnum` + `Match.value` exhaustive transitions
- **WAL**: Crash-safe `orders-next.json → orders.json` promotion via `Effect.acquireRelease`
- **Context snapshots**: Schema.Class types + SHA-256 content hashing + Ref-based caching
- **Knowledge extraction**: 8 composable extraction rules (pure functions) covering notes, context, acceptance criteria, communication flows, integration points, impact summaries, diffs, and forensics
- **Forensics enrichment**: Post-hoc Jira ticket enrichment with persistent file cache (`.cache/jira-tickets.json`), rate limiting (`JIRA_RATE_LIMIT` env, default 5/s), and graceful degradation via `Effect.serviceOption`

Tests: `bun test packages/orchestrator/src/effect/`

## Skills

| Skill | Source | Description |
|-------|--------|-------------|
| `calendar` | local | Unified calendar operations |
| `dialectic` | local | Adversarial reasoning for decisions |
| `jira` | local | Full ticket lifecycle (fetch → implement → PR → comment) |
| `reducing-entropy` | local | Codebase size minimization |
| `using-git-worktrees` | local | Workspace isolation for feature work |
| `adversarial-review` | hoid | Cross-model adversarial code/plan review |
| `gsap-react` | hoid | GSAP + React animation patterns |
| `image-to-webp` | hoid | Image conversion via cwebp |
| `meditate` | hoid | Audit and evolve project memory store |
| `refine` | hoid | Sharpen vague todos into actionable prompts |
| `ruminate` | hoid | Mine past conversations for uncaptured knowledge |
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
- `JIRA_RATE_LIMIT`: Max Jira API requests/sec during forensics enrichment (default: 5)
- `SAZED_TIMEOUT`: Sazed subprocess timeout (default: 120s)
- Jira ticket cache: `.cache/jira-tickets.json` — persistent, never expires. Clear manually or via future `dalinar cache clear --jira` command
- Prior context transport: orchestrator writes task hierarchy + git evidence to `/tmp/dalinar-prior-context-*.md`, passes to Sazed via `--prior-context <file>` flag (not env vars)
