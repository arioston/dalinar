#!/usr/bin/env bun
/**
 * reflect — Post-sprint retrospective capture.
 *
 * Captures corrections and learnings after a sprint when actuals are known.
 * Feeds corrections back as lesson-learned entries via Jasnah.
 *
 * Usage:
 *   bun run packages/orchestrator/src/reflect.ts --sprint sprint-42
 *   bun run packages/orchestrator/src/reflect.ts --sprint sprint-42 --dry-run
 *   echo '<json>' | bun run packages/orchestrator/src/reflect.ts --sprint sprint-42
 */

// ── Types (re-exported from effect layer) ─────────────────────────

export type {
  SprintReflection,
  EstimateCorrection,
  BlockerEntry,
  WinEntry,
  DecisionRevision,
} from "./effect/types/reflect.js"

import type { SprintReflection } from "./effect/types/reflect.js"

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv: string[]): { sprint: string; dryRun: boolean; root: string } {
  const args = argv.slice(2)

  const sprintIdx = args.indexOf("--sprint")
  const sprint = sprintIdx !== -1 ? args[sprintIdx + 1] : undefined

  if (!sprint) {
    console.error("Usage: reflect --sprint <sprint-name> [--dry-run]")
    console.error("")
    console.error("Input: pipe JSON reflection data to stdin, or run interactively")
    console.error("")
    console.error("JSON format:")
    console.error(JSON.stringify({
      sprint: "sprint-42",
      estimateAccuracy: [{ taskDescription: "...", estimatedEffort: "2d", actualEffort: "5d", reason: "..." }],
      blockers: [{ description: "...", impact: "...", wasAnticipated: false }],
      wins: [{ description: "...", replicable: true }],
      revisions: [{ originalDecision: "...", revision: "...", reason: "..." }],
    }, null, 2))
    process.exit(1)
  }

  return {
    sprint,
    dryRun: args.includes("--dry-run"),
    root: process.cwd(),
  }
}

// ── Run ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const opts = parseArgs(process.argv)

  // Try to read JSON from stdin
  let reflection: SprintReflection

  const stdinText = await Bun.stdin.text()
  if (stdinText.trim()) {
    try {
      const parsed = JSON.parse(stdinText.trim())
      reflection = { sprint: opts.sprint, ...parsed }
    } catch {
      console.error("[dalinar] Failed to parse stdin as JSON")
      process.exit(1)
    }
  } else {
    // Interactive mode: output template for the user/agent to fill
    console.log("[dalinar] No stdin input. Provide reflection data as JSON via stdin.")
    console.log("")
    console.log("Example:")
    console.log(`echo '${JSON.stringify({
      estimateAccuracy: [{ taskDescription: "DB migration", estimatedEffort: "2d", actualEffort: "5d", reason: "Cascade updates in dependent services" }],
      blockers: [{ description: "Auth service rate limiting", impact: "Delayed integration testing by 1 day", wasAnticipated: false }],
      wins: [{ description: "Using worktrees for parallel feature work", replicable: true }],
    })}' | bun run packages/orchestrator/src/reflect.ts --sprint ${opts.sprint}`)
    process.exit(0)
  }

  const { Effect } = await import("effect")
  const { reflectPipeline } = await import("./effect/pipelines/reflect.js")
  const { OrchestratorLive, runCli } = await import("./effect/runtime.js")

  runCli(
    reflectPipeline(reflection, { dryRun: opts.dryRun, root: opts.root }).pipe(
      Effect.provide(OrchestratorLive),
      Effect.asVoid,
    ),
  )
}
