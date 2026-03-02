# Superpowers — Unified Architecture Plan

> *"The most important step a man can take. It's not the first one, is it? It's the next one."*
> — Dalinar Kholin, *Oathbringer*

This document captures the full architectural vision, technical decisions, and implementation plan for the Superpowers project — the parent system that unifies **Jasnah** (memory and knowledge) and **Sazed** (project management and analysis) into a cohesive AI-augmented development workflow.

It is intended to be read by both humans and AI agents (Claude Code, OpenCode). Drop it into a project root or reference it from `CLAUDE.md` to give the agent full context.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Origins and Design Philosophy](#2-origins-and-design-philosophy)
3. [Current State of Each Project](#3-current-state-of-each-project)
4. [The Unification Problem](#4-the-unification-problem)
5. [Proposed Architecture](#5-proposed-architecture)
6. [The Protocol Package](#6-the-protocol-package)
7. [The Orchestrator Package](#7-the-orchestrator-package)
8. [Unified Note Taxonomy](#8-unified-note-taxonomy)
9. [Retention Model](#9-retention-model)
10. [Secret Filtering](#10-secret-filtering)
11. [Feedback Loops](#11-feedback-loops)
12. [Skill System](#12-skill-system)
13. [Integration Patterns](#13-integration-patterns)
14. [Migration Plan](#14-migration-plan)
15. [Open Questions](#15-open-questions)
16. [External Influences](#16-external-influences)
17. [Naming Convention](#17-naming-convention)
18. [Reference: Agans' 9 Rules Mapping](#18-reference-agans-9-rules-mapping)

---

## 1. System Overview

Superpowers is a Bun monorepo that orchestrates two AI-augmented development tools:

**Jasnah** — The archivist. Extracts, stores, and retrieves persistent knowledge from coding sessions. Named after Jasnah Kholin, the scholar from Brandon Sanderson's Stormlight Archive.

- Memory extraction (decisions, insights, facts) from agent sessions
- Semantic search via Qdrant (hybrid dense + BM25 with Reciprocal Rank Fusion)
- Ebbinghaus forgetting curve retention model with automatic garbage collection
- Debug-trace skill grounded in David J. Agans' 9 Indispensable Rules of Debugging
- Postgres query skill with multi-environment support
- Git integration with auto-commit and worktree-aware storage
- Works with both OpenCode and Claude Code agents
- Global installation model: cloned once at `~/.local/share/jasnah`, symlinked into projects

**Sazed** — The planner. Analyzes Jira epics alongside the codebase and produces structured task breakdowns with domain knowledge extraction. Named after the Terrisman Keeper from Brandon Sanderson's Mistborn series.

- Fetches Jira epics (description, comments, linked issues)
- Generates repo-map (compact symbol index) for codebase context
- LLM-driven epic decomposition into implementation-ready tasks with estimates and acceptance criteria
- Domain knowledge extraction into evergreen notes with Ebbinghaus retention
- Task lifecycle management (status, diff, sync to Jira as subtasks)
- Effect TypeScript monorepo: core (domain types, service interfaces) → adapters (Jira, Git, LLM, filesystem) → cli → server (JSON-RPC, Phase 3)
- Two-step search: lightweight headers for triage, then full content on demand
- Five note types: domain-fact, architecture, api-contract, glossary, lesson-learned

**Superpowers** (this project) — The bond. The parent project that holds both as submodules, owns the shared protocol, and provides orchestration pipelines.

The three together form a knowledge-work operating system: Sazed looks forward (what should we build?), Jasnah looks backward (what do we already know?), and Superpowers ensures they feed each other.

---

## 2. Origins and Design Philosophy

The design philosophy emerges from several converging ideas:

### 2.1 Agans' 9 Indispensable Rules of Debugging

The foundational methodology underpinning the entire system. The key rules that shaped the architecture:

- **"Keep an Audit Trail"** — Jasnah's entire purpose. Every decision, insight, and fact is recorded with metadata, timestamps, and provenance. The memory system IS the audit trail for development knowledge.
- **"Quit Thinking and Look"** — The proactive search principle. Agents should search memories before starting work rather than guessing what they know. Sazed should consult prior context before analyzing an epic.
- **"Divide and Conquer"** — Applied to debugging via the debug-trace skill (place traces at boundaries, halve the search space), and to planning via Sazed's task decomposition (break epics into implementation-ready pieces).
- **"Change One Thing at a Time"** — The git worktree skill embodies this at the workspace level. Feature isolation prevents cross-contamination.
- **"Understand the System"** — Sazed's repo-map feeds actual codebase structure to the LLM before analysis. Don't plan against imagined architecture.
- **"If You Didn't Fix It, It Ain't Fixed"** — The debug-trace skill's verification step: confirm the fix with traces still in place, then verify again after cleanup.

### 2.2 Lessons from External Projects

Analysis of three external projects shaped the "add" and "rethink" items in this plan:

**Brainmaxxing** (poteto/brainmaxxing) — A persistent memory and self-improvement system for Claude Code using a markdown vault (Obsidian-compatible). Three learning loops: `/reflect` (in-session correction capture), `/ruminate` (mining past sessions for missed patterns), `/meditate` (pruning and synthesis).

What we took: The idea that agents should accumulate and refine knowledge across sessions, and that different timescales of learning require different mechanisms.

What we rejected: The "dump the entire brain index at startup" approach (context window cost scales linearly with brain size). Jasnah's two-step search (headers → content) and Sazed's header-based triage solve this more efficiently. We also note the "second brain failure mode" — knowledge bases that grow monotonically without pruning. The Ebbinghaus retention model with garbage collection is our answer.

**Agent Skills for Context Engineering** (muratcankoylan/Agent-Skills-for-Context-Engineering) — A skill taxonomy codifying context engineering as a discipline separate from prompt engineering. Progressive disclosure (skills load lazily), hierarchical taxonomy (foundational → architectural → operational → methodology).

What we took: The progressive disclosure principle (lazy-load skill content, don't front-load everything), and the insight that "smallest high-signal token set" should guide how much context gets injected.

What we rejected: The gap between principles and measured outcomes. The repo teaches what to think about but doesn't show how to measure whether you did it right. Sazed's `--no-map` flag for A/B quality audits provides the kind of empirical validation this approach needs.

**Hegelian Dialectic Skill** (KyleAMathews/hegelian-dialectic-skill) — Uses isolated AI "monks" (agents in separate contexts) to take fully committed opposing positions, then synthesizes via Hegel's determinate negation. Key insight: spawning agents in isolated contexts produces structurally decorrelated reasoning, not just different conclusions from shared premises.

What we took: The idea that high-stakes decisions benefit from adversarial reasoning, and that isolation is critical for getting genuine opposition rather than hedged agreement. This informed the proposed `--dialectic` mode for Sazed.

What we rejected: The cost (10-15 minutes per round, 3+ rounds). For most task breakdowns, a single analysis pass is sufficient. Dialectic mode should be opt-in for architectural decisions only.

### 2.3 Core Principles

These principles guide all design decisions:

1. **Methodology over magic.** Ground tools in established principles (Agans' Rules, spaced repetition research), not ad-hoc heuristics.
2. **Observe, don't guess.** Proactive search before work. Trace before fixing. Read the code before planning.
3. **Structured knowledge over raw noise.** Typed entries (decision/insight/fact) with metadata beat unstructured logs. Manual trace placement beats automatic injection.
4. **Graceful degradation.** Every optional dependency (Qdrant, psql, Jira) can be absent without breaking the core flow. Features degrade silently, never error loudly.
5. **Minimal high-signal context.** Two-step search, retention-based filtering, type-specific decay — every mechanism serves the goal of injecting the right knowledge at the right time, not all knowledge all the time.
6. **Canonical store, many producers.** One knowledge store (`.memory/`), many tools that write to it (Jasnah extraction, Sazed analysis, debug sessions, manual entries). Avoid dual-store drift.

---

## 3. Current State of Each Project

### 3.1 Jasnah — What Exists Today

**Repository:** `github.com/arioston/jasnah`
**Runtime:** Bun >= 1.0.0, TypeScript 5.x, OpenCode SDK 1.2.15+
**Installation:** Global at `~/.local/share/jasnah`, symlinked into projects via `install.sh`

**Core capabilities:**

- Memory extraction pipeline with inline (agent-driven) and transcript-based (JSONL) paths
- Storage as markdown with YAML frontmatter in `.memory/{decisions,insights,facts}/`
- File naming: `{type}-{uuid}-{slug}.md`
- Git auto-commit with configurable behavior (`amendIfUnpushed`, `commitPrefix`)
- TODO gating to prevent premature extraction
- Qdrant semantic search (optional): hybrid dense (all-MiniLM-L6-v2) + sparse (BM25), RRF fusion, project-scoped filtering, Ebbinghaus retention re-ranking
- Secret filtering (3-layer) before Qdrant sync
- Tombstoning (soft delete) for decayed memories

**Skills:**

| Skill | Purpose |
|---|---|
| `jasnah-debug-trace` | Structured debugging with trace utilities (Agans' 9 Rules) |
| `jasnah-query` | Postgres database interaction via psql |
| `jasnah-search-memory` | Semantic memory search (proactive, agent-triggered) |
| `jasnah-export-memory` | Session memory extraction command |

**Agent support:**

- OpenCode: Plugin exposes `jasnah_search_memory` tool + extraction command
- Claude Code: CLAUDE.md instructions for proactive search and inline extraction

**Configuration** (`.memory/config.yaml`):

```yaml
extraction:
  debounceMs: 2000
  todoGating: true
  minMessages: 5
  types: [decision, insight, fact]
storage:
  maxEntriesPerType: 100
git:
  autoCommit: true
  amendIfUnpushed: true
  commitPrefix: "memory:"
llm:
  temperature: 0.3
query:
  defaultEnvPrefix: "QUERY_DB_"
  requirePsql: true
qdrant:
  collectionName: "jasnah_memory"
  syncAfterExtraction: true
```

**Pack resolution chain:**

1. `JASNAH_ROOT` env var (explicit override)
2. `$XDG_DATA_HOME/jasnah` or `~/.local/share/jasnah` (global default)
3. `.memory/pack` in project root (backward compat)

### 3.2 Sazed — What Exists Today

**Repository:** `github.com/arioston/sazed`
**Runtime:** Bun >= 1.3, Effect TypeScript
**Architecture:** Bun monorepo with `packages/{core, adapters, cli, server}`

**Core capabilities:**

- Jira epic fetching (description, comments, linked issues) via REST API
- Repo-map generation: compact symbol index fed to LLM as codebase context. Supports incremental updates and full regeneration.
- LLM-driven epic decomposition: produces structured markdown with technical details, estimates, and acceptance criteria
- Domain knowledge extraction (`--notes` flag): writes evergreen notes during analysis
- Task lifecycle: `status` (staleness check), `diff` (snapshot comparison), `sync` (push to Jira as subtasks)
- JSON-RPC server (Phase 3, in progress)

**Note types:**

| Type | Purpose |
|---|---|
| `domain-fact` | Business rules and product constraints |
| `architecture` | System design decisions |
| `api-contract` | Interface agreements between services |
| `glossary` | Project-specific terminology |
| `lesson-learned` | Retrospective insights from past work |

**Retention model:** Same Ebbinghaus formula as Jasnah:

```
stability(n)    = 1.0 + ln(1 + n)
retention(t, s) = e^(-t / (HALF_LIFE * s / ln2))
```

Base half-life: 30 days. Stability grows logarithmically with access count. Notes below 10% retention excluded from LLM context. Notes below 1% are tombstone candidates.

**Two-step search:**

1. `searchHeaders` — returns `NoteHeader` (slug, title, type, tags, retention score) without loading bodies
2. `loadBySlug` — fetches full content for selected notes

**Secret filtering:** Same 3-layer approach as Jasnah (known prefixes, high-entropy strings, keyword proximity). Raises `SecretDetectedError` and blocks persistence.

**Optional semantic search:** Local embedding via `all-MiniLM-L6-v2` (384-dim dense vectors) using `@xenova/transformers`. Zero API cost after first-use download.

**CLI commands:**

```bash
sazed analyze EPIC-123              # Analyze epic, write to OUTPUT_DIR
sazed analyze EPIC-123 --notes      # Analyze + extract domain knowledge
sazed analyze EPIC-123 --no-map     # Analyze without repo-map (A/B testing)
sazed analyze EPIC-123 --stdout     # Print to stdout
sazed map                           # Generate/update repo map
sazed map --force                   # Full regeneration
sazed status EPIC-123               # Check refinement staleness
sazed diff EPIC-123                 # Diff between last two snapshots
sazed sync EPIC-123                 # Push tasks to Jira as subtasks
sazed sync EPIC-123 --dry-run       # Preview sync
sazed notes list                    # List notes with retention scores
sazed notes search QUERY            # Search by keyword
sazed notes show SLUG               # Show full note content
sazed notes gc                      # Tombstone decayed notes (<1%)
```

**Environment variables:**

| Variable | Required | Description |
|---|---|---|
| `JIRA_BASE_URL` | Yes | Jira instance URL |
| `JIRA_EMAIL` | Yes | Jira account email |
| `JIRA_API_TOKEN` | Yes | Jira API token |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `SAZED_USER` | No | Display name for attribution |
| `OUTPUT_DIR` | No | Refinement output (default: `.refinement`) |
| `GIT_ROOT` | No | Override git root for repo-map |
| `LLM_MODEL` | No | Claude model (default: `claude-sonnet-4-20250514`) |
| `JIRA_PROJECT_KEY` | Sync | Required for sync command |
| `JIRA_DRY_RUN` | No | Suppress all Jira writes |

### 3.3 Shared Skills (Currently in Jasnah or standalone)

| Skill | Current Location | Scope |
|---|---|---|
| `using-git-worktrees` | Jasnah skills/ | Cross-project (used by jira skill) |
| `jira` | Jasnah skills/ | Cross-project (orchestrates worktree + implementation) |
| `jasnah-debug-trace` | Jasnah skills/ | Jasnah-specific (debugging methodology) |
| `jasnah-query` | Jasnah skills/ | Jasnah-specific (database querying) |
| `jasnah-search-memory` | Jasnah skills/ | Jasnah-specific (memory retrieval) |
| `jasnah-export-memory` | Jasnah skills/ | Jasnah-specific (memory extraction) |

---

## 4. The Unification Problem

### 4.1 Why Unify?

Jasnah and Sazed share significant architectural DNA (Ebbinghaus retention, secret filtering, structured note types, markdown storage) but are separate repositories with separate knowledge stores. This creates several problems:

**Dual-store drift.** Sazed extracts domain knowledge during epic analysis and stores it in its own notes system. Jasnah extracts knowledge during coding sessions and stores it in `.memory/`. The same fact can exist in both stores with different formats, different retention metadata, and no awareness of each other.

**No feedback loop.** When Sazed analyzes EPIC-123, it doesn't know that three months ago, Jasnah recorded a decision about the payments service architecture that constrains how this epic should be implemented. When Jasnah extracts a debugging insight, Sazed doesn't know to factor it into future estimates for similar work.

**Skill ownership ambiguity.** The `jira` skill orchestrates across both systems (it needs worktree setup from Jasnah and epic understanding from Sazed), but currently lives in Jasnah's skills directory. The `using-git-worktrees` skill is general-purpose infrastructure, not memory-specific.

**Duplicated code.** Secret filtering, retention math, frontmatter parsing, and note type definitions are implemented independently in both projects. Changes to one don't propagate to the other.

### 4.2 What We're Not Trying to Do

We're NOT merging the two projects into one monolithic repo. Jasnah and Sazed have different concerns, different release cycles, and should remain independently usable. Jasnah must continue working as a standalone memory pack for projects that don't use Sazed. Sazed must continue working as a standalone CLI for teams that don't use Jasnah.

The superproject is a coordination layer, not a replacement.

---

## 5. Proposed Architecture

### 5.1 Directory Structure

```
superpowers/
├── packages/
│   ├── protocol/              # Shared contract: types, retention, secrets, frontmatter
│   │   ├── src/
│   │   │   ├── types.ts       # NoteType, NoteHeader, NoteEntry, MemoryEntry
│   │   │   ├── taxonomy.ts    # Unified 5-type taxonomy + legacy aliases
│   │   │   ├── retention.ts   # Ebbinghaus: stability(), retention(), type multipliers
│   │   │   ├── secrets.ts     # 3-layer secret detector
│   │   │   ├── frontmatter.ts # YAML frontmatter parse/serialize
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── orchestrator/          # Cross-system pipelines
│       ├── src/
│       │   ├── analyze-with-context.ts   # Sazed reads Jasnah → analyzes → writes back
│       │   ├── implement-ticket.ts       # Full ticket lifecycle pipeline
│       │   ├── audit.ts                  # Cross-session pattern detection
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── modules/
│   ├── jasnah/                # git submodule → github.com/arioston/jasnah
│   └── sazed/                 # git submodule → github.com/arioston/sazed
│
├── skills/                    # Skills that span both systems or are general-purpose
│   ├── using-git-worktrees/
│   │   └── SKILL.md
│   ├── jira/
│   │   ├── SKILL.md
│   │   └── jira-request.ts
│   └── dialectic/             # NEW: adversarial reasoning for decisions
│       └── SKILL.md
│
├── docs/
│   └── architecture-plan.md   # This document
│
├── package.json               # Bun workspace root
├── tsconfig.json              # Project references across everything
├── CLAUDE.md                  # Unified agent instructions
└── README.md
```

### 5.2 Workspace Configuration

```json
// package.json
{
  "name": "superpowers",
  "private": true,
  "workspaces": [
    "packages/*",
    "modules/jasnah",
    "modules/sazed/packages/*"
  ]
}
```

Sazed is itself a monorepo with `packages/{core,adapters,cli,server}`, so the workspace declaration reaches into the submodule's internal packages. Bun resolves dependencies across the entire tree, allowing Sazed's `core` package to import from `@superpowers/protocol`.

### 5.3 Submodule Setup

```bash
# Initialize the superproject
mkdir superpowers && cd superpowers
git init
bun init

# Add submodules
git submodule add https://github.com/arioston/jasnah.git modules/jasnah
git submodule add https://github.com/arioston/sazed.git modules/sazed

# Install all dependencies across the workspace
bun install
```

### 5.4 TypeScript Project References

```json
// tsconfig.json (root)
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "paths": {
      "@superpowers/protocol": ["./packages/protocol/src"],
      "@superpowers/orchestrator": ["./packages/orchestrator/src"]
    }
  },
  "references": [
    { "path": "./packages/protocol" },
    { "path": "./packages/orchestrator" },
    { "path": "./modules/jasnah" },
    { "path": "./modules/sazed/packages/core" },
    { "path": "./modules/sazed/packages/adapters" },
    { "path": "./modules/sazed/packages/cli" }
  ]
}
```

---

## 6. The Protocol Package

`@superpowers/protocol` is the shared contract between Jasnah and Sazed. It owns types, retention math, secret filtering, and frontmatter handling. Neither submodule imports the other — both import from protocol.

### 6.1 Types

```typescript
// packages/protocol/src/types.ts

export const NoteType = {
  DomainFact: "domain-fact",
  Architecture: "architecture",
  ApiContract: "api-contract",
  Glossary: "glossary",
  LessonLearned: "lesson-learned",
} as const;

export type NoteType = (typeof NoteType)[keyof typeof NoteType];

export interface NoteHeader {
  slug: string;
  title: string;
  type: NoteType;
  tags: string[];
  retentionScore: number;
  createdAt: Date;
}

export interface NoteEntry extends NoteHeader {
  content: string;
  summary: string;
  source: string;
  confidence: "high" | "medium" | "low";
  accessCount: number;
  lastAccessedAt: Date;
  tombstonedAt?: Date;
}

export interface RetentionMetadata {
  accessCount: number;
  lastAccessedAt: Date;
  stability: number;
  retentionScore: number;
}
```

### 6.2 Taxonomy with Legacy Aliases

```typescript
// packages/protocol/src/taxonomy.ts

import { NoteType } from "./types";

// Maps Jasnah's original 3-type system to the unified 5-type system
export const LegacyTypeMap: Record<string, NoteType> = {
  decision: NoteType.Architecture,
  insight: NoteType.LessonLearned,
  fact: NoteType.DomainFact,
} as const;

// Maps unified types to storage directory names
export const TypeDirectoryMap: Record<NoteType, string> = {
  "domain-fact": "domain-facts",
  "architecture": "architecture",
  "api-contract": "api-contracts",
  "glossary": "glossary",
  "lesson-learned": "lessons-learned",
} as const;

// Legacy directory names (Jasnah backward compat)
export const LegacyDirectoryMap: Record<string, string> = {
  decisions: "architecture",
  insights: "lessons-learned",
  facts: "domain-facts",
} as const;

export function resolveNoteType(input: string): NoteType {
  if (Object.values(NoteType).includes(input as NoteType)) {
    return input as NoteType;
  }
  if (input in LegacyTypeMap) {
    return LegacyTypeMap[input];
  }
  throw new Error(`Unknown note type: ${input}`);
}
```

### 6.3 Frontmatter Schema

```typescript
// packages/protocol/src/frontmatter.ts

import { NoteEntry, NoteType } from "./types";

export interface NoteFrontmatter {
  id: string;
  title: string;
  type: NoteType;
  summary: string;
  tags: string[];
  confidence: "high" | "medium" | "low";
  source: string;
  createdAt: string; // ISO 8601
  lastAccessedAt: string;
  accessCount: number;
  stability: number;
  retentionScore: number;
  tombstonedAt?: string;
}

// Example serialized frontmatter:
//
// ---
// id: a7f3b2c1-4d5e-6f7a-8b9c-0d1e2f3a4b5c
// title: Use Postgres for analytics pipeline
// type: architecture
// summary: Chose Postgres over ClickHouse for analytics due to team familiarity
// tags: [database, analytics, architecture]
// confidence: high
// source: sazed:EPIC-456
// createdAt: 2026-02-15T10:30:00Z
// lastAccessedAt: 2026-02-28T14:00:00Z
// accessCount: 3
// stability: 2.10
// retentionScore: 0.85
// ---
```

---

## 7. The Orchestrator Package

`@superpowers/orchestrator` provides pipelines that compose Jasnah and Sazed workflows. These are the high-level operations that require both systems.

### 7.1 Analyze With Context

The most important pipeline. When Sazed analyzes an epic, it first queries Jasnah for relevant prior knowledge, then feeds that context alongside the repo-map and Jira data to the LLM.

```
┌─────────────────────────────────────────────────────────────────┐
│                    analyze-with-context                          │
│                                                                 │
│  1. Search Jasnah memories (architecture, domain-fact,          │
│     api-contract) related to the epic's affected areas          │
│                                                                 │
│  2. Run Sazed's refineEpic with prior context injected          │
│     into the LLM prompt alongside repo-map + Jira data          │
│                                                                 │
│  3. Extract new domain knowledge from analysis results           │
│                                                                 │
│  4. Write extracted notes back to Jasnah's .memory/ store       │
│     via extract-inline.ts                                        │
│                                                                 │
│  Result: Analysis is informed by history; new knowledge          │
│  is captured for future analyses.                                │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Implement Ticket (Full Lifecycle)

The complete pipeline from ticket to PR:

```
┌──────────────────────────────────────────────────────────────┐
│                     implement-ticket                          │
│                                                               │
│  1. Fetch Jira ticket (jira skill)                            │
│  2. Assign + transition to In Progress                        │
│  3. Search Jasnah for prior context on affected areas         │
│  4. Optionally run Sazed analysis for task breakdown          │
│  5. Create git worktree (using-git-worktrees skill)           │
│  6. Implement changes                                         │
│  7. Debug if needed (jasnah-debug-trace skill)                │
│  8. Run tests, commit, push                                   │
│  9. Create PR                                                 │
│  10. Comment on Jira ticket with PR link                      │
│  11. Extract session memories (jasnah-export-memory)          │
└──────────────────────────────────────────────────────────────┘
```

### 7.3 Audit (Cross-Session Pattern Detection)

A periodic analysis command that looks across multiple sessions and epics to detect recurring patterns:

```
┌──────────────────────────────────────────────────────────────┐
│                         audit                                 │
│                                                               │
│  1. Load all memories from .memory/ (or query Qdrant)         │
│  2. Cluster related entries by tags, types, and semantic       │
│     similarity                                                │
│  3. Detect patterns:                                          │
│     - Recurring blockers ("auth module causes issues")        │
│     - Estimate accuracy ("DB migrations always 2x actual")   │
│     - Decision oscillation ("reversed this choice 3 times")  │
│     - Knowledge gaps ("no architecture notes for service X")  │
│  4. Surface meta-insights as new lesson-learned entries       │
│  5. Report findings to user                                   │
└──────────────────────────────────────────────────────────────┘
```

### 7.4 Dialectic (Adversarial Reasoning for Decisions)

Inspired by the Hegelian Dialectic Skill. For high-stakes architectural decisions, run two isolated LLM analyses with different constraints, then synthesize.

```
┌──────────────────────────────────────────────────────────────┐
│                       dialectic                               │
│                                                               │
│  1. Identify the decision point from user input               │
│  2. Spawn Agent A with constraint set 1 (isolated context)   │
│     "Assume we migrate to a new database"                     │
│  3. Spawn Agent B with constraint set 2 (isolated context)   │
│     "Assume we adapt the existing schema"                     │
│  4. Both produce: task breakdown, risk analysis, estimates    │
│  5. Synthesizer agent receives both outputs (no shared prior) │
│     Produces: recommended approach, trade-off analysis,       │
│     what each side gets right, where they conflict            │
│  6. Write result as architecture note with alternatives field │
│  7. Optionally feed into Sazed for refined task breakdown     │
└──────────────────────────────────────────────────────────────┘
```

Usage: `superpowers dialectic "Should we introduce event sourcing for the order service?"`

---

## 8. Unified Note Taxonomy

### 8.1 The Five Types

| Type | Purpose | Examples | Storage Directory |
|---|---|---|---|
| `domain-fact` | Business rules, product constraints, data relationships | "Orders over $10k require manager approval" | `domain-facts/` |
| `architecture` | Design decisions, technology choices, trade-offs | "Chose Postgres over ClickHouse for analytics" | `architecture/` |
| `api-contract` | Interface agreements between services, external APIs | "Payment webhook expects idempotency key header" | `api-contracts/` |
| `glossary` | Project-specific terminology and definitions | "In our system, 'settlement' means the batch process that runs at midnight" | `glossary/` |
| `lesson-learned` | Retrospective insights, gotchas, debugging discoveries | "JWT refresh race condition when tabs share storage" | `lessons-learned/` |

### 8.2 Legacy Compatibility

Jasnah's original three types map cleanly:

| Legacy Type | Legacy Directory | Maps To | New Directory |
|---|---|---|---|
| `decision` | `decisions/` | `architecture` | `architecture/` |
| `insight` | `insights/` | `lesson-learned` | `lessons-learned/` |
| `fact` | `facts/` | `domain-fact` | `domain-facts/` |

During the migration period, both directory structures exist. The search layer recognizes both. New entries use the 5-type system. The `resolveNoteType()` function handles aliasing transparently.

### 8.3 Updated .memory/ Structure

```
.memory/
├── architecture/
│   ├── architecture-a7f3b2c1-use-postgres-for-analytics.md
│   └── architecture-d8773ef4-adopt-event-sourcing.md
├── domain-facts/
│   └── domain-fact-32379097-api-rate-limit-100-per-min.md
├── api-contracts/
│   └── api-contract-f1e2d3c4-payment-webhook-idempotency.md
├── glossary/
│   └── glossary-b5a6c7d8-settlement-batch-process.md
├── lessons-learned/
│   └── lesson-learned-8dbf2b4c-jwt-refresh-race-condition.md
├── config.yaml
├── locks/
│
├── # Legacy directories (read-only, kept for backward compat)
├── decisions/    → symlink or alias to architecture/
├── insights/     → symlink or alias to lessons-learned/
└── facts/        → symlink or alias to domain-facts/
```

---

## 9. Retention Model

### 9.1 Core Formula (Shared)

```
stability(n)    = 1.0 + ln(1 + n)
retention(t, s) = e^(-t / (HALF_LIFE * s / ln2))
```

Where:
- `n` = access count (how many times the note appeared in an LLM context)
- `t` = time since last access (in days)
- `s` = stability (grows logarithmically with access count)
- `HALF_LIFE` = base half-life in days (default: 30)

### 9.2 Type-Specific Half-Life Multipliers (NEW)

Different note types have different natural lifespans. A glossary term is near-permanent; a lesson-learned from last sprint is time-sensitive.

```typescript
// packages/protocol/src/retention.ts

const BASE_HALF_LIFE_DAYS = 30;

const halfLifeMultipliers: Record<NoteType, number> = {
  "glossary": 3.0,       // ~90 day effective half-life
  "domain-fact": 2.0,    // ~60 days
  "architecture": 1.5,   // ~45 days
  "api-contract": 1.0,   // 30 days (default)
  "lesson-learned": 0.5, // ~15 days
};

export function effectiveHalfLife(type: NoteType): number {
  return BASE_HALF_LIFE_DAYS * (halfLifeMultipliers[type] ?? 1.0);
}

export function stability(accessCount: number): number {
  return 1.0 + Math.log(1 + accessCount);
}

export function retention(
  daysSinceAccess: number,
  accessCount: number,
  type: NoteType
): number {
  const s = stability(accessCount);
  const halfLife = effectiveHalfLife(type);
  return Math.exp(-daysSinceAccess / (halfLife * s / Math.LN2));
}
```

### 9.3 Thresholds

| Threshold | Value | Action |
|---|---|---|
| `RETENTION_CONTEXT_THRESHOLD` | 10% | Notes below this are excluded from LLM context injection |
| `TOMBSTONE_THRESHOLD` | 1% | Notes below this are candidates for `notes gc` (soft delete) |

### 9.4 Retention Table (with type multipliers)

For a note with 0 accesses (stability = 1.0):

| Days | glossary (3.0x) | domain-fact (2.0x) | architecture (1.5x) | api-contract (1.0x) | lesson-learned (0.5x) |
|---|---|---|---|---|---|
| 7 | 95% | 92% | 89% | 85% | 72% |
| 30 | 79% | 71% | 63% | 50% | 25% |
| 60 | 63% | 50% | 40% | 25% | 6% |
| 90 | 50% | 35% | 25% | 13% | 2% |
| 120 | 40% | 25% | 16% | 6% | <1% |

---

## 10. Secret Filtering

### 10.1 Three-Layer Detection (Shared)

Both Jasnah and Sazed use identical secret detection before persisting any note. The protocol package provides the canonical implementation.

**Layer 1 — Known prefix patterns.** Matches 24+ well-known token formats:
- GitHub PATs: `ghp_`, `gho_`, `ghu_`, `ghs_`, `github_pat_`
- AWS access keys: `AKIA...`
- Anthropic/OpenAI: `sk-ant-...`, `sk-...`
- Slack: `xox[bpaosr]-...`
- JWTs: `eyJ...eyJ...`
- Stripe, SendGrid, Twilio, Mailgun, npm, PyPI, GitLab, Cloudflare, and others

**Layer 2 — High-entropy strings.** Flags hex strings of 32+ characters or base64 strings of 17+ characters whose Shannon entropy exceeds 3.0 bits/character. A code-identifier heuristic suppresses false positives from variable names, file paths, and camelCase identifiers.

**Layer 3 — Keyword proximity.** Flags any high-entropy candidate (entropy > 3.2 bits/char) appearing within 50 characters of credential keywords: `token`, `password`, `secret`, `api_key`, `bearer`, `private_key`.

### 10.2 Behavior on Detection

A `SecretDetectedError` is raised with a masked snippet. The note is NOT written to disk and NOT synced to Qdrant. The error is logged but does not halt the pipeline — other notes in the same batch proceed normally.

---

## 11. Feedback Loops

### 11.1 Sazed → Jasnah (Knowledge Extraction)

When `sazed analyze --notes` runs, extracted domain knowledge should be written into Jasnah's `.memory/` store using the protocol format. This ensures one canonical store.

**Current state:** Sazed writes to its own notes store.
**Target state:** Sazed pipes extracted notes through Jasnah's `extract-inline.ts` (or directly writes using the shared protocol's frontmatter serializer) into the project's `.memory/` directory.

```bash
# Sazed analysis extracts notes, pipes to Jasnah
echo "$EXTRACTED_NOTES_JSON" | bun run "$JASNAH/scripts/extract-inline.ts" \
  --root "$PROJECT_ROOT" \
  --source "sazed:EPIC-123"
```

### 11.2 Jasnah → Sazed (Context Injection)

When Sazed starts an epic analysis, it should first search Jasnah memories for relevant prior context. This context gets injected into the LLM prompt alongside the repo-map and Jira data.

**Current state:** No cross-system context.
**Target state:** The orchestrator's `analyze-with-context` pipeline searches Jasnah before calling Sazed's analysis.

### 11.3 Post-Sprint Reflection (NEW)

After a sprint, when actuals are known (what tasks took longer, what was missed, what blockers appeared), feed corrections back as `lesson-learned` entries:

```bash
# Manual reflection after sprint
echo '[
  {
    "type": "lesson-learned",
    "summary": "DB migration estimates consistently 2x actual",
    "content": "Across EPIC-101, EPIC-115, and EPIC-128, database migration tasks took roughly double the original estimate. Primary cause: schema changes trigger cascade updates in dependent services that are not captured in the initial analysis.",
    "tags": ["estimation", "database", "migration"],
    "confidence": "high"
  }
]' | bun run "$JASNAH/scripts/extract-inline.ts" --root "$PWD" --source "sprint-retro:sprint-42"
```

### 11.4 Cross-Session Pattern Detection (NEW)

The `audit` pipeline periodically (or on-demand) scans the memory store for:
- Recurring tags/topics that co-occur with `lesson-learned` entries (systematic problem areas)
- Decision entries that have been superseded or reversed (oscillation)
- Estimation patterns across multiple Sazed analyses vs. actuals
- Knowledge gaps (codebase areas with no architecture or api-contract notes)

---

## 12. Skill System

### 12.1 Skill Ownership After Unification

| Skill | Location | Rationale |
|---|---|---|
| `jasnah-debug-trace` | `modules/jasnah/skills/` | Tightly coupled to Jasnah's trace utilities |
| `jasnah-query` | `modules/jasnah/skills/` | Tightly coupled to Jasnah's psql scripts |
| `jasnah-search-memory` | `modules/jasnah/skills/` | Operates on Jasnah's memory store |
| `jasnah-export-memory` | `modules/jasnah/skills/` | Drives Jasnah's extraction pipeline |
| `using-git-worktrees` | `superpowers/skills/` | General-purpose, used by multiple skills |
| `jira` | `superpowers/skills/` | Orchestrates across worktree + implementation |
| `dialectic` | `superpowers/skills/` (NEW) | Orchestrates isolated LLM agents for decisions |

### 12.2 Skill Composition Protocol

Skills can invoke other skills. The current pattern (jira skill calls worktree skill) should be formalized:

```
# In a skill's SKILL.md, declare dependencies:
---
name: jira
depends-on: [using-git-worktrees, jasnah-search-memory]
---
```

The full pipeline for ticket implementation:

```
jira (entry point)
├── jasnah-search-memory (prior context)
├── using-git-worktrees (workspace isolation)
├── [implementation phase]
│   └── jasnah-debug-trace (if needed)
├── jasnah-export-memory (capture learnings)
└── jira (comment with PR link)
```

### 12.3 Debug Trace Skill — Key Details

The debug-trace skill implements a 10-step methodology derived from Agans' Rules:

1. **UNDERSTAND** — Read relevant code paths before touching anything
2. **SET UP** — Install trace utility (backend writer, frontend client, debug endpoint)
3. **REPRODUCE** — Document exact reproduction steps, write to session header
4. **DIVIDE AND CONQUER** — Place traces at boundaries, halve the search space
5. **OBSERVE** — Read trace file, grep for patterns (`grep "req-abc123" /tmp/debug-trace.log`)
6. **NARROW** — Remove traces from good half, add deeper traces in bad half, repeat
7. **CHECK THE PLUG** — Verify the obvious (server running? correct URL? env vars set?)
8. **FIX** — Address root cause, not symptom
9. **VERIFY** — Confirm fix with traces in place, then again after cleanup
10. **CLEAN UP** — Remove all debug instrumentation (tracked via files-modified manifest)

Trace output format: `[ISO-TIMESTAMP] [CORRELATION-ID] [frontend|backend] [LOCATION] DATA`

Correlation IDs link frontend and backend traces for a single user action. Generated per action, passed as `X-Trace-Id` header, extracted by middleware.

---

## 13. Integration Patterns

### 13.1 How Sazed Calls Jasnah (via CLI)

The recommended integration pattern for the initial phase. Sazed shells out to Jasnah's CLI scripts, which are stable and well-tested entry points.

**Reading (search):**

```typescript
import { resolveJasnahRoot } from "@superpowers/protocol";

const jasnah = resolveJasnahRoot(); // JASNAH_ROOT → XDG → ~/.local/share/jasnah
const result = Bun.spawnSync(
  ["bun", "run", `${jasnah}/scripts/search-memory.ts`, query, "--type", "architecture", "--limit", "5"],
  { cwd: projectRoot }
);
const memories = JSON.parse(result.stdout.toString());
```

**Writing (extract):**

```typescript
const notes = JSON.stringify(extractedNotes);
const proc = Bun.spawn(
  ["bun", "run", `${jasnah}/scripts/extract-inline.ts`, "--root", projectRoot, "--source", `sazed:${epicKey}`],
  { stdin: new TextEncoder().encode(notes) }
);
```

Latency: ~200ms per subprocess call. Negligible for epic analysis (one search + one extract per run).

### 13.2 How Sazed Calls Jasnah (via Workspace Import — Future)

When both are in the superproject workspace, direct imports become possible:

```typescript
// Inside Sazed's refineEpic workflow
import { searchMemory } from "@superpowers/jasnah/search";
import { extractInline } from "@superpowers/jasnah/extract";

const priorDecisions = await searchMemory({
  query: "payments service architecture",
  type: "architecture",
  limit: 10,
});

await extractInline(notes, { root: projectRoot, source: `sazed:${epicKey}` });
```

This requires Jasnah to expose a programmatic API (not just CLI scripts). The current architecture is script-based, so this is a Phase 3+ target.

### 13.3 Standalone Compatibility

Jasnah MUST continue working without the superproject. The protocol package provides types and utilities that Jasnah can optionally depend on:

- **When running inside superproject workspace:** Imports live from `@superpowers/protocol`
- **When running standalone (globally installed):** Uses bundled copies of the types and functions

This is conceptually similar to how Sazed's Effect adapters work: the core defines interfaces, adapters provide implementations, and what's available depends on the runtime context.

### 13.4 Agent Instructions (CLAUDE.md)

The superproject's CLAUDE.md provides unified agent instructions:

```markdown
# Superpowers

This project orchestrates Jasnah (memory) and Sazed (planning) for AI-augmented development.

## Before Starting Work

1. Search memories for prior context on the area you're working in:
   JASNAH="${JASNAH_ROOT:-$HOME/.local/share/jasnah}"
   bun run "$JASNAH/scripts/search-memory.ts" "<relevant query>"

2. If working on an epic, run analysis with context:
   bun run packages/orchestrator/src/analyze-with-context.ts EPIC-XXX

## After Completing Work

1. Extract session memories:
   bun run "$JASNAH/scripts/extract-inline.ts" --root "$PWD" --source "session-description"

## Skills Available

- jasnah-debug-trace: Structured debugging (use for runtime bugs)
- jasnah-query: Database querying (use for data investigation)
- using-git-worktrees: Workspace isolation (use before feature work)
- jira: Full ticket lifecycle (fetch → implement → PR → comment)
```

---

## 14. Migration Plan

### Phase 1: Scaffold (no code changes to submodules)

- Create the superpowers repo
- Add Jasnah and Sazed as git submodules
- Set up Bun workspace with correct `workspaces` config
- Verify `bun install` resolves across the entire tree
- Move `using-git-worktrees` and `jira` skills to `superpowers/skills/`
- Create initial `CLAUDE.md` with unified instructions
- Create `docs/architecture-plan.md` (this document)

Deliverable: A working workspace where you can `cd modules/jasnah && bun test` and `cd modules/sazed && bun test` without issues.

### Phase 2: Extract Protocol Package

- Create `packages/protocol/` with types, taxonomy, retention, secrets, frontmatter
- Write tests for all protocol functions
- Verify retention math matches both Jasnah and Sazed implementations
- Add type-specific half-life multipliers
- Add legacy alias support (`decision` → `architecture`, etc.)

Deliverable: `@superpowers/protocol` passes all tests and both submodules' existing tests still pass.

### Phase 3: Wire Jasnah to Protocol

- Update Jasnah to import types from `@superpowers/protocol` when available
- Implement fallback: when running standalone, use bundled types
- Update search to recognize both old (3-type) and new (5-type) directory structures
- Update extraction to write new entries using the 5-type system
- Keep legacy directories as symlinks or aliases for backward compat

Deliverable: Jasnah works identically in both standalone and workspace modes. Old memories are still findable.

### Phase 4: Wire Sazed to Protocol

- Update Sazed's `core` package to import types from `@superpowers/protocol`
- Update note extraction to use the shared frontmatter format
- Add CLI option for Sazed to write notes into Jasnah's `.memory/` (via `extract-inline.ts` or direct file write)

Deliverable: `sazed analyze EPIC-123 --notes` writes to `.memory/` in the protocol format.

### Phase 5: Build Orchestrator

- Implement `analyze-with-context`: search Jasnah → analyze with Sazed → extract back
- Implement `implement-ticket`: full lifecycle pipeline
- Wire up the orchestrator as CLI commands or as skill instructions

Deliverable: `superpowers analyze EPIC-123` runs the full feedback loop.

### Phase 6: Advanced Features

- Implement `audit` (cross-session pattern detection)
- Implement `dialectic` (adversarial reasoning for decisions)
- Build the reflection/correction capture mechanism for post-sprint retrospectives
- Explore cross-project knowledge sharing (global insights tier)

Deliverable: Full feature set as described in this document.

---

## 15. Open Questions

### 15.1 Parent Project Name

Cosmere naming convention. Candidates:

| Name | Character | Thematic Fit |
|---|---|---|
| **Dalinar** | The Bondsmith (Stormlight Archive) | Unifier — his power is literally Connection, binding separate things together |
| **Navani** | Engineer/scholar, Jasnah's mother (Stormlight Archive) | Builder of connective infrastructure. Also literally the parent of Jasnah. |
| **Harmony** | Sazed's ascended form (Mistborn) | Two forces (Ruin + Preservation) unified. But common word, namespace collision risk. |
| **Hoid** | The Cosmere's persistent character | Moves between worlds carrying knowledge. Short, memorable. But trickster connotation. |

### 15.2 RPC Server as Integration Point

Sazed has a Phase 3 JSON-RPC server in progress. Should this become the unified integration point, where Jasnah also exposes RPC methods? This would be the most decoupled approach but adds infrastructure (a running daemon). Worth exploring if the system grows beyond CLI invocations.

### 15.3 Cross-Project Knowledge

Currently, all memories are scoped to a single project (filtered by git remote in Qdrant). Should there be a "global insights" tier that captures transferable knowledge?

Example: "Next.js middleware runs on the edge runtime, so you can't use Node.js-specific APIs" is universally true, not project-specific.

This would require a separate Qdrant collection (or a `global` flag on notes) and more aggressive secret filtering.

### 15.4 Extraction Quality

Currently, agents self-assess what's worth extracting. This is efficient (no extra API cost) but may miss important context or capture noise. Options:

- Human-in-the-loop confirmation before committing memories
- Second-pass validation by a different LLM call
- Confidence-weighted extraction (only auto-commit "high" confidence, prompt for "medium")
- Post-hoc review command: `superpowers review-recent` shows last N extractions for approval

### 15.5 Repo-Map Freshness

Sazed's repo-map is a compact symbol index fed to the LLM. If stale, it will reference deleted files. Questions:

- Does incremental update use git diff? (If so, it's solid.)
- Should the map include a freshness timestamp?
- Should the analysis warn when the map is older than N days?

---

## 16. External Influences

### 16.1 Brainmaxxing (poteto/brainmaxxing)

**What it is:** Persistent memory/self-improvement system for Claude Code. Markdown vault (Obsidian-compatible) with three learning loops: `/reflect` (in-session corrections), `/ruminate` (mine past sessions), `/meditate` (prune and synthesize).

**What we adopted:**
- The principle that agents should accumulate and refine knowledge across sessions
- Different timescales of learning need different mechanisms
- Markdown + Obsidian as storage layer (human-readable, version-controllable)

**What we explicitly rejected:**
- Injecting entire brain index at startup (context window cost)
- Monotonic growth without strong pruning (our Ebbinghaus model + GC addresses this)

**Key quote from review:** "The core insight — that agents should accumulate and refine knowledge across sessions — is right. The execution is clean and minimal. The main risks are around scaling and curation as the brain grows."

### 16.2 Agent Skills for Context Engineering (muratcankoylan)

**What it is:** A codified skill taxonomy for context engineering as a discipline. Progressive disclosure architecture (skills lazy-load), four-tier taxonomy (foundational → architectural → operational → methodology).

**What we adopted:**
- Progressive disclosure / lazy-loading of skill content
- "Smallest high-signal token set" principle
- Skill taxonomy with clear trigger descriptions

**What we explicitly rejected:**
- The gap between principles and measured outcomes
- BDI mental states / formal RDF ontologies (academic overkill for production systems)

**Key quote from review:** "Your Agans-grounded approach fills exactly [the measurement] gap — the audit trail from principle → implementation → measured outcome is more rigorous."

### 16.3 Hegelian Dialectic Skill (KyleAMathews)

**What it is:** Uses isolated AI agents ("Electric Monks") taking fully committed opposing positions, then synthesizes via Hegel's determinate negation. Key insight: isolated contexts produce structurally decorrelated reasoning.

**What we adopted:**
- Adversarial reasoning for high-stakes decisions (the `dialectic` pipeline)
- The critical importance of context isolation for genuine opposition
- The idea of writing decision entries that capture both chosen and rejected alternatives

**What we explicitly rejected:**
- The full ceremony (10-15 min per round, 3+ rounds) for routine decisions
- Making it the default mode (it's opt-in via `--dialectic`)

**Key quote from review:** "This is one of the more intellectually serious agent skills I've seen. It's the debugging skill philosophy applied to reasoning itself."

---

## 17. Naming Convention

All projects in this ecosystem use names from Brandon Sanderson's Cosmere universe:

| Project | Character | Source | Role |
|---|---|---|---|
| Jasnah | Jasnah Kholin | Stormlight Archive | The scholar who accumulates knowledge |
| Sazed | Sazed of Terris | Mistborn | The Keeper who stores and retrieves coppermind memories |
| (Parent) | TBD | Cosmere | The binding force that unifies |

The `superpowers` namespace is used for paths (e.g., `~/.config/superpowers/worktrees/`) but the git repo and package names should use the chosen Cosmere character name.

Skill names follow the convention `^[a-z0-9]+(-[a-z0-9]+)*$` (lowercase with hyphens).

---

## 18. Reference: Agans' 9 Rules Mapping

How each of Agans' 9 Indispensable Rules maps to the Superpowers ecosystem:

| Rule | Application |
|---|---|
| **Understand the System** | Sazed reads repo-map before analysis. Debug-trace skill reads code paths before instrumenting. Agents search memories before starting work. |
| **Make It Fail** | Debug-trace Step 3: Document exact reproduction steps. Write to session header via `startSession()`. |
| **Quit Thinking and Look** | Proactive memory search. Trace-first debugging. The entire philosophy: observe, don't guess. |
| **Divide and Conquer** | Debug-trace Step 4: Place traces at boundaries, halve the search space. Sazed: decompose epics into tasks. |
| **Change One Thing at a Time** | Git worktree skill: isolated workspace per feature. Debug-trace: instrument first, then fix (never both at once). |
| **Keep an Audit Trail** | Jasnah's entire purpose. Structured memory extraction. Trace output format. Git auto-commit of memories. |
| **Check the Plug** | Debug-trace Step 7: Verify the obvious before deep diving. Is the server running? Are env vars set? |
| **Get a Fresh View** | Dialectic pipeline: isolated agents provide genuinely different perspectives. Cross-session audit surfaces patterns you've stopped noticing. |
| **If You Didn't Fix It, It Ain't Fixed** | Debug-trace Step 9: Verify with traces in place, then again after cleanup. A fix that only works with debug code is not a fix. |

---

*Document generated from architecture review session, March 2, 2026.*
*Source conversations: debugging skill brainstorm, brainmaxxing review, context engineering review, hegelian dialectic review, Jasnah project knowledge, Sazed README.*
