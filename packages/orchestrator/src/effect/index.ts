export {
  SubprocessError,
  JasnahError,
  SazedError,
  VaultSyncError,
  FileOperationError,
  TicketStateError,
  ParseError,
  HoidError,
} from "./errors.js"

export {
  SubprocessService,
  SubprocessServiceLive,
  type SubprocessResult,
  type SubprocessRunOptions,
  type SubprocessServiceShape,
} from "./subprocess.js"

export {
  JasnahService,
  JasnahServiceLive,
  SazedService,
  SazedServiceLive,
  HoidService,
  HoidServiceLive,
  type JasnahServiceShape,
  type SazedServiceShape,
  type HoidServiceShape,
  type MemorySearchResult,
  type SearchOptions,
  type ExtractEntry,
  type AnalyzeOptions,
  type AnalyzeResult,
  type SyncOptions,
  type SyncResult,
  type CalendarListOptions,
  type FreeSlotsOptions,
  type CreateEventOptions,
  type MoveEventOptions,
  type ConflictsOptions,
} from "./services.js"

export {
  OrchestratorLive,
  runCli,
} from "./runtime.js"

export { reflectPipeline } from "./pipelines/reflect.js"
export { vaultSyncPipeline } from "./pipelines/vault-sync.js"
export { dialecticPipeline } from "./pipelines/dialectic.js"
export { implementTicketPipeline } from "./pipelines/implement.js"
export { auditPipeline } from "./pipelines/audit.js"
export { analyzeWithContextPipeline } from "./pipelines/analyze.js"

export {
  type TicketState,
  Unclaimed,
  Claimed,
  InProgress,
  Done,
  Blocked,
} from "./ticket/state.js"
export type {
  TicketAction,
  ClaimAction,
  StartProgressAction,
  CompleteAction,
  BlockAction,
  UnblockAction,
  ReleaseAction,
} from "./ticket/actions.js"
export { transition } from "./ticket/transitions.js"
export { encodeTicketState, decodeTicketState, TicketStateSchema } from "./ticket/persistence.js"
export { TicketStore, TicketStoreLive } from "./ticket/store.js"
