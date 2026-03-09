export {
  SubprocessError,
  JasnahError,
  SazedError,
  VaultSyncError,
  FileOperationError,
  TicketStateError,
  ParseError,
  HoidError,
  JiraError,
  ConfigurationError,
} from "./errors.js"

export {
  SubprocessService,
  SubprocessServiceLive,
  classifyError,
  type SubprocessResult,
  type SubprocessRunOptions,
  type SubprocessServiceShape,
  type SubprocessErrorCategory,
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
  type SyncOptions,
  type CalendarListOptions,
  type FreeSlotsOptions,
  type CreateEventOptions,
  type MoveEventOptions,
  type ConflictsOptions,
  ProjectRoot,
  ProjectRootLive,
  SazedEnvelope,
  extractJsonEnvelope,
} from "./services.js"

export { JiraTask } from "./jira-schemas.js"

export {
  CalendarEvent,
  CalendarListOutput,
  TimeSlot,
  FreeSlotsOutput,
  CreateEventOutput,
  MoveEventOutput,
  Conflict,
  ConflictsOutput,
} from "./hoid-schemas.js"

export {
  JiraService,
  JiraServiceLive,
  type JiraServiceShape,
  type ResolvedKey,
} from "./services/jira.js"

export {
  resolveDalinarRoot,
  resolveJasnahRoot,
  resolveJasnahScript,
  resolveSazedRoot,
  resolveSazedCli,
  resolveHoidRoot,
  resolveHoidScript,
  resolveJiraScript,
  assertNotDist,
  preflight,
  type PreflightCheck,
} from "./paths.js"

export { doctor, type DoctorReport } from "./doctor.js"

export {
  OrchestratorLive,
  exitCodeForError,
  type OrchestratorError,
} from "./runtime.js"

export type { DialecticInput, Position, Synthesis, DialecticResult } from "./types/dialectic.js"
export { buildPositionPrompt, buildSynthesisPrompt, generateConstraints, formatDialecticResult, resultToExtractEntry } from "./types/dialectic.js"
export type { SprintReflection, EstimateCorrection, BlockerEntry, WinEntry, DecisionRevision } from "./types/reflect.js"

export { reflectPipeline } from "./pipelines/reflect.js"
export { vaultSyncPipeline } from "./pipelines/vault-sync.js"
export { dialecticPipeline } from "./pipelines/dialectic.js"
export { implementTicketPipeline, postImplementExtractPipeline } from "./pipelines/implement.js"
export { auditPipeline } from "./pipelines/audit.js"
export { analyzeWithContextPipeline } from "./pipelines/analyze.js"
export { analyzeTask, type AnalyzeTaskOptions, type AnalyzeTaskResult } from "./pipelines/analyze-helper.js"
export {
  deepAnalyzePipeline,
  DeepAnalyzeLive,
  type DeepAnalyzeOptions,
  type DeepAnalyzeResult,
  type TaskAnalysis,
} from "./pipelines/deep-analyze.js"
export { buildTaskRetro, type TaskRetro, type TaskDelta } from "./pipelines/retro.js"

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

export {
  BacklogItem,
  CapacitySnapshot,
  HistoryEntry,
  MiseSnapshot,
  MiseSnapshotJson,
} from "./context/schema.js"
export { contentHash } from "./context/hashing.js"
export {
  SnapshotService,
  SnapshotServiceLive,
  type SnapshotInput,
  type SnapshotServiceShape,
} from "./context/snapshot-service.js"

export { Order, OrderLog, OrderLogJson } from "./wal/schema.js"
export { appendOrder } from "./wal/append.js"
export { readOrders } from "./wal/read.js"
export { promote, type PromotionPaths } from "./wal/promotion.js"
export { WALService, WALServiceLive } from "./wal/service.js"
