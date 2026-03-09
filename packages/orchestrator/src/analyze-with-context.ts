#!/usr/bin/env bun
/**
 * analyze-with-context — The core Dalinar pipeline.
 *
 * 1. Resolve key (task → parent epic if needed)
 * 2. Search Jasnah memories for prior context related to the epic
 * 3. Run Sazed analysis with that context injected
 * 4. Extract new domain knowledge back to Jasnah
 *
 * Usage:
 *   bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123
 *   bun run packages/orchestrator/src/analyze-with-context.ts PROJ-456  # task key — resolves to parent epic
 *   bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123 --force --notes
 */

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const epicKey = args.find((a) => !a.startsWith("--"))
  if (!epicKey) {
    console.error("Usage: analyze-with-context <KEY> [--force] [--notes] [--no-map] [--no-cache] [--forensics] [--stdout]")
    process.exit(1)
  }

  return {
    epicKey,
    ...args.includes("--force") && { force: true as const },
    ...args.includes("--notes") && { notes: true as const },
    ...args.includes("--no-map") && { noMap: true as const },
    ...args.includes("--no-cache") && { noCache: true as const },
    ...args.includes("--forensics") && { forensics: true as const },
    ...args.includes("--stdout") && { stdout: true as const },
    root: process.cwd(),
  }
}

// ── Run ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const opts = parseArgs(process.argv)

  const { Effect } = await import("effect")
  const { analyzeWithContextPipeline } = await import("./effect/pipelines/analyze.js")
  const { OrchestratorLive, runCli } = await import("./effect/runtime.js")

  runCli(
    analyzeWithContextPipeline(opts).pipe(
      Effect.provide(OrchestratorLive),
      Effect.asVoid,
    ),
  )
}
