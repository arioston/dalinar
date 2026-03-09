import { Layer, Match } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { SubprocessServiceLive } from "./subprocess.js"
import { JasnahServiceLive, SazedServiceLive, HoidServiceLive } from "./services.js"
import { JiraServiceLive } from "./services/jira.js"
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
  JiraServiceLive,
).pipe(
  Layer.provideMerge(SubprocessServiceLive),
  Layer.provideMerge(NodeFileSystem.layer),
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

