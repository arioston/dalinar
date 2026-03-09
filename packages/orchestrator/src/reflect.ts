#!/usr/bin/env bun
/**
 * reflect — Post-sprint retrospective capture.
 *
 * Usage:
 *   echo '<json>' | bun run packages/orchestrator/src/reflect.ts --sprint sprint-42
 *   echo '<json>' | bun run packages/orchestrator/src/reflect.ts --sprint sprint-42 --dry-run
 *
 * Or via unified CLI:
 *   echo '<json>' | bun run packages/orchestrator/src/effect/cli.ts reflect --sprint sprint-42
 */

// Re-export types for convenience
export type {
  SprintReflection,
  EstimateCorrection,
  BlockerEntry,
  WinEntry,
  DecisionRevision,
} from "./effect/types/reflect.js"

// Legacy entry point — delegates to @effect/cli
if (import.meta.main) {
  const { runCliApp } = await import("./effect/cli.js")
  const args = [...process.argv.slice(0, 2), "reflect", ...process.argv.slice(2)]
  runCliApp(args)
}
