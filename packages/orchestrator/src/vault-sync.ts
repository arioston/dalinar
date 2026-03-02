#!/usr/bin/env bun
/**
 * vault-sync — Sync .memory/ to Obsidian vault's Work Log folder.
 *
 * Opt-in: does nothing if WORK_LOG_PATH is not set.
 *
 * Usage:
 *   bun run packages/orchestrator/src/vault-sync.ts [project-root]
 *
 * Programmatic:
 *   import { syncToVault } from "./vault-sync.js"
 *   await syncToVault("/path/to/project")
 */

import { $ } from "bun"
import { resolve } from "path"
import { resolveVaultConfig, vaultProjectPath } from "@dalinar/protocol"

export interface VaultSyncResult {
  synced: boolean
  reason?: string
  target?: string
}

/**
 * Sync a project's .memory/ to the Obsidian vault Work Log folder.
 * Returns immediately with synced=false if WORK_LOG_PATH is not set.
 */
export async function syncToVault(
  projectRoot?: string,
  overrides?: { workLogPath?: string; projectName?: string },
): Promise<VaultSyncResult> {
  const config = resolveVaultConfig(overrides)
  if (!config) {
    return { synced: false, reason: "WORK_LOG_PATH not set (opt-in)" }
  }

  const root = projectRoot ?? process.cwd()
  const scriptPath = resolve(import.meta.dir, "../../../scripts/vault-sync.sh")

  const result = await $`bash ${scriptPath} ${root}`
    .quiet()
    .nothrow()
    .env({ ...process.env, WORK_LOG_PATH: config.workLogPath })

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    return { synced: false, reason: stderr }
  }

  return {
    synced: true,
    target: vaultProjectPath(config),
  }
}

/**
 * Initialize the Work Log folder structure (creates _global/ type dirs).
 */
export async function initWorkLog(
  overrides?: { workLogPath?: string },
): Promise<{ created: boolean; path?: string; reason?: string }> {
  const config = resolveVaultConfig({ ...overrides, projectName: "_init" })
  if (!config) {
    return { created: false, reason: "WORK_LOG_PATH not set" }
  }

  const globalDirs = [
    "architecture",
    "domain-facts",
    "api-contracts",
    "glossary",
    "lessons-learned",
  ]

  for (const dir of globalDirs) {
    await $`mkdir -p ${config.workLogPath}/_global/${dir}`.quiet()
  }

  return { created: true, path: config.workLogPath }
}

// ── CLI ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd()
  const result = await syncToVault(root)

  if (result.synced) {
    console.log(`[vault-sync] Synced to ${result.target}`)
  } else {
    console.log(`[vault-sync] Skipped: ${result.reason}`)
  }
}
