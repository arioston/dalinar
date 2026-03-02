---
name: dialectic
description: Adversarial reasoning for high-stakes architectural decisions
depends-on: [jasnah-search-memory]
---

# Dialectic — Adversarial Reasoning

Use this skill when facing high-stakes architectural or design decisions where multiple valid approaches exist and the team needs rigorous analysis before committing.

## When to Use

- Choosing between competing architectures (monolith vs microservices, SQL vs NoSQL)
- Evaluating migration strategies (rebuild vs adapt)
- Making irreversible infrastructure decisions
- Any decision where "it depends" isn't good enough

## How It Works

The dialectic pipeline uses **isolated adversarial reasoning** (inspired by Hegel's dialectic):

1. **Search prior context** — Query Jasnah memories for relevant decisions and lessons
2. **Agent A** — Takes a fully committed position FOR option A (no hedging)
3. **Agent B** — Takes a fully committed position FOR option B (no hedging)
4. **Synthesizer** — Receives both outputs (no shared context) and produces:
   - Recommended approach (not a compromise — a higher-level insight)
   - Trade-off analysis
   - What each side gets right
   - Where they conflict and how to resolve it

The key insight: **isolation produces structurally decorrelated reasoning**, not just different conclusions from shared premises.

## Usage

### Generate prompts for agent execution:
```bash
bun run packages/orchestrator/src/dialectic.ts "Should we introduce event sourcing for the order service?"
```

### With auto-detected constraints (X vs Y format):
```bash
bun run packages/orchestrator/src/dialectic.ts "PostgreSQL vs ClickHouse for analytics"
```

### Save result as architecture note:
```bash
bun run packages/orchestrator/src/dialectic.ts "Migrate to new DB?" --extract
```

## Agent Workflow

When an AI agent invokes this skill:

1. Run the dialectic CLI to get prompts and prior context
2. Execute Agent A's prompt in an isolated context (separate conversation/turn)
3. Execute Agent B's prompt in an isolated context
4. Feed both outputs into the synthesis prompt
5. Save the result as an architecture decision note

## Output

The pipeline produces:
- Structured prompts for each position (A and B)
- A synthesis prompt template
- Prior context from Jasnah memories
- (When `--extract`) An architecture note with the decision and alternatives
