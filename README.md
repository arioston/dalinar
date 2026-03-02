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
│   └── orchestrator/    Cross-system pipelines
├── modules/
│   ├── jasnah/          git submodule — memory & knowledge
│   └── sazed/           git submodule — planning & analysis
├── skills/
│   ├── using-git-worktrees/   Workspace isolation
│   ├── jira/                  Full ticket lifecycle
│   └── dialectic/             Adversarial reasoning (planned)
└── docs/
    └── architecture-plan.md   Full architecture vision
```

## Components

**Jasnah** (`modules/jasnah/`) — Memory extraction and retrieval pack. Captures decisions, insights, and facts from AI coding sessions. Stores entries as markdown with YAML frontmatter and provides optional Qdrant-powered semantic search with Ebbinghaus retention scoring.

**Sazed** (`modules/sazed/`) — Epic analysis and task decomposition. Analyzes Jira epics, fetches relevant memories from Jasnah, and produces structured implementation plans with context-aware task breakdowns.

**Protocol** (`packages/protocol/`) — Shared contract between Jasnah and Sazed. Defines note types, retention math (Ebbinghaus forgetting curve with type-specific half-life multipliers), secret filtering, and frontmatter schemas.

**Orchestrator** (`packages/orchestrator/`) — Cross-system pipelines that coordinate Jasnah and Sazed. Includes `analyze-with-context` (epic analysis enriched with memory retrieval) and `implement-ticket` (full ticket workflow from fetch to PR).

## Getting Started

```bash
# 1. Clone the repository
git clone <repo-url> dalinar

# 2. Initialize submodules (Jasnah and Sazed)
git submodule update --init --recursive

# 3. Install dependencies
bun install
```
