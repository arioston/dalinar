#!/usr/bin/env bun
/**
 * dialectic — Adversarial reasoning for high-stakes decisions.
 *
 * Inspired by the Hegelian Dialectic Skill. For architectural decisions,
 * generates two isolated opposing analyses with different constraints,
 * then synthesizes into a balanced recommendation.
 *
 * Usage:
 *   bun run packages/orchestrator/src/dialectic.ts "Should we use event sourcing for orders?"
 *   bun run packages/orchestrator/src/dialectic.ts "Migrate to new DB vs adapt schema?" --extract
 */

// ── Types (re-exported from effect layer) ─────────────────────────

export type {
  DialecticInput,
  Position,
  Synthesis,
  DialecticResult,
} from "./effect/types/dialectic.js"

// ── Pure functions (re-exported from effect layer) ────────────────

export {
  buildPositionPrompt,
  buildSynthesisPrompt,
  formatDialecticResult,
  resultToExtractEntry,
} from "./effect/types/dialectic.js"

import type { DialecticInput } from "./effect/types/dialectic.js"

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv: string[]): { question: string; extract: boolean; root: string } {
  const args = argv.slice(2)
  const flags = args.filter((a) => a.startsWith("--"))
  const positional = args.filter((a) => !a.startsWith("--"))

  if (positional.length === 0) {
    console.error('Usage: dialectic "<decision question>" [--extract]')
    process.exit(1)
  }

  return {
    question: positional.join(" "),
    extract: flags.includes("--extract"),
    root: process.cwd(),
  }
}

// ── Run ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const opts = parseArgs(process.argv)

  const { Effect } = await import("effect")
  const { dialecticPipeline } = await import("./effect/pipelines/dialectic.js")
  const { OrchestratorLive, runCli } = await import("./effect/runtime.js")

  runCli(
    dialecticPipeline({ question: opts.question }, opts.root).pipe(
      Effect.provide(OrchestratorLive),
      Effect.tap((result) =>
        Effect.sync(() => {
          console.log("\n" + "=".repeat(60))
          console.log("## Agent A Prompt")
          console.log("=".repeat(60))
          console.log(result.prompts.positionA)

          console.log("\n" + "=".repeat(60))
          console.log("## Agent B Prompt")
          console.log("=".repeat(60))
          console.log(result.prompts.positionB)

          console.log("\n" + "=".repeat(60))
          console.log("## Synthesis Prompt")
          console.log("=".repeat(60))
          console.log(result.prompts.synthesis)

          console.log("\n[dalinar] Run each prompt in isolated agent contexts, then combine with the synthesis prompt.")
        }),
      ),
      Effect.asVoid,
    ),
  )
}
