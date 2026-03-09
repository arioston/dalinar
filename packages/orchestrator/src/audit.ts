#!/usr/bin/env bun
/**
 * audit — Cross-session pattern detection.
 *
 * Usage:
 *   bun run packages/orchestrator/src/audit.ts
 *   bun run packages/orchestrator/src/audit.ts --extract
 *   bun run packages/orchestrator/src/audit.ts --json
 *   bun run packages/orchestrator/src/audit.ts --roots ~/workspace
 *
 * Or via unified CLI:
 *   bun run packages/orchestrator/src/effect/cli.ts audit --extract --json
 */

// Legacy entry point — delegates to @effect/cli
if (import.meta.main) {
  const { runCliApp } = await import("./effect/cli.js")
  const args = [...process.argv.slice(0, 2), "audit", ...process.argv.slice(2)]
  runCliApp(args)
}
