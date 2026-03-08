import { Schema } from "effect"

export class SubprocessError extends Schema.TaggedError<SubprocessError>()("SubprocessError", {
  message: Schema.String,
  command: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
  stderr: Schema.optional(Schema.String),
  category: Schema.optional(Schema.Literal("not-found", "auth", "timeout", "crash", "unknown")),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class JasnahError extends Schema.TaggedError<JasnahError>()("JasnahError", {
  message: Schema.String,
  operation: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class SazedError extends Schema.TaggedError<SazedError>()("SazedError", {
  message: Schema.String,
  epicKey: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class VaultSyncError extends Schema.TaggedError<VaultSyncError>()("VaultSyncError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export class FileOperationError extends Schema.TaggedError<FileOperationError>()("FileOperationError", {
  message: Schema.String,
  filePath: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class TicketStateError extends Schema.TaggedError<TicketStateError>()("TicketStateError", {
  message: Schema.String,
  ticketKey: Schema.optional(Schema.String),
  fromState: Schema.optional(Schema.String),
  toState: Schema.optional(Schema.String),
}) {}

export class ParseError extends Schema.TaggedError<ParseError>()("ParseError", {
  message: Schema.String,
  input: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class HoidError extends Schema.TaggedError<HoidError>()("HoidError", {
  message: Schema.String,
  operation: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class JiraError extends Schema.TaggedError<JiraError>()("JiraError", {
  message: Schema.String,
  operation: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class ConfigurationError extends Schema.TaggedError<ConfigurationError>()("ConfigurationError", {
  message: Schema.String,
  variable: Schema.optional(Schema.String),
  currentValue: Schema.optional(Schema.String),
  supportedValues: Schema.optional(Schema.Array(Schema.String)),
  remediation: Schema.optional(Schema.String),
}) {}
