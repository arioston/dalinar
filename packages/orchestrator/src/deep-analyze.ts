#!/usr/bin/env bun
/**
 * deep-analyze — Deep analysis pipeline with epic→task hierarchy.
 *
 * Usage:
 *   bun run packages/orchestrator/src/deep-analyze.ts EPIC-123
 *   bun run packages/orchestrator/src/deep-analyze.ts PROJ-456 --task-only
 *   bun run packages/orchestrator/src/deep-analyze.ts EPIC-123 --force
 *
 * Or via unified CLI:
 *   bun run packages/orchestrator/src/effect/cli.ts deep-analyze EPIC-123 --force
 */

// Legacy entry point — delegates to @effect/cli
if (import.meta.main) {
  const { runCliApp } = await import("./effect/cli.js")
  const args = [...process.argv.slice(0, 2), "deep-analyze", ...process.argv.slice(2)]
  runCliApp(args)
}
