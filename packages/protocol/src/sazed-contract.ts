/**
 * Sazed CLI JSON output contract.
 *
 * Wire types for the subprocess boundary between the orchestrator and Sazed CLI.
 * Both sides import these schemas — Sazed encodes, the orchestrator decodes.
 * Shape changes break at compile time, not at runtime with silent blob degradation.
 */

import { Schema } from "effect"

// ── Contract version ─────────────────────────────────────────────

export const SAZED_CONTRACT_VERSION = "1.1.0" as const

// ── analyze --json ───────────────────────────────────────────────

export class SazedTechnicalDef extends Schema.Class<SazedTechnicalDef>("SazedTechnicalDef")({
  patternReference: Schema.Array(Schema.String),
  filesToModify: Schema.Array(Schema.String),
  integrationPoints: Schema.Array(Schema.String),
  codeToReuse: Schema.Array(Schema.String),
}) {}

export class SazedTaskOutput extends Schema.Class<SazedTaskOutput>("SazedTaskOutput")({
  id: Schema.String,
  epicKey: Schema.String,
  title: Schema.String,
  description: Schema.String,
  technicalDefinition: SazedTechnicalDef,
  acceptanceCriteria: Schema.Array(Schema.String),
  complexity: Schema.Literal("S", "M"),
  confidence: Schema.Literal("high", "medium", "low"),
  dependencies: Schema.Array(Schema.String),
  parallelizableWith: Schema.Array(Schema.String),
}) {}

export class SazedNoteOutput extends Schema.Class<SazedNoteOutput>("SazedNoteOutput")({
  title: Schema.String,
  type: Schema.Literal("domain-fact", "architecture", "api-contract", "glossary", "lesson-learned"),
  content: Schema.String,
  tags: Schema.Array(Schema.String),
  relatedNotes: Schema.Array(Schema.String),
}) {}

export class SazedImpactSummary extends Schema.Class<SazedImpactSummary>("SazedImpactSummary")({
  filesAnalyzed: Schema.Number,
  directInvariants: Schema.Number,
  relatedInvariants: Schema.Number,
  datastoreConstraints: Schema.optional(Schema.Number),
  datastoreProvider: Schema.optional(Schema.String),
  datastoreTargets: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class SazedAnalyzeOutput extends Schema.Class<SazedAnalyzeOutput>("SazedAnalyzeOutput")({
  epicKey: Schema.String,
  epicSummary: Schema.String,
  contextSummary: Schema.String,
  tasks: Schema.Array(SazedTaskOutput),
  notes: Schema.Array(SazedNoteOutput),
  communicationFlow: Schema.Struct({
    applicable: Schema.Boolean,
    mermaidDiagram: Schema.optional(Schema.String),
  }),
  diffFromPrevious: Schema.NullOr(Schema.String),
  markdown: Schema.String,
  basedOnCommit: Schema.String,
  createdAt: Schema.String,
  impactSummary: Schema.optional(SazedImpactSummary),
}) {}

// ── sync --json ──────────────────────────────────────────────────

export class SazedSyncOutput extends Schema.Class<SazedSyncOutput>("SazedSyncOutput")({
  created: Schema.Array(Schema.Struct({ taskId: Schema.String, jiraKey: Schema.String })),
  updated: Schema.Array(Schema.Struct({ taskId: Schema.String, jiraKey: Schema.String })),
  skipped: Schema.Array(Schema.Struct({ taskId: Schema.String, reason: Schema.String })),
}) {}

// ── status --json ────────────────────────────────────────────────

export class SazedStatusEntry extends Schema.Class<SazedStatusEntry>("SazedStatusEntry")({
  taskId: Schema.String,
  taskTitle: Schema.String,
  status: Schema.Literal("current", "stale", "unknown"),
  changedFiles: Schema.Array(Schema.String),
}) {}

export class SazedStatusOutput extends Schema.Class<SazedStatusOutput>("SazedStatusOutput")({
  epicKey: Schema.String,
  basedOnCommit: Schema.String,
  tasks: Schema.Array(SazedStatusEntry),
}) {}

// ── notes list/search --json ─────────────────────────────────────

export class SazedNoteHeader extends Schema.Class<SazedNoteHeader>("SazedNoteHeader")({
  slug: Schema.String,
  title: Schema.String,
  type: Schema.Literal("domain-fact", "architecture", "api-contract", "glossary", "lesson-learned"),
  tags: Schema.Array(Schema.String),
  retentionScore: Schema.Number,
}) {}

export class SazedNotesListOutput extends Schema.Class<SazedNotesListOutput>("SazedNotesListOutput")({
  notes: Schema.Array(SazedNoteHeader),
}) {}
