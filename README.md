# Dalinar

Dalinar — The Bondsmith. Unifying Jasnah (memory) and Sazed (planning) into a cohesive AI-augmented development workflow.

> *"The most important step a man can take. It's not the first one, is it? It's the next one."*
> — Dalinar Kholin, *Oathbringer*

## What is Dalinar?

Dalinar is the parent project — a Bun monorepo that unifies two sibling systems:

- **Jasnah** (the archivist) — memory extraction and retrieval: captures decisions, insights, and facts from AI coding sessions and makes them searchable across projects.
- **Sazed** (the planner) — epic analysis and task decomposition: breaks down tickets into actionable steps with full project context.

These systems are connected through a shared protocol package and orchestration pipelines. Named after Dalinar Kholin, the Bondsmith whose Surgebinding power is Connection — the ability to bridge, bind, and unify.

## Project Structure

```
dalinar/
├── packages/
│   ├── protocol/        Shared contract: types, retention, secrets, frontmatter
│   └── orchestrator/    Cross-system pipelines (7 pipelines)
├── modules/
│   ├── jasnah/          git submodule — memory & knowledge
│   ├── sazed/           git submodule — planning & analysis
│   └── hoid/            git submodule — unified calendar (Google + Microsoft)
├── skills/
│   ├── using-git-worktrees/   Workspace isolation
│   ├── jira/                  Full ticket lifecycle
│   ├── calendar/              Unified calendar operations
│   ├── jasnah-debug-trace/    Structured debugging (Agans' 9 Rules)
│   ├── jasnah-query/          Database querying via psql
│   └── dialectic/             Adversarial reasoning for decisions
└── docs/
    ├── architecture-plan.md   Full architecture vision
    ├── protocol-reference.md  Protocol package API reference
    └── pipelines-reference.md Orchestrator pipelines guide
```

## Components

**Jasnah** (`modules/jasnah/`) — Memory extraction and retrieval pack. Captures decisions, insights, and facts from AI coding sessions. Stores entries as markdown with YAML frontmatter and provides optional Qdrant-powered semantic search with Ebbinghaus retention scoring.

**Sazed** (`modules/sazed/`) — Epic analysis and task decomposition. Analyzes Jira epics or local documents, fetches relevant memories from Jasnah, and produces structured implementation plans with context-aware task breakdowns. Built with Effect TypeScript. Key capabilities:
- **Flexible epic sources** — accepts Jira keys (`EPIC-123`) or document files (`.md`, `.txt`, `.pdf`, `.docx`, `.pptx`, `.xlsx`) as input via `EpicResolverService`
- **Document parsing** — `DocumentParserService` lets the LLM exploration agent read non-code files (PDF, Word, Excel, PowerPoint, images) committed to repos
- **Jira attachments** — downloads and parses Jira epic attachments so the LLM has full context from specs and design docs

**Hoid** (`modules/hoid/`) — Unified calendar interface across Google Calendar and Microsoft Graph, supporting multiple accounts per provider. Lists events, finds free slots, creates and moves events, and detects scheduling conflicts. Uses raw `fetch()` for API calls, Zod schemas for all types, and sweep-line algorithms for merge/availability operations. See [modules/hoid/README.md](modules/hoid/README.md).

**Protocol** (`packages/protocol/`) — Shared contract between Jasnah and Sazed. Defines the unified 5-type note taxonomy, Ebbinghaus retention math with type-specific half-life multipliers, 3-layer secret detection, YAML frontmatter parser/serializer, and vault configuration for Obsidian sync. See [docs/protocol-reference.md](docs/protocol-reference.md).

**Orchestrator** (`packages/orchestrator/`) — Cross-system pipelines that coordinate Jasnah, Sazed, and Hoid, with optional Obsidian vault sync. See [docs/pipelines-reference.md](docs/pipelines-reference.md).

| Pipeline | Description |
|----------|-------------|
| `analyze-with-context` | Search Jasnah → run Sazed analysis → extract knowledge back → vault sync |
| `implement-ticket` | Full lifecycle: context → analysis → worktree → implementation plan |
| `audit` | Cross-session pattern detection (recurring blockers, decision oscillation, knowledge gaps) |
| `dialectic` | Adversarial reasoning — isolated opposing analyses with Hegelian synthesis |
| `reflect` | Post-sprint retrospective capture — feeds corrections back as memories |
| `vault-sync` | Sync .memory/ to Obsidian vault Work Log folder (opt-in via `WORK_LOG_PATH`) |

## Getting Started

```bash
# 1. Clone with submodules (Jasnah, Sazed, Hoid)
git clone --recursive https://github.com/arioston/dalinar.git
cd dalinar

# 2. Run full setup (submodules, deps, memory pack, skills, hooks, env)
./setup.sh          # Linux / macOS
setup.bat           # Windows
```

The setup script is idempotent — safe to re-run at any time. It handles:
- Git submodule initialization
- `bun install`
- Jasnah memory pack (`.memory/` directories, config)
- OpenCode plugins and commands (symlinks)
- Project and global Claude Code skills
- `.env` file from template
- Hoid calendar config

> **Already cloned without `--recursive`?** The setup script detects this and runs `git submodule update --init --recursive` automatically.

## Sazed CLI (Direct Usage)

All Sazed commands run from `modules/sazed/`. The `source` argument accepts either a Jira key or a path to a document file.

### Repo Map

Generate a pre-analysis repo map that gives the LLM agent a head start during exploration (skips structure discovery, saves tool call budget):

```bash
cd modules/sazed

# Generate or update the repo map
bun run packages/cli/src/main.ts map

# Force full regeneration (ignores cache)
bun run packages/cli/src/main.ts map --force

# Output map to stdout (for inspection)
bun run packages/cli/src/main.ts map --stdout
```

### Analyze an Epic

Run the full analysis pipeline (explore → plan → refine → validate → reconcile):

```bash
# From a Jira epic
bun run packages/cli/src/main.ts analyze EPIC-123

# From a local document (PDF, Word, Markdown, etc.)
bun run packages/cli/src/main.ts analyze ./specs/feature-design.pdf

# Common flags
bun run packages/cli/src/main.ts analyze EPIC-123 --stdout       # Output to stdout instead of file
bun run packages/cli/src/main.ts analyze EPIC-123 --force        # Re-analyze even if nothing changed
bun run packages/cli/src/main.ts analyze EPIC-123 --review       # Pause after exploration for human review
bun run packages/cli/src/main.ts analyze EPIC-123 --notes        # Extract domain notes after planning
bun run packages/cli/src/main.ts analyze EPIC-123 --no-map       # Skip repo map (for A/B testing)
bun run packages/cli/src/main.ts analyze EPIC-123 --no-cache     # Skip exploration cache
bun run packages/cli/src/main.ts analyze EPIC-123 --forensics    # Auto-generate git forensics report
```

### Git Forensics

Analyze git history for hotspots, temporal coupling, and ownership patterns:

```bash
bun run packages/cli/src/main.ts forensics           # Generate forensics report
bun run packages/cli/src/main.ts forensics --stdout   # Output to stdout
```

### Task Management

```bash
bun run packages/cli/src/main.ts status EPIC-123      # Check staleness of refined tasks
bun run packages/cli/src/main.ts diff EPIC-123         # Diff last two refinement snapshots
bun run packages/cli/src/main.ts sync EPIC-123 --dry-run  # Preview Jira sync
bun run packages/cli/src/main.ts sync EPIC-123         # Sync tasks to Jira as subtasks
```

### Domain Notes

```bash
bun run packages/cli/src/main.ts notes list            # List notes with retention scores
bun run packages/cli/src/main.ts notes search "auth"   # Search notes
bun run packages/cli/src/main.ts notes show SLUG       # Show full note content
bun run packages/cli/src/main.ts notes gc              # Tombstone decayed notes (retention < 1%)
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for LLM analysis |
| `JIRA_BASE_URL` | For Jira | Jira instance URL |
| `JIRA_EMAIL` | For Jira | Jira account email |
| `JIRA_API_TOKEN` | For Jira | Jira API token |
| `JIRA_PROJECT_KEY` | For sync | Project key for creating subtasks |
| `GIT_ROOT` | No | Override git root detection |
| `OUTPUT_DIR` | No | Where to write analysis output |
| `LLM_MODEL` | No | Override LLM model |
| `TOOL_CALL_BUDGET` | No | Exploration tool call limit (default: 25) |
| `REFINEMENT_CONCURRENCY` | No | Parallel task refinement (default: 3) |

## Hoid CLI (Calendar)

Calendar commands run from `modules/hoid/`.

```bash
cd modules/hoid

# Add a new account (interactive — prompts for provider, credentials)
bun run packages/cli/src/calendar-auth.ts --add

# Login (starts OAuth flow, opens browser)
bun run packages/cli/src/calendar-auth.ts --account work-google

# Check auth status
bun run packages/cli/src/calendar-auth.ts --status

# List events (next 7 days, all accounts)
bun run packages/cli/src/calendar-list.ts --days 7 --json

# Find free slots (30+ min, within working hours)
bun run packages/cli/src/calendar-free-slots.ts --days 5 --min-duration 30 --working-hours 9-17 --json

# Create an event
bun run packages/cli/src/calendar-create.ts \
  --title "Team Standup" --start "2024-03-15T09:00:00" --end "2024-03-15T09:30:00" \
  --account work-google --json

# Move an event (same or cross-account)
bun run packages/cli/src/calendar-move.ts \
  --event-id EVENT_ID --source work-google \
  --new-start "2024-03-15T10:00:00" --new-end "2024-03-15T10:30:00"

# Detect scheduling conflicts
bun run packages/cli/src/calendar-conflicts.ts --days 7 --json
```

See [modules/hoid/README.md](modules/hoid/README.md) and [modules/hoid/packages/calendar/README.md](modules/hoid/packages/calendar/README.md) for full flag reference.

## Orchestrator Pipelines (Cross-System)

These pipelines coordinate Sazed with Jasnah memory and Hoid calendar. Run from the dalinar root:

```bash
# Analyze an epic with prior context from memory
bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123

# Prepare implementation context for a ticket
bun run packages/orchestrator/src/implement-ticket.ts PROJ-456 --analyze --worktree

# Audit the memory store for patterns
bun run packages/orchestrator/src/audit.ts

# Run adversarial analysis on a decision
bun run packages/orchestrator/src/dialectic.ts "PostgreSQL vs ClickHouse for analytics?"

# Capture sprint retrospective learnings
echo '<json>' | bun run packages/orchestrator/src/reflect.ts --sprint sprint-42

# Sync .memory/ to Obsidian vault (opt-in: requires WORK_LOG_PATH)
bun run packages/orchestrator/src/vault-sync.ts

# Search memories directly
JASNAH="${JASNAH_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/jasnah}"
bun run "$JASNAH/scripts/search-memory.ts" "authentication architecture"
```

## Documentation

- [Architecture Plan](docs/architecture-plan.md) — Full system vision, design philosophy, and implementation plan
- [Protocol Reference](docs/protocol-reference.md) — Types, taxonomy, retention model, secret detection, frontmatter
- [Pipelines Reference](docs/pipelines-reference.md) — Orchestrator pipeline details and usage
