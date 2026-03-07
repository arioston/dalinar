// @dalinar/orchestrator — cross-system pipelines

export * from "./effect/index.js"

export {
  searchMemories,
  searchContextForEpic,
  extractMemories,
  formatContextForPrompt,
  type MemorySearchResult,
  type SearchOptions,
  type ExtractEntry,
} from "./jasnah.js"

export { implementTicketPipeline, postImplementExtractPipeline } from "./implement-ticket.js"

export { runAudit, type AuditReport, type AuditFinding } from "./audit.js"

export {
  runDialectic,
  buildPositionPrompt,
  buildSynthesisPrompt,
  formatDialecticResult,
  resultToExtractEntry,
  type DialecticInput,
  type DialecticResult,
  type Position,
  type Synthesis,
} from "./dialectic.js"

export {
  runReflection,
  reflectionToMemories,
  type SprintReflection,
  type EstimateCorrection,
  type BlockerEntry,
  type WinEntry,
  type DecisionRevision,
} from "./reflect.js"

export {
  syncToVault,
  initWorkLog,
  type VaultSyncResult,
} from "./vault-sync.js"

export {
  discoverSkills,
  validateDependencies,
  type SkillMetadata,
  type SkillRegistry,
  type SkillLoadError,
} from "./skills.js"

export {
  listEvents as hoidListEvents,
  freeSlots as hoidFreeSlots,
  createEvent as hoidCreateEvent,
  moveEvent as hoidMoveEvent,
  conflicts as hoidConflicts,
  type CalendarListOptions,
  type FreeSlotsOptions,
  type CreateEventOptions,
  type MoveEventOptions,
  type ConflictsOptions,
} from "./hoid.js"
