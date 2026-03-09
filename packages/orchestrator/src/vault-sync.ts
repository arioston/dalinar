#!/usr/bin/env bun
/**
 * vault-sync — Sync .memory/ to Obsidian vault's Work Log folder.
 *
 * Opt-in: does nothing if WORK_LOG_PATH is not set.
 *
 * Usage:
 *   bun run packages/orchestrator/src/vault-sync.ts [project-root]
 */

// ── CLI ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd()

  const { Effect } = await import("effect")
  const { vaultSyncPipeline } = await import("./effect/pipelines/vault-sync.js")
  const { OrchestratorLive, runCli } = await import("./effect/runtime.js")

  runCli(
    vaultSyncPipeline(root).pipe(
      Effect.tap((result) =>
        result.synced
          ? Effect.logInfo(`Synced to ${result.target}`)
          : Effect.logInfo(`Skipped: ${result.reason}`),
      ),
      Effect.provide(OrchestratorLive),
      Effect.asVoid,
    ),
  )
}
