import { Effect, Layer } from "effect"
import { SubprocessServiceLive } from "./subprocess.js"
import { JasnahServiceLive, SazedServiceLive, HoidServiceLive } from "./services.js"
import type {
  SubprocessError,
  JasnahError,
  SazedError,
  VaultSyncError,
  HoidError,
  FileOperationError,
  ParseError,
  JiraError,
} from "./errors.js"

// ── Layer composition ──────────────────────────────────────────────

export const OrchestratorLive = Layer.mergeAll(
  JasnahServiceLive,
  SazedServiceLive,
  HoidServiceLive,
).pipe(Layer.provideMerge(SubprocessServiceLive))

// ── CLI runner ─────────────────────────────────────────────────────

type OrchestratorError =
  | SubprocessError
  | JasnahError
  | SazedError
  | VaultSyncError
  | HoidError
  | FileOperationError
  | ParseError
  | JiraError

export const runCli = (
  effect: Effect.Effect<void, OrchestratorError, never>,
): void => {
  Effect.runPromise(
    effect.pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error(`[dalinar] ${error._tag}: ${error.message}`)
          process.exitCode = 1
        }),
      ),
    ),
  ).catch((defect) => {
    console.error("[dalinar] Unexpected error:", defect)
    process.exitCode = 1
  })
}
