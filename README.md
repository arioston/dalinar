# Dalinar

Dalinar — The Bondsmith. Unifying Jasnah (memory) and Sazed (planning) into a cohesive AI-augmented development workflow.

> *"The most important step a man can take. It's not the first one, is it? It's the next one."*
> — Dalinar Kholin, *Oathbringer*

## What is Dalinar?

Dalinar is the parent project — a Bun monorepo that unifies two sibling systems:

- **Jasnah** (the archivist) — memory extraction and retrieval: captures decisions, insights, and facts from AI coding sessions and makes them searchable across projects.
- **Sazed** (the planner) — epic analysis and task decomposition: breaks down tickets into actionable steps with full project context.

These two systems are connected through a shared protocol package and orchestration pipelines. Named after Dalinar Kholin, the Bondsmith whose Surgebinding power is Connection — the ability to bridge, bind, and unify.

## Project Structure

```
dalinar/
├── packages/
│   ├── protocol/        Shared contract: types, retention, secrets, frontmatter
│   └── orchestrator/    Cross-system pipelines (6 pipelines)
├── modules/
│   ├── jasnah/          git submodule — memory & knowledge
│   └── sazed/           git submodule — planning & analysis
├── skills/
│   ├── using-git-worktrees/   Workspace isolation
│   ├── jira/                  Full ticket lifecycle
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

**Sazed** (`modules/sazed/`) — Epic analysis and task decomposition. Analyzes Jira epics, fetches relevant memories from Jasnah, and produces structured implementation plans with context-aware task breakdowns. Built with Effect TypeScript.

**Protocol** (`packages/protocol/`) — Shared contract between Jasnah and Sazed. Defines the unified 5-type note taxonomy, Ebbinghaus retention math with type-specific half-life multipliers, 3-layer secret detection, YAML frontmatter parser/serializer, and vault configuration for Obsidian sync. See [docs/protocol-reference.md](docs/protocol-reference.md).

**Orchestrator** (`packages/orchestrator/`) — Seven cross-system pipelines that coordinate Jasnah and Sazed, with optional Obsidian vault sync. See [docs/pipelines-reference.md](docs/pipelines-reference.md).

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
# 1. Clone the repository
git clone https://github.com/arioston/dalinar.git

# 2. Initialize submodules (Jasnah and Sazed)
git submodule update --init --recursive

# 3. Install dependencies
bun install
```

## Quick Reference

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
JASNAH="${JASNAH_ROOT:-$HOME/.local/share/jasnah}"
bun run "$JASNAH/scripts/search-memory.ts" "authentication architecture"
```

## Documentation

- [Architecture Plan](docs/architecture-plan.md) — Full system vision, design philosophy, and implementation plan
- [Protocol Reference](docs/protocol-reference.md) — Types, taxonomy, retention model, secret detection, frontmatter
- [Pipelines Reference](docs/pipelines-reference.md) — Orchestrator pipeline details and usage
