import { Effect, Layer, Match } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { SubprocessServiceLive } from "./subprocess.js"
import { JasnahServiceLive, SazedServiceLive, HoidServiceLive } from "./services.js"
import { preflight } from "./paths.js"
import { doctor } from "./doctor.js"
import type {
  SubprocessError,
  JasnahError,
  SazedError,
  VaultSyncError,
  HoidError,
  FileOperationError,
  ParseError,
  JiraError,
  TicketStateError,
  ConfigurationError,
} from "./errors.js"

// ── Layer composition ──────────────────────────────────────────────

export const OrchestratorLive = Layer.mergeAll(
  JasnahServiceLive,
  SazedServiceLive,
  HoidServiceLive,
).pipe(
  Layer.provideMerge(SubprocessServiceLive),
  Layer.provideMerge(NodeFileSystem.layer),
)

// ── Shared base layer for preflight checks ────────────────────────

const PreflightLayer = Layer.mergeAll(
  SubprocessServiceLive,
  NodeFileSystem.layer,
)

// ── CLI runner ─────────────────────────────────────────────────────

export type OrchestratorError =
  | SubprocessError
  | JasnahError
  | SazedError
  | VaultSyncError
  | HoidError
  | FileOperationError
  | ParseError
  | JiraError
  | TicketStateError
  | ConfigurationError

export const exitCodeForError = (error: OrchestratorError): number =>
  Match.value(error).pipe(
    Match.tag("ParseError", () => 2),
    Match.tag("TicketStateError", () => 3),
    Match.tag("ConfigurationError", () => 78), // EX_CONFIG from sysexits.h
    Match.tag("SubprocessError", (e) =>
      e.category === "not-found" ? 126
        : e.category === "timeout" ? 124
        : 1,
    ),
    Match.tag("JasnahError", () => 1),
    Match.tag("SazedError", () => 1),
    Match.tag("VaultSyncError", () => 1),
    Match.tag("HoidError", () => 1),
    Match.tag("FileOperationError", () => 1),
    Match.tag("JiraError", () => 1),
    Match.exhaustive,
  )

export const runCli = (
  effect: Effect.Effect<void, OrchestratorError, never>,
): void => {
  const doctorCheck = doctor.pipe(
    Effect.provide(PreflightLayer),
    Effect.catchTag("ConfigurationError", (e) =>
      Effect.fail(e as OrchestratorError),
    ),
    Effect.catchAll((e) =>
      Effect.logWarning(`Doctor check failed: ${String(e)}`),
    ),
  )

  const withChecks = Effect.all([
    preflight.pipe(
      Effect.catchAll((e) => Effect.logWarning(`Preflight failed: ${e}`)),
    ),
    doctorCheck,
  ]).pipe(Effect.flatMap(() => effect))

  Effect.runPromise(
    withChecks.pipe(
      Effect.tapError((error) =>
        Effect.logError(`[dalinar] ${error._tag}: ${error.message}`),
      ),
      Effect.catchAll((error) =>
        Effect.sync(() => {
          process.exitCode = exitCodeForError(error)
        }),
      ),
      Effect.catchAllDefect((defect) =>
        Effect.sync(() => {
          console.error("[dalinar] Unexpected error:", defect)
          process.exitCode = 1
        }),
      ),
    ),
  )
}
