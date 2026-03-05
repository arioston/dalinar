import { Schema } from "effect"

export class BacklogItem extends Schema.Class<BacklogItem>("BacklogItem")({
  key: Schema.String,
  summary: Schema.String,
  status: Schema.String,
  priority: Schema.optional(Schema.String),
  storyPoints: Schema.optional(Schema.Number),
  assignee: Schema.optional(Schema.String),
  labels: Schema.optional(Schema.Array(Schema.String)),
}) {}

export class CapacitySnapshot extends Schema.Class<CapacitySnapshot>("CapacitySnapshot")({
  totalPoints: Schema.Number,
  completedPoints: Schema.Number,
  inProgressPoints: Schema.Number,
  blockedPoints: Schema.Number,
  velocity: Schema.optional(Schema.Number),
  sprintName: Schema.optional(Schema.String),
}) {}

export class HistoryEntry extends Schema.Class<HistoryEntry>("HistoryEntry")({
  timestamp: Schema.String,
  action: Schema.String,
  ticketKey: Schema.optional(Schema.String),
  details: Schema.optional(Schema.String),
}) {}

export class MiseSnapshot extends Schema.Class<MiseSnapshot>("MiseSnapshot")({
  timestamp: Schema.String,
  contentHash: Schema.String,
  backlog: Schema.Array(BacklogItem),
  capacity: CapacitySnapshot,
  recentHistory: Schema.Array(HistoryEntry),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
}) {}

export const MiseSnapshotJson = Schema.parseJson(MiseSnapshot)
