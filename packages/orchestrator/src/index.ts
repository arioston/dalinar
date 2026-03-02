// @dalinar/orchestrator — cross-system pipelines

export {
  searchMemories,
  searchContextForEpic,
  extractMemories,
  formatContextForPrompt,
  type MemorySearchResult,
  type SearchOptions,
  type ExtractEntry,
} from "./jasnah.js"

export {
  analyze,
  syncToJira,
  checkStatus,
  listNotes,
  searchNotes,
  type AnalyzeOptions,
  type AnalyzeResult,
  type SyncOptions,
  type SyncResult,
} from "./sazed.js"

export { analyzeWithContext } from "./analyze-with-context.js"

export { implementTicket, postImplementExtract } from "./implement-ticket.js"

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
