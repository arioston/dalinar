import { Effect } from "effect"
import { $ } from "bun"
import { resolve } from "path"
import { resolveVaultConfig, vaultProjectPath } from "@dalinar/protocol"
import { VaultSyncError } from "../errors.js"

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

    const root = projectRoot ?? process.cwd()
    const scriptPath = resolve(
      import.meta.dir,
      "../../../../scripts/vault-sync.sh",
    )

    const result = yield* Effect.tryPromise({
      try: () =>
        $`bash ${scriptPath} ${root}`
          .quiet()
          .nothrow()
          .env({ ...process.env, WORK_LOG_PATH: config.workLogPath })
          .then((r) => ({
            exitCode: r.exitCode,
            stderr: r.stderr.toString().trim(),
          })),
      catch: (error) =>
        new VaultSyncError({
          message: "Vault sync script failed",
          cause: error,
        }),
    })

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

    const globalDirs = [
      "architecture",
      "domain-facts",
      "api-contracts",
      "glossary",
      "lessons-learned",
    ]

    for (const dir of globalDirs) {
      yield* Effect.tryPromise({
        try: () =>
          $`mkdir -p ${config.workLogPath}/_global/${dir}`.quiet().then(
            () => undefined,
          ),
        catch: (error) =>
          new VaultSyncError({
            message: `Failed to create directory: ${dir}`,
            cause: error,
          }),
      })
    }

    return { created: true, path: config.workLogPath }
  }).pipe(Effect.withSpan("init-work-log"))
