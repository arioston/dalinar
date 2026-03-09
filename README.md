# Dalinar

> *"The most important step a man can take. It's not the first one, is it? It's the next one."*
> — Dalinar Kholin, *Oathbringer*

A Bun monorepo that wires together three subsystems for AI-augmented development:

- **Jasnah** — extracts and searches memories (decisions, insights, facts) from coding sessions
- **Sazed** — analyzes Jira epics and documents, produces task breakdowns using an LLM
- **Hoid** — reads and writes Google Calendar and Microsoft Graph events

These are connected by a shared protocol package and an orchestrator that shells out to their CLIs.

This is a personal toolchain. It is not published, not packaged, and not designed for anyone else to use.

## Structure

```
dalinar/
├── packages/
│   ├── protocol/        Shared types, retention math, secret detection, frontmatter
│   └── orchestrator/    6 cross-system pipelines (legacy async + Effect.ts versions)
├── modules/
│   ├── jasnah/          git submodule — memory extraction and vector search
│   ├── sazed/           git submodule — epic analysis and task decomposition
│   └── hoid/            git submodule — calendar operations
├── skills/              Agent skills (symlinks + local directories, 11 total)
├── docs/                Architecture plan, protocol reference, pipelines reference
├── setup.sh             Idempotent setup (submodules, deps, symlinks, env)
└── setup.bat            Windows equivalent
```

## Setup

```bash
git clone --recursive https://github.com/arioston/dalinar.git
cd dalinar
./setup.sh
```

The setup script handles submodule init, `bun install`, memory pack directories, skill symlinks, and `.env` from template. It's idempotent.

## Orchestrator Pipelines

Run from dalinar root. Each has a legacy async version and an Effect.ts version (tried first, falls back to legacy).

| Pipeline | What it does |
|----------|-------------|
| `analyze-with-context` | Searches Jasnah for prior context, runs Sazed analysis, extracts knowledge back |
| `implement-ticket` | Gathers context for a ticket, optionally runs analysis and creates a worktree |
| `audit` | Scans memory store for recurring blockers, decision oscillation, knowledge gaps |
| `dialectic` | Generates opposing analyses of a decision, then synthesizes |
| `reflect` | Captures post-sprint retrospective learnings as memories |
| `vault-sync` | Copies `.memory/` entries to an Obsidian vault (requires `WORK_LOG_PATH`) |

```bash
bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123
bun run packages/orchestrator/src/implement-ticket.ts PROJ-456 --analyze --worktree
bun run packages/orchestrator/src/audit.ts
bun run packages/orchestrator/src/dialectic.ts "PostgreSQL vs ClickHouse for analytics?"
echo '<json>' | bun run packages/orchestrator/src/reflect.ts --sprint sprint-42
bun run packages/orchestrator/src/vault-sync.ts
```

### analyze-with-context

Writes output to `.refinement/{KEY}-analysis.md` by default.

```bash
# Basic analysis (output to .refinement/EPIC-123-analysis.md)
bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123

# Print to console instead of file
bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123 --stdout

# All flags
bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123 \
  --force        # Re-analyze even if nothing changed (bypass cache)
  --notes        # Extract domain notes to Jasnah
  --no-map       # Skip repo map (for A/B comparison)
  --no-cache     # Skip exploration cache
  --forensics    # Include git forensics (hotspots, temporal coupling)
  --stdout       # Print to console instead of .refinement/ file

# Increase timeout for heavy epics (default: 120s, min: 30s)
SAZED_TIMEOUT=300 bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123
```

### Analysis with datastore introspection

Sazed can introspect PostgreSQL and Elasticsearch schemas during analysis to discover constraints (NOT NULL, CHECK, UNIQUE, FK, ENUM) and field mappings. This runs from `modules/sazed/`.

```bash
# PostgreSQL introspection (requires approval unless auto-approved)
bun run packages/cli/src/main.ts analyze EPIC-123 \
  --datastore-introspect \
  --datastore-provider relational \
  --datastore-env local \
  --datastore-targets users,orders

# Elasticsearch introspection
bun run packages/cli/src/main.ts analyze EPIC-123 \
  --datastore-introspect \
  --datastore-provider elasticsearch \
  --datastore-env local \
  --datastore-targets products,inventory

# Skip constraint cache (force fresh introspection)
bun run packages/cli/src/main.ts analyze EPIC-123 \
  --datastore-introspect --no-datastore-cache

# Auto-approve without interactive prompt
SAZED_AUTO_APPROVE_DB_INTROSPECTION=true \
  bun run packages/cli/src/main.ts analyze EPIC-123 --datastore-introspect
```

Database connections are resolved via Jasnah's `execute_query.ts` using `QUERY_DB_<ENV>` environment variables (e.g. `QUERY_DB_LOCAL=postgres://user:pass@localhost:5432/mydb`). Results are cached with 24h TTL in `.refinement/db-constraints/` (relational) or `.refinement/es-mappings/` (elasticsearch).

Deprecated flags `--db-introspect`, `--db-env`, `--impact-tables`, `--no-db-cache` still work and map to the relational provider.

## Sazed CLI

All commands run from `modules/sazed/`. Accepts Jira keys or document files (.md, .pdf, .docx, .pptx, .xlsx).

```bash
# Analyze an epic
bun run packages/cli/src/main.ts analyze EPIC-123
bun run packages/cli/src/main.ts analyze ./specs/feature-design.pdf

# Useful flags: --stdout, --force, --review, --notes, --no-map, --no-cache, --forensics

# Repo map (symbol index for LLM context)
bun run packages/cli/src/main.ts map

# Git forensics (hotspots, temporal coupling, ownership)
bun run packages/cli/src/main.ts forensics

# Task lifecycle
bun run packages/cli/src/main.ts status EPIC-123
bun run packages/cli/src/main.ts diff EPIC-123
bun run packages/cli/src/main.ts sync EPIC-123 --dry-run
```

## Hoid CLI

Run from `modules/hoid/`.

```bash
bun run packages/cli/src/calendar-auth.ts --add          # Add account (interactive)
bun run packages/cli/src/calendar-auth.ts --account tag   # OAuth login
bun run packages/cli/src/calendar-list.ts --days 7 --json
bun run packages/cli/src/calendar-free-slots.ts --days 5 --min-duration 30 --working-hours 9-17 --json
bun run packages/cli/src/calendar-create.ts --title "X" --start "..." --end "..." --account tag
bun run packages/cli/src/calendar-conflicts.ts --days 7 --json
```

## Memory Search

```bash
JASNAH="${JASNAH_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/jasnah}"
bun run "$JASNAH/scripts/search-memory.ts" "authentication architecture"
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `JIRA_BASE_URL` | For Jira | Jira instance URL |
| `JIRA_EMAIL` | For Jira | Jira account email |
| `JIRA_API_TOKEN` | For Jira | Jira API token |
| `JIRA_PROJECT_KEY` | For sync | Project key for subtask creation |
| `WORK_LOG_PATH` | For vault-sync | Obsidian vault path |
| `QUERY_DB_LOCAL` | For DB introspection | Postgres connection string for local env |
| `QUERY_DB_STAGING` | For DB introspection | Postgres connection string for staging env |
| `SAZED_TIMEOUT` | No | Sazed subprocess timeout in seconds (default: 120, min: 30) |
| `SAZED_AUTO_APPROVE_DB_INTROSPECTION` | No | Skip interactive approval for DB queries (`true`) |
| `QDRANT_URL` | For vector search | Qdrant Cloud URL (LanceDB used as local fallback) |
| `QDRANT_API_KEY` | For vector search | Qdrant Cloud API key |

Optional: `GIT_ROOT`, `OUTPUT_DIR`, `LLM_MODEL`, `TOOL_CALL_BUDGET` (default 25), `REFINEMENT_CONCURRENCY` (default 3).

## Skills

11 agent skills in `skills/` (mix of local directories and symlinks into submodules):

| Skill | Source |
|-------|--------|
| `calendar` | local |
| `dialectic` | local |
| `jira` | local |
| `reducing-entropy` | local |
| `using-git-worktrees` | local |
| `gsap-react` | hoid |
| `image-to-webp` | hoid |
| `sanity-tools` | hoid |
| `jasnah-debug-trace` | jasnah |
| `jasnah-export-memory` | jasnah |
| `jasnah-query` | jasnah |
| `jasnah-search-memory` | jasnah |

## Naming

Everything is named after Brandon Sanderson's Cosmere universe. Dalinar binds things together. Jasnah is the scholar. Sazed is the keeper of knowledge. Hoid goes everywhere.
