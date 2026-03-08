import { Schema } from "effect"

export class JiraTask extends Schema.Class<JiraTask>("JiraTask")({
  key: Schema.String,
  summary: Schema.String,
  status: Schema.String,
  issueType: Schema.String,
  assignee: Schema.optional(Schema.String),
  storyPoints: Schema.optional(Schema.Number),
  labels: Schema.optional(Schema.Array(Schema.String)),
  parentKey: Schema.optional(Schema.String),
}) {}

