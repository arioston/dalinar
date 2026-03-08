// ── Reflect types ────────────────────────────────────────────────
// Extracted from the CLI entry point so the Effect layer can import
// without an upward dependency on legacy files.

export interface SprintReflection {
  sprint: string
  epicKeys?: string[]
  estimateAccuracy?: EstimateCorrection[]
  blockers?: BlockerEntry[]
  wins?: WinEntry[]
  revisions?: DecisionRevision[]
}

export interface EstimateCorrection {
  taskDescription: string
  estimatedEffort: string
  actualEffort: string
  reason: string
}

export interface BlockerEntry {
  description: string
  impact: string
  wasAnticipated: boolean
}

export interface WinEntry {
  description: string
  replicable: boolean
}

export interface DecisionRevision {
  originalDecision: string
  revision: string
  reason: string
}
