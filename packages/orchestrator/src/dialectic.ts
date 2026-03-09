#!/usr/bin/env bun
/**
 * dialectic — Adversarial reasoning for high-stakes decisions.
 *
 * Usage:
 *   bun run packages/orchestrator/src/dialectic.ts "Should we use event sourcing for orders?"
 *   bun run packages/orchestrator/src/dialectic.ts "Migrate to new DB vs adapt schema?" --extract
 *
 * Or via unified CLI:
 *   bun run packages/orchestrator/src/effect/cli.ts dialectic "Should we use event sourcing?"
 */

// Re-export types and pure functions
export type {
  DialecticInput,
  Position,
  Synthesis,
  DialecticResult,
} from "./effect/types/dialectic.js"

export {
  buildPositionPrompt,
  buildSynthesisPrompt,
  formatDialecticResult,
  resultToExtractEntry,
} from "./effect/types/dialectic.js"

// Legacy entry point — delegates to @effect/cli
if (import.meta.main) {
  const { runCliApp } = await import("./effect/cli.js")
  const args = [...process.argv.slice(0, 2), "dialectic", ...process.argv.slice(2)]
  runCliApp(args)
}
