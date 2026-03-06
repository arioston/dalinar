#!/usr/bin/env bun
/**
 * deep-analyze — Deep analysis pipeline with epic→task hierarchy.
 *
 * 1. Resolve key (task → parent epic)
 * 2. Fetch full task hierarchy from Jira
 * 3. Build retrospectives for completed tasks (pure, no LLM)
 * 4. Analyze pending tasks with sibling learnings injected
 * 5. Extract domain knowledge back to Jasnah
 *
 * Usage:
 *   bun run packages/orchestrator/src/deep-analyze.ts EPIC-123
 *   bun run packages/orchestrator/src/deep-analyze.ts PROJ-456          # task key — targets that task only
 *   bun run packages/orchestrator/src/deep-analyze.ts EPIC-123 --force
 */

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const key = args.find((a) => !a.startsWith("--"))
  if (!key) {
    console.error("Usage: deep-analyze <KEY> [--force] [--notes] [--task-only]")
    process.exit(1)
  }

  return {
    key,
    ...(args.includes("--force") && { force: true as const }),
    ...(args.includes("--notes") && { notes: true as const }),
    ...(args.includes("--task-only") && { taskOnly: true as const }),
    root: process.cwd(),
  }
}

// ── Run ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const opts = parseArgs(process.argv)

  const { Effect } = await import("effect")
  const { deepAnalyzePipeline, DeepAnalyzeLive } = await import("./effect/pipelines/deep-analyze.js")
  const { runCli } = await import("./effect/runtime.js")

  runCli(
    deepAnalyzePipeline(opts).pipe(
      Effect.provide(DeepAnalyzeLive(opts.root)),
      Effect.asVoid,
    ),
  )
}
