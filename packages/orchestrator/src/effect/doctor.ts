/**
 * Doctor/preflight service — validates provider, model, CLI capability,
 * and runtime compatibility before any pipeline runs.
 *
 * Fails fast with actionable remediation. Reports are structured so CI
 * can distinguish "healthy" from "degraded but limping" from "broken".
 *
 * Uses Effect Config for env vars (testable via ConfigProvider),
 * @effect/platform FileSystem for file access, and SubprocessService
 * for CLI boot checks (interruption-safe, testable via mock layer).
 */

import { Config, Effect, Ref, Schema } from "effect"
import { FileSystem } from "@effect/platform"
import { ConfigurationError } from "./errors.js"
import { SubprocessService } from "./subprocess.js"
import { resolveSazedCli, resolveSazedRoot } from "./paths.js"
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
  readonly sazedCliBootable: boolean
  readonly sazedCliVersion: string | null
  readonly compatibilityIssues: readonly string[]
  readonly remediations: readonly string[]
}

const ORCHESTRATOR_VERSION = "0.1.0"

const LlmProvider = Config.string("LLM_PROVIDER").pipe(
  Config.withDefault(DEFAULT_PROVIDER),
)
const LlmModel = Config.string("LLM_MODEL").pipe(
  Config.withDefault(DEFAULT_MODEL),
)

const CliPackageJson = Schema.Struct({ version: Schema.String })

// ── Doctor effect ────────────────────────────────────────────────

export const doctor = Effect.gen(function* () {
  const provider = yield* LlmProvider
  const model = yield* LlmModel
  const fs = yield* FileSystem.FileSystem
  const subprocess = yield* SubprocessService
  const remediations = yield* Ref.make<string[]>([])

  const addRemediation = (msg: string) =>
    Ref.update(remediations, (arr) => [...arr, msg])

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

  // Check Sazed CLI availability (file exists)
  const sazedCliPath = resolveSazedCli()
  const sazedCliAvailable = yield* fs.exists(sazedCliPath).pipe(
    Effect.catchAll(() => Effect.succeed(false)),
  )

  if (!sazedCliAvailable) {
    yield* addRemediation(
      `Sazed CLI not found at ${sazedCliPath}. ` +
      `Run: git submodule update --init modules/sazed`,
    )
  }

  // Validate Sazed CLI can actually boot (runtime check via SubprocessService)
  const sazedCliBootable = yield* (
    sazedCliAvailable
      ? subprocess
          .run(sazedCliPath, {
            args: ["--help"],
            cwd: resolveSazedRoot(),
            nothrow: true,
            timeout: "10 seconds",
            env: { SKIP_MAIN: "1" },
          })
          .pipe(
            Effect.map((result) => {
              if (result.exitCode >= 128) return false
              if (result.stderr.includes("Cannot find module")) return false
              if (result.stderr.includes("ERR_MODULE_NOT_FOUND")) return false
              if (result.stderr.includes("SyntaxError")) return false
              return true
            }),
            Effect.catchAll(() => Effect.succeed(false)),
          )
      : Effect.succeed(false)
  )

  if (sazedCliAvailable && !sazedCliBootable) {
    yield* addRemediation(
      `Sazed CLI exists but fails to boot. Likely causes:\n` +
      `  - Stale compiled .js/.d.ts files (fix: cd modules/sazed && rm -rf packages/*/dist packages/adapters/src/**/*.js packages/adapters/src/**/*.d.ts)\n` +
      `  - Missing workspace dependencies (fix: cd modules/sazed && bun install)\n` +
      `  - ESM import resolution failure (check: bun run ${sazedCliPath} --help)`,
    )
  }

  // Read Sazed CLI version if available
  const sazedCliVersion = yield* (
    sazedCliAvailable
      ? fs.readFileString(resolve(sazedCliPath, "../../../../packages/cli/package.json")).pipe(
          Effect.flatMap((raw) =>
            Schema.decodeUnknown(Schema.parseJson(CliPackageJson))(raw).pipe(
              Effect.map((pkg) => pkg.version as string | null),
            ),
          ),
          Effect.catchAll(() => Effect.succeed(null as string | null)),
        )
      : Effect.succeed(null as string | null)
  )

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
    yield* Effect.forEach(compat.issues, (issue) =>
      addRemediation(`Compatibility: ${issue}`),
    )
  }

  const finalRemediations = yield* Ref.get(remediations)

  if (finalRemediations.length > 0) {
    yield* Effect.logWarning(
      `Doctor found ${finalRemediations.length} issue(s):\n${finalRemediations.map((r, i) => `  ${i + 1}. ${r}`).join("\n")}`,
    )
  }

  return {
    provider,
    model,
    modelValid: true,
    sazedCliAvailable,
    sazedCliBootable,
    sazedCliVersion,
    compatibilityIssues: compat.issues,
    remediations: finalRemediations,
  } satisfies DoctorReport
})
