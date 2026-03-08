#!/usr/bin/env bun
/**
 * audit — Cross-session pattern detection.
 *
 * Scans the memory store for recurring patterns across sessions and epics.
 *
 * Usage:
 *   bun run packages/orchestrator/src/audit.ts
 *   bun run packages/orchestrator/src/audit.ts --extract   (write findings as memories)
 *   bun run packages/orchestrator/src/audit.ts --json      (output as JSON)
 *   bun run packages/orchestrator/src/audit.ts --roots ~/workspace  (scan all projects)
 */

import { resolve } from "path"

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv: string[]): { root: string; roots?: string | undefined; extract: boolean; json: boolean } {
  const args = argv.slice(2)
  const rootsIdx = args.indexOf("--roots")
  return {
    root: process.cwd(),
    roots: rootsIdx !== -1 && args[rootsIdx + 1] ? resolve(args[rootsIdx + 1]) : undefined,
    extract: args.includes("--extract"),
    json: args.includes("--json"),
  }
}

// ── Run ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const opts = parseArgs(process.argv)

  const { Effect } = await import("effect")
  const { auditPipeline } = await import("./effect/pipelines/audit.js")
  const { OrchestratorLive, runCli } = await import("./effect/runtime.js")

  runCli(
    auditPipeline(opts.root, {
      rootsBase: opts.roots,
      extract: opts.extract,
      json: opts.json,
    }).pipe(
      Effect.provide(OrchestratorLive),
      Effect.asVoid,
    ),
  )
}
