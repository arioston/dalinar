#!/usr/bin/env bun
/**
 * analyze-with-context — The core Dalinar pipeline.
 *
 * Usage:
 *   bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123
 *   bun run packages/orchestrator/src/analyze-with-context.ts PROJ-456  # task key — resolves to parent epic
 *   bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123 --force --notes
 *
 * Or via unified CLI:
 *   bun run packages/orchestrator/src/effect/cli.ts analyze EPIC-123 --force --notes
 */

// Legacy entry point — delegates to @effect/cli
if (import.meta.main) {
  const { runCliApp } = await import("./effect/cli.js")
  // Inject "analyze" subcommand before the user args
  const args = [...process.argv.slice(0, 2), "analyze", ...process.argv.slice(2)]
  runCliApp(args)
}
