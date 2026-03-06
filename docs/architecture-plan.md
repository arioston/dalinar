# Dalinar — Unified Architecture Plan

> *"The most important step a man can take. It's not the first one, is it? It's the next one."*
> — Dalinar Kholin, *Oathbringer*

This document captures the full architectural vision, technical decisions, and implementation plan for the **Dalinar** project — the parent system that unifies **Jasnah** (memory and knowledge), **Sazed** (project management and analysis), and **Hoid** (calendar and cross-system utilities) into a cohesive AI-augmented development workflow.

Named after Dalinar Kholin, the Bondsmith whose Surgebinding power is Connection — the ability to bridge, bind, and unify.

It is intended to be read by both humans and AI agents (Claude Code, OpenCode). Drop it into a project root or reference it from `CLAUDE.md` to give the agent full context.

> **Status (March 2026):** All six implementation phases are structurally complete. The Effect.ts migration is done with 6 typed pipelines, 8 error types, and injectable services. Hoid calendar integration is live. See [protocol-reference.md](protocol-reference.md) and [pipelines-reference.md](pipelines-reference.md) for API details. Known gaps are tracked in [Section 14.1](#141-known-gaps).

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

Dalinar is a Bun monorepo that orchestrates three AI-augmented development tools:

**Jasnah** — The archivist. Extracts, stores, and retrieves persistent knowledge from coding sessions. Named after Jasnah Kholin, the scholar from Brandon Sanderson's Stormlight Archive.

- Memory extraction (decisions, insights, facts) from agent sessions
- Semantic search via Qdrant Cloud (hybrid dense + BM25 with Reciprocal Rank Fusion) or LanceDB (local zero-config fallback)
- Ebbinghaus forgetting curve retention model with automatic garbage collection
- Debug-trace skill grounded in David J. Agans' 9 Indispensable Rules of Debugging
- Postgres query skill with multi-environment support
- Git integration with auto-commit and worktree-aware storage
- Works with both OpenCode and Claude Code agents
- Global installation model: cloned once at `~/.local/share/jasnah`, symlinked into projects

**Sazed** — The planner. Analyzes Jira epics or document files alongside the codebase and produces structured task breakdowns with domain knowledge extraction. Named after the Terrisman Keeper from Brandon Sanderson's Mistborn series.

- Fetches Jira epics (description, comments, linked issues, attachments) or parses local documents (PDF, Word, Markdown, etc.) via `EpicResolverService`
- Generates repo-map (compact symbol index) for codebase context
- LLM-driven epic decomposition into implementation-ready tasks with estimates and acceptance criteria
- Domain knowledge extraction into evergreen notes with Ebbinghaus retention
- Task lifecycle management (status, diff, sync to Jira as subtasks)
- Effect TypeScript monorepo: core (domain types, service interfaces) → adapters (Jira, Git, LLM, filesystem) → cli → server (JSON-RPC, Phase 3)
- Two-step search: lightweight headers for triage, then full content on demand
- Five note types: domain-fact, architecture, api-contract, glossary, lesson-learned

**Hoid** — The connector. Unified calendar interface across Google Calendar and Microsoft Graph, supporting multiple accounts per provider. Named after Hoid, the world-hopping storyteller from Brandon Sanderson's Cosmere universe.

- Lists events, finds free slots, creates and moves events, detects scheduling conflicts
- Uses raw `fetch()` for API calls, Zod schemas for all types
- Sweep-line algorithms for merge/availability/conflict operations
- Multi-account support (personal + work calendars across providers)
- Hosts cross-project skills (gsap-react, image-to-webp, sanity-tools)

**Dalinar** (this project) — The bond. The parent project that holds all three as submodules, owns the shared protocol, and provides orchestration pipelines.

The four together form a knowledge-work operating system: Sazed looks forward (what should we build?), Jasnah looks backward (what do we already know?), Hoid handles logistics (when are we available?), and Dalinar ensures they feed each other.

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

What we took: The idea that high-stakes decisions benefit from adversarial reasoning, and that isolation is critical for getting genuine opposition rather than hedged agreement. This informed the `dialectic` pipeline.

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
- Semantic search: Qdrant Cloud (hybrid dense + sparse BM25, RRF fusion) or LanceDB (local zero-config default), project-scoped filtering, Ebbinghaus retention re-ranking
- Secret filtering (3-layer) before vector sync
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

- Epic source resolution via `EpicResolverService`: accepts Jira keys (`EPIC-123`) or document files (`.md`, `.txt`, `.pdf`, `.docx`, `.pptx`, `.xlsx`)
- Document parsing via `DocumentParserService` for non-code files (PDF, Word, Excel, PowerPoint, images)
- Jira epic fetching (description, comments, linked issues, attachments) via REST API
- Repo-map generation: compact symbol index fed to LLM as codebase context. Supports incremental updates and full regeneration.
- LLM-driven epic decomposition: explores codebase via tool calls, then produces structured markdown with technical details, estimates, and acceptance criteria
- Domain knowledge extraction (`--notes` flag): writes evergreen notes during analysis
- Task lifecycle: `status` (staleness check), `diff` (snapshot comparison), `sync` (push to Jira as subtasks)
- Git forensics: hotspot analysis, temporal coupling, ownership patterns
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
cd modules/sazed

bun run packages/cli/src/main.ts analyze EPIC-123              # Analyze epic
bun run packages/cli/src/main.ts analyze ./specs/design.pdf     # Analyze from document
bun run packages/cli/src/main.ts analyze EPIC-123 --notes       # Analyze + extract domain knowledge
bun run packages/cli/src/main.ts analyze EPIC-123 --no-map      # Analyze without repo-map (A/B testing)
bun run packages/cli/src/main.ts analyze EPIC-123 --stdout      # Print to stdout
bun run packages/cli/src/main.ts analyze EPIC-123 --forensics   # Auto-generate forensics report
bun run packages/cli/src/main.ts map                            # Generate/update repo map
bun run packages/cli/src/main.ts map --force                    # Full regeneration
bun run packages/cli/src/main.ts forensics                      # Git forensics report
bun run packages/cli/src/main.ts status EPIC-123                # Check refinement staleness
bun run packages/cli/src/main.ts diff EPIC-123                  # Diff between last two snapshots
bun run packages/cli/src/main.ts sync EPIC-123                  # Push tasks to Jira as subtasks
bun run packages/cli/src/main.ts sync EPIC-123 --dry-run        # Preview sync
bun run packages/cli/src/main.ts notes list                     # List notes with retention scores
bun run packages/cli/src/main.ts notes search QUERY             # Search by keyword
bun run packages/cli/src/main.ts notes show SLUG                # Show full note content
bun run packages/cli/src/main.ts notes gc                       # Tombstone decayed notes (<1%)
```

**Environment variables:**

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `JIRA_BASE_URL` | For Jira | Jira instance URL |
| `JIRA_EMAIL` | For Jira | Jira account email |
| `JIRA_API_TOKEN` | For Jira | Jira API token |
| `SAZED_USER` | No | Display name for attribution |
| `OUTPUT_DIR` | No | Refinement output (default: `.refinement`) |
| `GIT_ROOT` | No | Override git root for repo-map |
| `LLM_MODEL` | No | Claude model (default: `claude-sonnet-4-20250514`) |
| `JIRA_PROJECT_KEY` | Sync | Required for sync command |
| `JIRA_DRY_RUN` | No | Suppress all Jira writes |
| `TOOL_CALL_BUDGET` | No | Exploration tool call limit (default: 25) |
| `REFINEMENT_CONCURRENCY` | No | Parallel task refinement (default: 3) |

### 3.3 Hoid — What Exists Today

**Repository:** `github.com/arioston/hoid`
**Runtime:** Bun >= 1.0.0, TypeScript 5.x, Zod
**Architecture:** Bun monorepo with `packages/{core, calendar, cli, skills}`

**Core capabilities:**

- Multi-provider calendar: Google Calendar + Microsoft Graph via unified interface
- Multi-account: personal and work calendars across providers
- OAuth2 authentication with refresh token management
- Event listing, free slot discovery, event creation, event moving, conflict detection
- Sweep-line algorithms for efficient merge/availability operations
- Cross-project skills: gsap-react, image-to-webp, sanity-tools

**Package structure:**

- `@hoid/core` — Zod schemas, config loader, OAuth2 auth
- `@hoid/calendar` — Provider adapters, merge algorithms, operations
- `@hoid/cli` — CLI entry points for subprocess integration
- `packages/skills/` — Standalone agent skills (not calendar-specific)

**CLI commands:**

```bash
cd modules/hoid

# Account management
bun run packages/cli/src/calendar-auth.ts --add              # Add new account (interactive)
bun run packages/cli/src/calendar-auth.ts --account work     # Login (OAuth flow)
bun run packages/cli/src/calendar-auth.ts --status           # Check auth status

# Calendar operations
bun run packages/cli/src/calendar-list.ts --days 7 --json
bun run packages/cli/src/calendar-free-slots.ts --days 5 --min-duration 30 --working-hours 9-17 --json
bun run packages/cli/src/calendar-create.ts --title "Standup" --start "2026-03-15T09:00:00" --end "2026-03-15T09:30:00" --account work --json
bun run packages/cli/src/calendar-move.ts --event-id ID --source work --new-start "2026-03-15T10:00:00" --new-end "2026-03-15T10:30:00"
bun run packages/cli/src/calendar-conflicts.ts --days 7 --json
```

### 3.4 Shared Skills

| Skill | Current Location | Scope |
|---|---|---|
| `using-git-worktrees` | `dalinar/skills/` | Cross-project (used by jira skill) |
| `jira` | `dalinar/skills/` | Cross-project (orchestrates worktree + implementation) |
| `calendar` | `dalinar/skills/` | Cross-project (unified Google + Microsoft calendar) |
| `dialectic` | `dalinar/skills/` | Cross-project (adversarial reasoning for decisions) |
| `reducing-entropy` | `dalinar/skills/` | Cross-project (codebase minimization methodology) |
| `jasnah-debug-trace` | `modules/jasnah/skills/` → symlinked | Jasnah-specific (debugging methodology) |
| `jasnah-query` | `modules/jasnah/skills/` → symlinked | Jasnah-specific (database querying) |
| `jasnah-search-memory` | `modules/jasnah/skills/` → symlinked | Jasnah-specific (memory retrieval) |
| `jasnah-export-memory` | `modules/jasnah/skills/` → symlinked | Jasnah-specific (memory extraction) |
| `gsap-react` | `modules/hoid/packages/skills/` → symlinked | Hoid-hosted (GSAP + React animation patterns) |
| `image-to-webp` | `modules/hoid/packages/skills/` → symlinked | Hoid-hosted (image conversion to WebP) |
| `sanity-tools` | `modules/hoid/packages/skills/` → symlinked | Hoid-hosted (Sanity CMS operations) |

---

## 4. The Unification Problem

### 4.1 Why Unify?

Jasnah and Sazed share significant architectural DNA (Ebbinghaus retention, secret filtering, structured note types, markdown storage) but are separate repositories with separate knowledge stores. This creates several problems:

**Dual-store drift.** Sazed extracts domain knowledge during epic analysis and stores it in its own notes system. Jasnah extracts knowledge during coding sessions and stores it in `.memory/`. The same fact can exist in both stores with different formats, different retention metadata, and no awareness of each other.

**No feedback loop.** When Sazed analyzes EPIC-123, it doesn't know that three months ago, Jasnah recorded a decision about the payments service architecture that constrains how this epic should be implemented. When Jasnah extracts a debugging insight, Sazed doesn't know to factor it into future estimates for similar work.

**Skill ownership ambiguity.** The `jira` skill orchestrates across both systems (it needs worktree setup from Jasnah and epic understanding from Sazed), but currently lives in Jasnah's skills directory. The `using-git-worktrees` skill is general-purpose infrastructure, not memory-specific.

**Duplicated code.** Secret filtering, retention math, frontmatter parsing, and note type definitions are implemented independently in both projects. Changes to one don't propagate to the other.

### 4.2 What We're Not Trying to Do

We're NOT merging the projects into one monolithic repo. Jasnah, Sazed, and Hoid have different concerns, different release cycles, and should remain independently usable. Jasnah must continue working as a standalone memory pack for projects that don't use Sazed. Sazed must continue working as a standalone CLI for teams that don't use Jasnah. Hoid must continue working as a standalone calendar system.

The superproject is a coordination layer, not a replacement.

---

## 5. Architecture

### 5.1 Directory Structure

```
dalinar/
├── packages/
│   ├── protocol/              # Shared contract: types, retention, secrets, frontmatter, vault
│   │   ├── src/
│   │   │   ├── types.ts       # NoteType, NoteHeader, NoteEntry, RetentionMetadata
│   │   │   ├── taxonomy.ts    # Unified 5-type taxonomy + legacy aliases
│   │   │   ├── retention.ts   # Ebbinghaus: stability(), retention(), type multipliers
│   │   │   ├── secrets.ts     # 3-layer secret detector
│   │   │   ├── frontmatter.ts # YAML frontmatter parse/serialize
│   │   │   ├── vault.ts       # Obsidian vault sync config (WORK_LOG_PATH)
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── orchestrator/          # Cross-system pipelines
│       ├── src/
│       │   ├── analyze-with-context.ts   # Sazed reads Jasnah → analyzes → writes back
│       │   ├── implement-ticket.ts       # Full ticket lifecycle pipeline
│       │   ├── audit.ts                  # Cross-session pattern detection
│       │   ├── dialectic.ts              # Adversarial reasoning for decisions
│       │   ├── reflect.ts               # Post-sprint retrospective capture
│       │   ├── vault-sync.ts            # Sync .memory/ to Obsidian vault
│       │   ├── jasnah.ts                # Jasnah integration (search, extract)
│       │   ├── sazed.ts                 # Sazed integration (analysis runner)
│       │   ├── hoid.ts                  # Hoid integration (calendar operations)
│       │   ├── resolve-key.ts           # Jira key resolution (task → parent epic)
│       │   ├── extract-notes.ts         # Pure extraction: analysis markdown → notes
│       │   ├── skills.ts                # Skill discovery & dependency validation
│       │   ├── index.ts
│       │   └── effect/                  # Effect.ts typed pipeline layer
│       │       ├── errors.ts            # 8 Schema.TaggedError types
│       │       ├── services.ts          # JasnahService, SazedService, HoidService
│       │       ├── subprocess.ts        # SubprocessService (wraps Bun.$)
│       │       ├── runtime.ts           # OrchestratorLive layer + runCli helper
│       │       ├── pipelines/           # 6 Effect.gen pipeline implementations
│       │       ├── ticket/              # State machine (Data.tagged + Match.value)
│       │       ├── wal/                 # Write-ahead log with atomic promotion
│       │       └── context/             # Mise snapshots with SHA-256 hash caching
│       ├── package.json
│       └── tsconfig.json
│
├── modules/
│   ├── jasnah/                # git submodule → github.com/arioston/jasnah
│   ├── sazed/                 # git submodule → github.com/arioston/sazed
│   └── hoid/                  # git submodule → github.com/arioston/hoid
│
├── skills/                    # Skills that span systems or are general-purpose
│   ├── using-git-worktrees/   # Workspace isolation for feature work
│   ├── jira/                  # Full ticket lifecycle (fetch → implement → PR)
│   ├── calendar/              # Unified calendar operations (Hoid-powered)
│   ├── dialectic/             # Adversarial reasoning for decisions
│   ├── reducing-entropy/      # Codebase minimization methodology
│   ├── jasnah-debug-trace → ../modules/jasnah/skills/jasnah-debug-trace
│   ├── jasnah-query → ../modules/jasnah/skills/jasnah-query
│   ├── jasnah-search-memory → ../modules/jasnah/skills/jasnah-search-memory
│   ├── jasnah-export-memory → ../modules/jasnah/skills/jasnah-export-memory
│   ├── gsap-react → ../modules/hoid/packages/skills/gsap-react
│   ├── image-to-webp → ../modules/hoid/packages/skills/image-to-webp
│   └── sanity-tools → ../modules/hoid/packages/skills/sanity-tools
│
├── docs/
│   ├── architecture-plan.md   # This document
│   ├── protocol-reference.md  # Protocol package API reference
│   └── pipelines-reference.md # Orchestrator pipelines guide
│
├── setup.sh                   # Full setup script (Linux/macOS)
├── setup.bat                  # Full setup script (Windows)
├── package.json               # Bun workspace root
├── tsconfig.json              # Project references
├── CLAUDE.md                  # Unified agent instructions
└── README.md
```

### 5.2 Workspace Configuration

```json
// package.json
{
  "name": "dalinar",
  "private": true,
  "workspaces": [
    "packages/*",
    "modules/jasnah",
    "modules/sazed/packages/*",
    "modules/hoid/packages/*"
  ]
}
```

Sazed is itself a monorepo with `packages/{core,adapters,cli,server}`, so the workspace declaration reaches into the submodule's internal packages. Hoid similarly has `packages/{core,calendar,cli,skills}`. Bun resolves dependencies across the entire tree, allowing both submodules' packages to import from `@dalinar/protocol`.

### 5.3 Submodule Setup

```bash
# Initialize the superproject
mkdir dalinar && cd dalinar
git init
bun init

# Add submodules
git submodule add https://github.com/arioston/jasnah.git modules/jasnah
git submodule add https://github.com/arioston/sazed.git modules/sazed
git submodule add https://github.com/arioston/hoid.git modules/hoid

# Install all dependencies across the workspace
bun install
```

Or use the setup script which handles all of this automatically:

```bash
./setup.sh          # Linux / macOS
setup.bat           # Windows
```

The setup script is idempotent and handles: submodule init, `bun install`, Jasnah memory pack, skill symlinks (project and global), `.env` from template, and Hoid calendar config.

### 5.4 TypeScript Project References

```json
// tsconfig.json (root)
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "paths": {
      "@dalinar/protocol": ["./packages/protocol/src"],
      "@dalinar/orchestrator": ["./packages/orchestrator/src"]
    }
  },
  "references": [
    { "path": "./packages/protocol" },
    { "path": "./packages/orchestrator" }
  ]
}
```

Module subprojects (Jasnah, Sazed, Hoid) manage their own TypeScript compilation independently. The root tsconfig only references the Dalinar-owned packages.

---

## 6. The Protocol Package

`@dalinar/protocol` is the shared contract between Jasnah and Sazed. It owns types, retention math, secret filtering, frontmatter handling, and vault configuration. Neither submodule imports the other — both import from protocol.

For detailed API reference, see [protocol-reference.md](protocol-reference.md).

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
```

### 6.4 Vault Configuration

```typescript
// packages/protocol/src/vault.ts

export interface VaultConfig {
  workLogPath: string;
  projectName: string;
  excludes: string[];
}

// Opt-in via WORK_LOG_PATH env var
// Resolves vault paths for Obsidian Work Log sync
// Coexists with HoldGate folders in the same vault
```

See [protocol-reference.md](protocol-reference.md) for full vault API.

---

## 7. The Orchestrator Package

`@dalinar/orchestrator` provides seven pipelines that compose Jasnah, Sazed, and Hoid workflows. These are the high-level operations that require multiple systems. See [pipelines-reference.md](pipelines-reference.md) for full API details.

### 7.1 Analyze With Context

The most important pipeline. When Sazed analyzes an epic, it first queries Jasnah for relevant prior knowledge, then feeds that context alongside the repo-map and Jira data to the LLM.

```
┌─────────────────────────────────────────────────────────────────┐
│                    analyze-with-context                          │
│                                                                 │
│  1. Resolve key (task → parent epic if needed via Jira API)     │
│                                                                 │
│  2. Search Jasnah memories (architecture, domain-fact,          │
│     api-contract, lesson-learned) related to the epic           │
│                                                                 │
│  3. Run Sazed's refineEpic with prior context injected          │
│     into the LLM prompt alongside repo-map + Jira data          │
│                                                                 │
│  4. Extract new domain knowledge from analysis results          │
│                                                                 │
│  5. Write extracted notes back to Jasnah's .memory/ store       │
│                                                                 │
│  6. Sync .memory/ to Obsidian vault (if WORK_LOG_PATH set)     │
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

Usage: `bun run packages/orchestrator/src/dialectic.ts "Should we introduce event sourcing for the order service?"`

### 7.5 Reflect (Post-Sprint Retrospective Capture)

Captures corrections and learnings after a sprint when actuals are known, feeding them back as memory entries to improve future analyses.

```
┌──────────────────────────────────────────────────────────────┐
│                       reflect                                │
│                                                              │
│  Input: JSON with sprint reflection data                     │
│                                                              │
│  Converts to memories:                                       │
│    estimateAccuracy → lesson-learned (estimate-drift tag)    │
│    blockers (unanticipated) → lesson-learned (blocker tag)   │
│    wins (replicable) → domain-fact (best-practice tag)       │
│    revisions → architecture (decision-revision tag)          │
│                                                              │
│  Extracts to Jasnah with sprint source tag for dedup         │
└──────────────────────────────────────────────────────────────┘
```

Usage: `echo '<json>' | bun run packages/orchestrator/src/reflect.ts --sprint sprint-42`

### 7.6 Vault Sync

Opt-in sync of `.memory/` to an Obsidian vault's Work Log folder. Runs automatically as part of `analyze-with-context`, or can be invoked standalone.

```
┌──────────────────────────────────────────────────────────────┐
│                       vault-sync                              │
│                                                              │
│  1. Check WORK_LOG_PATH (skip silently if not set)           │
│  2. Infer project name from git repo root                    │
│  3. rsync .memory/ → $WORK_LOG_PATH/<project>/               │
│     (excludes: config.yaml, locks/, raw/, index.json)        │
│  4. Obsidian Sync picks up changes automatically             │
└──────────────────────────────────────────────────────────────┘
```

Usage: `bun run packages/orchestrator/src/vault-sync.ts [project-root]`

### 7.7 Effect.ts Layer

All seven orchestrator pipelines have Effect.ts counterparts with typed errors, injectable services, and test layers. The CLI entrypoints try the Effect pipeline first with a fallback to the original async function.

**Services** (`Context.Tag` with subprocess transport):

| Service | Purpose |
|---|---|
| `JasnahService` | Memory search, extraction, context formatting |
| `SazedService` | Epic analysis runner |
| `HoidService` | Calendar operations (list, free-slots, create, move, conflicts) |
| `SubprocessService` | Wraps `Bun.$` — all services depend on it |

**Error types** (`Schema.TaggedError`):

`SubprocessError`, `JasnahError`, `SazedError`, `HoidError`, `VaultSyncError`, `FileOperationError`, `TicketStateError`, `ParseError`

**Runtime:**

- `OrchestratorLive` = `Layer.mergeAll(JasnahServiceLive, SazedServiceLive, HoidServiceLive)` provided with `SubprocessServiceLive`
- `runCli()` helper maps errors to exit codes

**Advanced subsystems** (built, pending consumer integration):

- **TicketStore** — File-based state machine in `.orders/tickets/` with states: `Unclaimed → Claimed → InProgress → Done | Blocked`. Uses `Data.tagged` unions + `Match.value` for exhaustive transitions.
- **WALService** — Crash-safe order logging via `orders-next.json → orders.json` atomic promotion using `Effect.acquireRelease`.
- **SnapshotService** — Mise-style context snapshots with `Schema.Class` types, SHA-256 content hashing, and `Ref`-based caching.

Tests: `bun test packages/orchestrator/src/effect/` (1,400+ lines across 4 test files)

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

### 9.2 Type-Specific Half-Life Multipliers

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

export function computeStability(accessCount: number): number {
  return 1.0 + Math.log(1 + accessCount);
}

export function computeRetention(
  daysSinceAccess: number,
  stability: number,
): number {
  return Math.exp(-daysSinceAccess / (BASE_HALF_LIFE_DAYS * stability / Math.LN2));
}

export function computeTypedRetention(
  daysSinceAccess: number,
  accessCount: number,
  type: NoteType
): number {
  const s = computeStability(accessCount);
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

**Layer 1 — Known prefix patterns.** Matches 20+ well-known token formats:
- GitHub PATs: `ghp_`, `gho_`, `ghu_`, `ghs_`, `github_pat_`
- AWS access keys: `AKIA...`
- Anthropic/OpenAI: `sk-ant-...`, `sk-...`
- Slack: `xox[bpaosr]-...`
- JWTs: `eyJ...eyJ...`
- Stripe, SendGrid, Twilio, Mailgun, npm, PyPI, GitLab, Cloudflare, Discord, Telegram, and others

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
JASNAH="${JASNAH_ROOT:-$HOME/.local/share/jasnah}"
echo "$EXTRACTED_NOTES_JSON" | bun run "$JASNAH/scripts/extract-inline.ts" \
  --root "$PROJECT_ROOT" \
  --source "sazed:EPIC-123"
```

### 11.2 Jasnah → Sazed (Context Injection)

When Sazed starts an epic analysis, it should first search Jasnah memories for relevant prior context. This context gets injected into the LLM prompt alongside the repo-map and Jira data.

**Current state:** Implemented via the `analyze-with-context` pipeline.
**How:** The orchestrator's `analyze-with-context` pipeline searches Jasnah before calling Sazed's analysis, injecting relevant memories as prompt context.

### 11.3 Post-Sprint Reflection

After a sprint, when actuals are known (what tasks took longer, what was missed, what blockers appeared), feed corrections back as `lesson-learned` entries:

```bash
# Manual reflection after sprint
echo '{
  "estimateAccuracy": [
    { "taskDescription": "DB migration", "estimatedEffort": "2d", "actualEffort": "5d",
      "reason": "Cascade updates in dependent services" }
  ],
  "blockers": [
    { "description": "Auth service rate limiting", "impact": "Delayed testing by 1 day",
      "wasAnticipated": false }
  ]
}' | bun run packages/orchestrator/src/reflect.ts --sprint sprint-42
```

### 11.4 Cross-Session Pattern Detection

The `audit` pipeline periodically (or on-demand) scans the memory store for:
- Recurring tags/topics that co-occur with `lesson-learned` entries (systematic problem areas)
- Decision entries that have been superseded or reversed (oscillation)
- Estimation patterns across multiple Sazed analyses vs. actuals
- Knowledge gaps (codebase areas with no architecture or api-contract notes)

### 11.5 Obsidian Vault Sync

The `vault-sync` pipeline optionally mirrors `.memory/` to an Obsidian vault's Work Log folder, making extracted knowledge browseable alongside HoldGate notes. Activated by setting `WORK_LOG_PATH`.

---

## 12. Skill System

### 12.1 Skill Ownership After Unification

| Skill | Location | Rationale |
|---|---|---|
| `using-git-worktrees` | `dalinar/skills/` | General-purpose workspace isolation |
| `jira` | `dalinar/skills/` | Orchestrates across worktree + implementation |
| `calendar` | `dalinar/skills/` | Unified calendar operations via Hoid |
| `dialectic` | `dalinar/skills/` | Adversarial reasoning for architectural decisions |
| `reducing-entropy` | `dalinar/skills/` | Codebase minimization methodology |
| `jasnah-debug-trace` | `modules/jasnah/skills/` → symlinked | Tightly coupled to Jasnah's trace utilities |
| `jasnah-query` | `modules/jasnah/skills/` → symlinked | Tightly coupled to Jasnah's psql scripts |
| `jasnah-search-memory` | `modules/jasnah/skills/` → symlinked | Operates on Jasnah's memory store |
| `jasnah-export-memory` | `modules/jasnah/skills/` → symlinked | Drives Jasnah's extraction pipeline |
| `gsap-react` | `modules/hoid/packages/skills/` → symlinked | GSAP + React animation patterns |
| `image-to-webp` | `modules/hoid/packages/skills/` → symlinked | Image conversion to WebP via cwebp |
| `sanity-tools` | `modules/hoid/packages/skills/` → symlinked | Sanity CMS operations |

### 12.2 Skill Composition Protocol

Skills can invoke other skills. The current pattern (jira skill calls worktree skill) is formalized via SKILL.md frontmatter:

```
# In a skill's SKILL.md, declare dependencies:
---
name: jira
depends-on: [using-git-worktrees, jasnah-search-memory]
---
```

The `discoverSkills()` and `validateDependencies()` functions in `packages/orchestrator/src/skills.ts` parse and check these dependencies.

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

The recommended integration pattern. Sazed shells out to Jasnah's CLI scripts, which are stable and well-tested entry points.

**Reading (search):**

```typescript
const jasnah = process.env.JASNAH_ROOT ?? `${process.env.HOME}/.local/share/jasnah`;
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

### 13.2 How the Orchestrator Calls Hoid (via CLI)

Calendar operations follow the same subprocess pattern:

```typescript
// packages/orchestrator/src/hoid.ts
const hoidRoot = resolve(dalinarRoot, "modules/hoid");
const result = Bun.spawnSync(
  ["bun", "run", `${hoidRoot}/packages/cli/src/calendar-list.ts`, "--days", "7", "--json"],
);
```

The `HoidService` in the Effect layer wraps these calls with typed errors (`HoidError`) and injectable test layers.

### 13.3 Standalone Compatibility

Each submodule MUST continue working without the superproject. The protocol package provides types and utilities that submodules can optionally depend on:

- **When running inside superproject workspace:** Imports live from `@dalinar/protocol`
- **When running standalone (globally installed):** Uses bundled copies of the types and functions

```typescript
// Top-level await dynamic import with fallback
let _protocol: typeof import("@dalinar/protocol") | null = null
try {
  _protocol = await import("@dalinar/protocol")
} catch {
  // Not in Dalinar workspace — use local implementations
}
```

This ensures both submodules work identically whether standalone or inside the Dalinar workspace.

---

## 14. Implementation History

> **All six phases completed March 2026. Effect.ts migration and Hoid integration also complete.**

### Phase 1: Scaffold — COMPLETED

- Created the Dalinar repo with orphan branch for clean history
- Added Jasnah and Sazed as git submodules under `modules/`
- Set up Bun workspace with `workspaces: ["packages/*", "modules/jasnah", "modules/sazed/packages/*"]`
- Moved `using-git-worktrees` and `jira` skills to `skills/`
- Created `CLAUDE.md`, `README.md`, and `docs/architecture-plan.md`

### Phase 2: Extract Protocol Package — COMPLETED

- Created `packages/protocol/` with types, taxonomy, retention, secrets, frontmatter, vault
- 61+ tests covering all protocol functions (including vault configuration)
- Retention math validated against architecture plan table values
- Type-specific half-life multipliers and legacy alias support (`decision` → `architecture`, etc.)

### Phase 3: Wire Jasnah to Protocol — COMPLETED

- Jasnah imports from `@dalinar/protocol` via optional dependency + top-level await dynamic import fallback
- Search recognizes both old (3-type) and new (5-type) directory structures (8 dirs total with dedup)
- Extraction supports all 8 note types with correct directory mapping
- All Jasnah tests pass in both standalone and workspace modes

### Phase 4: Wire Sazed to Protocol — COMPLETED

- Sazed core and adapters packages wired to `@dalinar/protocol` as optional dependencies
- `Retention.ts`, `SecretFilter.ts`, and `frontmatter.ts` delegate to protocol when available, fall back to local copies when standalone
- All 169 Sazed tests pass

### Phase 5: Build Orchestrator — COMPLETED

- `analyze-with-context`: search Jasnah → Sazed analysis → extract knowledge back → vault sync
- `implement-ticket`: full lifecycle pipeline (context → analysis → worktree → implementation plan)
- `vault-sync`: opt-in Obsidian vault sync via `WORK_LOG_PATH`
- Jasnah integration module (search, extract, format context for prompts)
- Sazed integration module (subprocess wrapper around CLI)

### Phase 6: Advanced Features — COMPLETED

- `audit`: cross-session pattern detection (recurring blockers, decision oscillation, knowledge gaps, tag clusters)
- `dialectic`: adversarial reasoning for decisions (Hegelian synthesis with isolated agent prompts)
- `reflect`: post-sprint retrospective capture (estimate drift, blockers, wins, decision revisions → memories)
- Dialectic skill definition at `skills/dialectic/SKILL.md`

### Phase 7: Effect.ts Migration — COMPLETED

- All 7 pipelines migrated to `Effect.gen` chains with typed errors
- 3 injectable services: `JasnahService`, `SazedService`, `HoidService` (all via `SubprocessService`)
- 8 `Schema.TaggedError` types for structured error handling
- `OrchestratorLive` layer composition + `runCli()` error-to-exit-code helper
- Ticket state machine: `Data.tagged` unions + `Match.value` exhaustive transitions
- WAL: crash-safe `orders-next.json → orders.json` promotion via `Effect.acquireRelease`
- Context snapshots: `Schema.Class` types + SHA-256 content hashing + `Ref`-based caching
- 1,400+ lines of tests across 6 test files
- CLI fallback: try Effect pipeline, catch fallback to original async function

### Phase 8: Hoid Integration — COMPLETED

- Added Hoid as third git submodule (`modules/hoid/`)
- `HoidService` + `HoidError` in Effect layer
- `hoid.ts` integration module for calendar subprocess calls
- `calendar` skill in `skills/` with full SKILL.md
- `setup.sh`/`setup.bat` updated to handle Hoid submodule, skill symlinks, and calendar config
- Hoid-hosted skills (gsap-react, image-to-webp, sanity-tools) symlinked into `skills/`
- Workspace config updated: `modules/hoid/packages/*`

### Phase 9: Extraction Enhancement (Phase A) — COMPLETED

- Task key resolution: detect task key → resolve to parent epic via Jira API
- Enriched Jasnah search with task key for narrower context
- Richer knowledge extraction from analysis output (5 extraction rules, 8-note budget)
- `resolve-key.ts` and `extract-notes.ts` shared modules

### Future Work

- Deep analysis pipeline (Phase B): full epic→task hierarchy analysis with per-task retrospectives
- Cross-project knowledge sharing (global insights tier with separate Qdrant collection)
- RPC server as unified integration point (building on Sazed's Phase 3 JSON-RPC server)
- Extraction quality improvements (human-in-the-loop, confidence-weighted auto-commit)
- `dalinar review-recent` command for post-hoc memory review

### 14.1 Known Gaps

Areas where the implementation is structurally in place but not yet fully enforced or automated:

| Area | Status | Detail |
|------|--------|--------|
| Skill dependency enforcement | Documented + validated | `discoverSkills`/`validateDependencies` parse and check deps; no runtime enforcement blocking skill invocation |
| Dialectic automation | Manual invocation | Pipeline exists but is not auto-triggered by commit patterns or CI |
| Audit coverage | Core patterns | Detects decision oscillation and recurring blockers; does not yet cover knowledge staleness or cross-project duplication |
| Memory extraction in skills | Documented in jira skill | Other skills (worktrees, dialectic) do not yet include extraction steps |
| Effect CLI fallback | Partial | Only `analyze-with-context` has explicit Effect→async fallback; others have Effect counterparts but use async in CLI |
| TicketStore/WAL/Snapshot | Built, no consumer | State machine, WAL, and snapshots exist but are not yet wired into a live pipeline |
| Deep analysis (Phase B) | Planned | Full epic→task hierarchy with per-task retrospectives — designed but not implemented |

---

## 15. Open Questions

### 15.1 Parent Project Name — RESOLVED

**Chosen: Dalinar** — The Bondsmith from the Stormlight Archive. His Surgebinding power is literally Connection — the ability to bridge, bind, and unify separate things. Package namespace: `@dalinar/*`. Repository: `github.com/arioston/dalinar`.

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
- Post-hoc review command: `dalinar review-recent` shows last N extractions for approval

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

### 16.4 Noodle (poteto/noodle)

**What it is:** Autonomous multi-agent orchestrator in Go. Runs multiple LLM agents in parallel on isolated git worktrees, coordinates via files, merges results. "Kitchen brigade" metaphor: scheduler → cooks → merge.

**What we adopted:**
- Everything-is-a-file coordination (JSON/NDJSON on disk, no DB/MQ/RPC)
- Write-ahead promotion pattern (orders-next.json → orders.json)
- Mise context snapshots (single JSON with everything the scheduler needs)
- Ticket protocol for work claiming (claim → progress → done → blocked → release)
- Mechanical stage advancement (execute → quality → reflect, no LLM judgment between stages)

**What we explicitly rejected:**
- Go language (stay with Effect-TS)
- Multi-agent parallelism (Sazed is single-analysis pipeline)
- Web UI (Sazed → Bonsai TUI)
- Process-level isolation (Sazed uses API directly for fine-grained control)

---

## 17. Naming Convention

All projects in this ecosystem use names from Brandon Sanderson's Cosmere universe:

| Project | Character | Source | Role |
|---|---|---|---|
| **Dalinar** | Dalinar Kholin, the Bondsmith | Stormlight Archive | The unifier — Connection binds separate systems together |
| **Jasnah** | Jasnah Kholin, the scholar | Stormlight Archive | The archivist who accumulates knowledge |
| **Sazed** | Sazed of Terris, the Keeper | Mistborn | The planner who stores and retrieves coppermind memories |
| **Hoid** | Hoid, the world-hopper | Cosmere (all series) | The connector — bridges worlds, carries information everywhere |

Package namespace: `@dalinar/*`. Repository: `github.com/arioston/dalinar`.

Skill names follow the convention `^[a-z0-9]+(-[a-z0-9]+)*$` (lowercase with hyphens).

---

## 18. Reference: Agans' 9 Rules Mapping

How each of Agans' 9 Indispensable Rules maps to the Dalinar ecosystem:

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
*All six phases implemented March 2, 2026. Effect.ts migration, Hoid integration, and extraction enhancement completed March 2026.*
*Updated March 6, 2026: Synced with actual codebase state — added Hoid, Effect.ts layer, vault-sync, extraction enhancement, updated skill inventory and implementation history.*
*Source conversations: debugging skill brainstorm, brainmaxxing review, context engineering review, hegelian dialectic review, Jasnah project knowledge, Sazed README, noodle analysis.*
