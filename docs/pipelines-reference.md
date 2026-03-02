# Pipelines Reference — `@dalinar/orchestrator`

The orchestrator provides six pipelines that compose Jasnah (memory) and Sazed (planning) workflows. These are the high-level operations that require both systems working together.

## analyze-with-context

The core Dalinar pipeline. When Sazed analyzes an epic, it first queries Jasnah for relevant prior knowledge, then feeds that context alongside the repo-map and Jira data to the LLM.

```
┌─────────────────────────────────────────────────────────────┐
│                  analyze-with-context                        │
│                                                             │
│  1. Search Jasnah memories (architecture, domain-fact,      │
│     api-contract, lesson-learned) related to the epic       │
│                                                             │
│  2. Run Sazed analysis with prior context injected          │
│                                                             │
│  3. Extract new domain knowledge from analysis results      │
│     and write back to Jasnah's memory store                 │
│                                                             │
│  Result: Analysis informed by history; new knowledge        │
│  captured for future analyses.                              │
└─────────────────────────────────────────────────────────────┘
```

### Usage

```bash
bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123
bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123 --force --notes
bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123 --forensics --no-cache
```

### Flags

| Flag | Description |
|------|-------------|
| `--force` | Re-analyze even if nothing changed |
| `--notes` | Extract evergreen domain notes after analysis |
| `--no-map` | Skip loading the repo map |
| `--no-cache` | Skip exploration cache |
| `--forensics` | Auto-generate forensics report |

### Programmatic API

```typescript
import { analyzeWithContext } from "@dalinar/orchestrator"

await analyzeWithContext({
  epicKey: "EPIC-123",
  force: true,
  notes: true,
  root: "/path/to/project",
})
```

---

## implement-ticket

Full lifecycle pipeline from Jira ticket to implementation context. Designed to be invoked by an AI agent — it handles context gathering and environment setup while the agent handles implementation.

```
┌──────────────────────────────────────────────────────────────┐
│                   implement-ticket                            │
│                                                              │
│  1. Search Jasnah for prior context on affected areas        │
│  2. Optionally run Sazed analysis for task breakdown         │
│  3. Optionally create git worktree for isolated work         │
│  4. Output implementation plan for the agent to execute      │
│  5. After implementation: extract session memories           │
└──────────────────────────────────────────────────────────────┘
```

### Usage

```bash
bun run packages/orchestrator/src/implement-ticket.ts PROJ-456
bun run packages/orchestrator/src/implement-ticket.ts PROJ-456 --analyze --worktree
```

### Flags

| Flag | Description |
|------|-------------|
| `--analyze` | Run Sazed analysis for task breakdown |
| `--worktree` | Create a git worktree for isolated work |

### Programmatic API

```typescript
import { implementTicket, postImplementExtract } from "@dalinar/orchestrator"

const context = await implementTicket({
  ticketKey: "PROJ-456",
  shouldAnalyze: true,
  useWorktree: true,
  root: process.cwd(),
})

// After implementation is complete:
await postImplementExtract("PROJ-456", [
  { type: "lesson-learned", summary: "...", content: "...", tags: ["..."], confidence: "high" },
], context.worktreePath)
```

---

## audit

Periodic analysis that scans the memory store for patterns across sessions and epics.

```
┌──────────────────────────────────────────────────────────────┐
│                         audit                                │
│                                                              │
│  1. Load all memories from .memory/                          │
│  2. Analyze by tags, types, and co-occurrence                │
│  3. Detect patterns:                                         │
│     - Recurring blockers (tags with 3+ lessons)              │
│     - Decision oscillation (3+ arch decisions on same topic) │
│     - Knowledge gaps (active tags with no arch notes)        │
│     - Tag clusters (strongly coupled tag pairs)              │
│  4. Optionally extract findings as new memories              │
│  5. Report findings to user                                  │
└──────────────────────────────────────────────────────────────┘
```

### Usage

```bash
bun run packages/orchestrator/src/audit.ts
bun run packages/orchestrator/src/audit.ts --extract    # save findings as memories
bun run packages/orchestrator/src/audit.ts --json       # output as JSON
```

### Programmatic API

```typescript
import { runAudit, type AuditReport } from "@dalinar/orchestrator"

const report: AuditReport = await runAudit(process.cwd())
console.log(`${report.findings.length} findings across ${report.memoriesScanned} memories`)
```

### Finding Categories

| Category | Trigger | Severity |
|----------|---------|----------|
| `recurring-blocker` | Tag appears in 3+ lesson-learned entries | medium/high |
| `decision-oscillation` | 3+ architecture decisions on same tag | medium/high |
| `knowledge-gap` | Active tag with no architecture/api-contract notes | low/high |
| `tag-cluster` | Tag pair co-occurs in 4+ entries | low |

---

## dialectic

Adversarial reasoning for high-stakes architectural decisions. Generates isolated opposing analyses using the Hegelian Dialectic method — two agents take fully committed positions, then a synthesizer produces a recommendation.

```
┌──────────────────────────────────────────────────────────────┐
│                       dialectic                              │
│                                                              │
│  1. Search Jasnah for prior context on the decision          │
│  2. Auto-detect constraints from the question:               │
│     "X vs Y?" → Agent A argues X, Agent B argues Y          │
│     "Should we X?" → Agent A: do it, Agent B: alternative   │
│  3. Generate isolated prompts for Agent A and Agent B        │
│  4. Generate synthesis prompt (fed both outputs)             │
│  5. Optionally save result as architecture decision note     │
└──────────────────────────────────────────────────────────────┘
```

### Usage

```bash
# Auto-detected constraints from "X vs Y" format
bun run packages/orchestrator/src/dialectic.ts "PostgreSQL vs ClickHouse for analytics?"

# Auto-detected from "Should we" format
bun run packages/orchestrator/src/dialectic.ts "Should we introduce event sourcing?"

# Save result as architecture note
bun run packages/orchestrator/src/dialectic.ts "Monolith vs microservices?" --extract
```

### How Agents Use It

1. Run the dialectic CLI to get three prompts (A, B, synthesis)
2. Execute Agent A's prompt in an **isolated context** (no shared state)
3. Execute Agent B's prompt in an **isolated context**
4. Feed both outputs into the synthesis prompt
5. Save the synthesized result as an architecture decision

The isolation is critical — it produces structurally decorrelated reasoning, not just different conclusions from shared premises.

### Programmatic API

```typescript
import { runDialectic, formatDialecticResult, resultToExtractEntry } from "@dalinar/orchestrator"

const { constraints, prompts, priorContext } = await runDialectic({
  question: "Should we use event sourcing for orders?",
})

// prompts.positionA — send to isolated Agent A
// prompts.positionB — send to isolated Agent B
// prompts.synthesis — feed both outputs to Synthesizer
```

---

## reflect

Post-sprint retrospective capture. When actuals are known after a sprint, feeds corrections back as memory entries — creating a feedback loop that improves future analyses.

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

### Usage

```bash
# Pipe reflection data as JSON
echo '{
  "estimateAccuracy": [
    { "taskDescription": "DB migration", "estimatedEffort": "2d", "actualEffort": "5d",
      "reason": "Cascade updates in dependent services" }
  ],
  "blockers": [
    { "description": "Auth service rate limiting", "impact": "Delayed testing by 1 day",
      "wasAnticipated": false }
  ],
  "wins": [
    { "description": "Using worktrees for parallel feature work", "replicable": true }
  ],
  "revisions": [
    { "originalDecision": "Use REST for inter-service", "revision": "Switch to gRPC",
      "reason": "Latency requirements changed" }
  ]
}' | bun run packages/orchestrator/src/reflect.ts --sprint sprint-42

# Dry run — preview without writing
echo '<json>' | bun run packages/orchestrator/src/reflect.ts --sprint sprint-42 --dry-run
```

### Programmatic API

```typescript
import { runReflection, type SprintReflection } from "@dalinar/orchestrator"

const reflection: SprintReflection = {
  sprint: "sprint-42",
  epicKeys: ["EPIC-123", "EPIC-124"],
  estimateAccuracy: [
    { taskDescription: "DB migration", estimatedEffort: "2d", actualEffort: "5d",
      reason: "Cascade updates in dependent services" },
  ],
  blockers: [
    { description: "Auth rate limiting", impact: "1 day delay", wasAnticipated: false },
  ],
}

const { entries, extractResult } = await runReflection(reflection, { root: process.cwd() })
```

### Memory Mapping

| Reflection Input | Memory Type | Tags |
|-----------------|-------------|------|
| `estimateAccuracy` | `lesson-learned` | `estimation`, `estimate-drift` |
| `blockers` (unanticipated) | `lesson-learned` | `blocker` |
| `wins` (replicable) | `domain-fact` | `best-practice` |
| `revisions` | `architecture` | `decision-revision` |

---

## Integration with Jasnah

All pipelines use two Jasnah integration points:

### Search (`searchMemories`, `searchContextForEpic`)

Queries Jasnah's memory store via the `search-memory.ts` script. Searches across architecture, domain-fact, api-contract, and lesson-learned types with deduplication.

```typescript
import { searchContextForEpic, formatContextForPrompt } from "@dalinar/orchestrator"

const memories = await searchContextForEpic("authentication redesign", "/path/to/project")
const contextBlock = formatContextForPrompt(memories)
// Inject into LLM prompt
```

### Extract (`extractMemories`)

Pipes entries to Jasnah's `extract-inline.ts` script for writing to `.memory/` and optional Qdrant sync.

```typescript
import { extractMemories } from "@dalinar/orchestrator"

await extractMemories([
  { type: "architecture", summary: "Chose gRPC over REST", content: "...", tags: ["grpc"], confidence: "high" },
], { root: process.cwd(), source: "session-abc" })
```

## Environment Variables

The orchestrator inherits environment variables from both Jasnah and Sazed:

| Variable | Used By | Purpose |
|----------|---------|---------|
| `JASNAH_ROOT` | Jasnah integration | Path to Jasnah installation (default: `~/.local/share/jasnah`) |
| `QDRANT_URL` | Jasnah search | Qdrant server URL |
| `QDRANT_API_KEY` | Jasnah search | Qdrant API key |
| `DALINAR_ROOT` | Sazed integration | Path to Dalinar workspace root (default: `cwd`) |
| `JIRA_BASE_URL` | Sazed analysis | Jira instance URL |
| `JIRA_EMAIL` | Sazed analysis | Jira user email |
| `JIRA_API_TOKEN` | Sazed analysis | Jira API token |
| `ANTHROPIC_API_KEY` | Sazed LLM | Anthropic API key for analysis |
