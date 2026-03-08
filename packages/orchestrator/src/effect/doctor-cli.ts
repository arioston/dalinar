#!/usr/bin/env bun
/**
 * Doctor CLI — run preflight checks and print a structured report.
 *
 * Usage:
 *   bun run packages/orchestrator/src/effect/doctor-cli.ts
 *   bun run packages/orchestrator/src/effect/doctor-cli.ts --strict
 *
 * --strict: exit non-zero if any remediation is needed (for CI gates)
 */

import { Console, Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { SubprocessServiceLive } from "./subprocess.js"
import { doctor } from "./doctor.js"
import { preflight, type PreflightCheck } from "./paths.js"

const strict = process.argv.includes("--strict")

const DoctorLayer = Layer.mergeAll(SubprocessServiceLive, NodeFileSystem.layer)

const program = Effect.gen(function* () {
  // Run preflight (path existence checks)
  const pre = yield* preflight.pipe(
    Effect.catchAll((e) =>
      Effect.logError(`[preflight] Error: ${e}`).pipe(
        Effect.map(() => ({ root: "unknown", checks: [] as PreflightCheck[] })),
      ),
    ),
  )

  // Run doctor (model, CLI, compatibility)
  const report = yield* doctor

  // Print report
  yield* Console.log("\n── Doctor Report ──────────────────────────────────")
  yield* Console.log(`  Provider:       ${report.provider}`)
  yield* Console.log(`  Model:          ${report.model}`)
  yield* Console.log(`  Model valid:    ${report.modelValid}`)
  yield* Console.log(`  Sazed on disk:  ${report.sazedCliAvailable}`)
  yield* Console.log(`  Sazed bootable: ${report.sazedCliBootable}`)
  yield* Console.log(`  Sazed version:  ${report.sazedCliVersion ?? "unknown"}`)

  if (report.compatibilityIssues.length > 0) {
    yield* Console.log(`\n  Compatibility issues:`)
    yield* Effect.forEach(report.compatibilityIssues, (issue) =>
      Console.log(`    ⚠ ${issue}`),
    )
  }

  // Print preflight results
  yield* Console.log(`\n── Preflight Checks ──────────────────────────────`)
  yield* Effect.forEach(pre.checks, (check) =>
    Console.log(`  ${check.ok ? "✓" : "✗"} ${check.name}: ${check.path}`),
  )

  // Print remediations
  if (report.remediations.length > 0) {
    yield* Console.log(`\n── Remediations ──────────────────────────────────`)
    yield* Effect.forEach(report.remediations, (r, i) =>
      Console.log(`  ${i + 1}. ${r}`),
    )
  }

  const healthy = report.sazedCliAvailable && report.sazedCliBootable && report.remediations.length === 0
  yield* Console.log(`\n  Status: ${healthy ? "HEALTHY" : "DEGRADED"}`)
  yield* Console.log("──────────────────────────────────────────────────\n")

  if (strict && !healthy) {
    process.exitCode = 1
  }

  return report
})

const runnable = program.pipe(
  Effect.provide(DoctorLayer),
  Effect.catchAll((e) =>
    Effect.logError(`[doctor] Fatal: ${e}`).pipe(
      Effect.tap(() => Effect.sync(() => { process.exitCode = 1 })),
    ),
  ),
  Effect.catchAllDefect((defect) =>
    Effect.sync(() => {
      console.error("[doctor] Unexpected defect:", defect)
      process.exitCode = 1
    }),
  ),
)

await Effect.runPromise(runnable)
