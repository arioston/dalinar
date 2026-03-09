#!/usr/bin/env bun
/**
 * vault-sync — Sync .memory/ to Obsidian vault's Work Log folder.
 *
 * Opt-in: does nothing if WORK_LOG_PATH is not set.
 *
 * Usage:
 *   bun run packages/orchestrator/src/vault-sync.ts [project-root]
 *
 * Or via unified CLI:
 *   bun run packages/orchestrator/src/effect/cli.ts vault-sync [project-root]
 */

// Legacy entry point — delegates to @effect/cli
if (import.meta.main) {
  const { runCliApp } = await import("./effect/cli.js")
  const args = [...process.argv.slice(0, 2), "vault-sync", ...process.argv.slice(2)]
  runCliApp(args)
}
