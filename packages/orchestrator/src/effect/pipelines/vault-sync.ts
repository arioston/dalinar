import { Effect } from "effect"
import { FileSystem } from "@effect/platform"
import { resolve } from "path"
import { resolveVaultConfig, vaultProjectPath } from "@dalinar/protocol"
import { VaultSyncError } from "../errors.js"
import { SubprocessService } from "../subprocess.js"
import { resolveDalinarRoot } from "../paths.js"

export interface VaultSyncResult {
  synced: boolean
  reason?: string
  target?: string
}

// ── Effect pipeline ────────────────────────────────────────────────

export const vaultSyncPipeline = (
  projectRoot?: string,
  overrides?: { workLogPath?: string; projectName?: string },
) =>
  Effect.gen(function* () {
    const config = resolveVaultConfig(overrides)
    if (!config) {
      return {
        synced: false,
        reason: "WORK_LOG_PATH not set (opt-in)",
      } satisfies VaultSyncResult
    }

    const subprocess = yield* SubprocessService
    const root = projectRoot ?? process.cwd()
    const scriptPath = resolve(resolveDalinarRoot(), "scripts/vault-sync.sh")

    const result = yield* subprocess
      .run("bash", {
        args: [scriptPath, root],
        rawCommand: true,
        nothrow: true,
        timeout: "30 seconds",
        env: { WORK_LOG_PATH: config.workLogPath },
      })
      .pipe(
        Effect.mapError(
          (e) => new VaultSyncError({ message: "Vault sync script failed", cause: e }),
        ),
      )

    if (result.exitCode !== 0) {
      return {
        synced: false,
        reason: result.stderr,
      } satisfies VaultSyncResult
    }

    return {
      synced: true,
      target: vaultProjectPath(config),
    } satisfies VaultSyncResult
  }).pipe(Effect.withSpan("vault-sync"))

export const initWorkLogPipeline = (
  overrides?: { workLogPath?: string },
) =>
  Effect.gen(function* () {
    const config = resolveVaultConfig({ ...overrides, projectName: "_init" })
    if (!config) {
      return { created: false, reason: "WORK_LOG_PATH not set" }
    }

    const fs = yield* FileSystem.FileSystem
    const globalDirs = [
      "architecture",
      "domain-facts",
      "api-contracts",
      "glossary",
      "lessons-learned",
    ]

    yield* Effect.forEach(globalDirs, (dir) =>
      fs.makeDirectory(`${config.workLogPath}/_global/${dir}`, { recursive: true }).pipe(
        Effect.mapError(
          (e) => new VaultSyncError({ message: `Failed to create directory: ${dir}`, cause: e }),
        ),
      ),
    )

    return { created: true, path: config.workLogPath }
  }).pipe(Effect.withSpan("init-work-log"))
