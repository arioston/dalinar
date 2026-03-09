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
      Effect.provide(PreflightLayer),
      Effect.catchAll((e) => Effect.logWarning(`Preflight failed: ${e}`)),
    ),
    doctorCheck,
  ]).pipe(Effect.flatMap(() => effect))

  Effect.runPromise(
    withChecks.pipe(
      Effect.tapError((error) => {
        const annotations: Record<string, string> = {
          errorTag: error._tag,
          errorMessage: error.message,
        }
        if ("epicKey" in error && error.epicKey) annotations.epicKey = error.epicKey
        if ("command" in error && error.command) annotations.command = error.command
        if ("category" in error && error.category) annotations.category = error.category
        if ("exitCode" in error && error.exitCode !== undefined) annotations.exitCode = String(error.exitCode)
        if ("stderr" in error && error.stderr) annotations.stderr = error.stderr
        if ("operation" in error && error.operation) annotations.operation = error.operation
        if ("filePath" in error && error.filePath) annotations.filePath = error.filePath
        if ("ticketKey" in error && error.ticketKey) annotations.ticketKey = error.ticketKey
        if ("variable" in error && error.variable) annotations.variable = error.variable
        return Effect.logError("[dalinar] Pipeline failed").pipe(
          Effect.annotateLogs(annotations),
        )
      }),
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
