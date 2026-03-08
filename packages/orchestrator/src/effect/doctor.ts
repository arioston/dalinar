/**
 * Doctor/preflight service — validates provider, model, and CLI capability
 * before any pipeline runs. Fails fast with actionable remediation.
 *
 * Uses Effect Config for env vars (testable via ConfigProvider) and
 * @effect/platform FileSystem for file access (no sync I/O).
 */

import { Config, Effect } from "effect"
import { FileSystem } from "@effect/platform"
import { ConfigurationError } from "./errors.js"
import { resolveSazedCli } from "./paths.js"
import {
  validateModelConfig,
  formatModelRemediationMessage,
  DEFAULT_PROVIDER,
  DEFAULT_MODEL,
  checkCompatibility,
} from "@dalinar/protocol"
import { resolve } from "path"

// ── Environment reading ──────────────────────────────────────────

export interface DoctorReport {
  readonly provider: string
  readonly model: string
  readonly modelValid: boolean
  readonly sazedCliAvailable: boolean
  readonly sazedCliVersion: string | null
  readonly compatibilityIssues: readonly string[]
}

const ORCHESTRATOR_VERSION = "0.1.0"

const LlmProvider = Config.string("LLM_PROVIDER").pipe(
  Config.withDefault(DEFAULT_PROVIDER),
)
const LlmModel = Config.string("LLM_MODEL").pipe(
  Config.withDefault(DEFAULT_MODEL),
)

// ── Doctor effect ────────────────────────────────────────────────

export const doctor = Effect.gen(function* () {
  const provider = yield* LlmProvider
  const model = yield* LlmModel
  const fs = yield* FileSystem.FileSystem

  // Validate model/provider
  const validation = validateModelConfig(provider, model)
  if (validation.status !== "valid") {
    const remediation = formatModelRemediationMessage(validation)!
    return yield* new ConfigurationError({
      message: remediation,
      variable: validation.status === "unknown-provider" ? "LLM_PROVIDER" : "LLM_MODEL",
      currentValue: validation.status === "unknown-provider" ? provider : model,
      supportedValues: [...validation.supported],
      remediation,
    })
  }

  // Check Sazed CLI availability
  const sazedCliPath = resolveSazedCli()
  const sazedCliAvailable = yield* fs.exists(sazedCliPath).pipe(
    Effect.catchAll(() => Effect.succeed(false)),
  )

  // Read Sazed CLI version if available
  const sazedCliVersion: string | null = yield* Effect.gen(function* () {
    if (!sazedCliAvailable) return null
    const sazedRoot = resolve(sazedCliPath, "../../../..")
    const pkgPath = resolve(sazedRoot, "packages/cli/package.json")
    const raw = yield* fs.readFileString(pkgPath).pipe(
      Effect.catchAll(() => Effect.succeed(null as string | null)),
    )
    if (!raw) return null
    try {
      return (JSON.parse(raw).version as string) ?? null
    } catch {
      return null
    }
  })

  // Check compatibility matrix
  const compatOpts: Parameters<typeof checkCompatibility>[0] = {
    orchestratorVersion: ORCHESTRATOR_VERSION,
    provider,
    model,
  }
  if (sazedCliVersion) compatOpts.sazedCliVersion = sazedCliVersion
  const compat = checkCompatibility(compatOpts)

  if (!compat.compatible && compat.issues.length > 0) {
    yield* Effect.logWarning(
      `Compatibility issues: ${compat.issues.join("; ")}`,
    )
  }

  return {
    provider,
    model,
    modelValid: true,
    sazedCliAvailable,
    sazedCliVersion,
    compatibilityIssues: compat.issues,
  } satisfies DoctorReport
})
