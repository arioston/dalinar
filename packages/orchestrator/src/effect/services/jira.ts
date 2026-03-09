import { Context, Effect, Layer, Schedule, Schema } from "effect"
import { JiraError } from "../errors.js"
import { JiraTask } from "../jira-schemas.js"
import { SubprocessService } from "../subprocess.js"
import { resolveJiraScript } from "../paths.js"
import { extractJsonEnvelope } from "../services.js"

// ── ResolvedKey ─────────────────────────────────────────────────

export interface ResolvedKey {
  epicKey: string
  taskKey?: string | undefined
  issueType: string
  taskSummary?: string | undefined
}

// ── Jira API response schemas ───────────────────────────────────

const JiraIssueFields = Schema.Struct({
  summary: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Struct({ name: Schema.String })),
  issuetype: Schema.optional(Schema.Struct({ name: Schema.String })),
  assignee: Schema.optional(Schema.Struct({ displayName: Schema.String })),
  parent: Schema.optional(Schema.Struct({ key: Schema.String })),
  customfield_10014: Schema.optional(Schema.String),  // Epic Link
  customfield_10016: Schema.optional(Schema.Number),  // Story Points
  labels: Schema.optional(Schema.Array(Schema.String)),
})

const JiraIssueResponse = Schema.Struct({
  fields: Schema.optional(JiraIssueFields),
})

const JiraSearchResponse = Schema.Struct({
  issues: Schema.optional(
    Schema.Array(
      Schema.Struct({
        key: Schema.String,
        fields: Schema.optional(JiraIssueFields),
      }),
    ),
  ),
})

type JiraIssueFieldsType = typeof JiraIssueFields.Type

// ── Decode helpers ──────────────────────────────────────────────

/** Decode a JSON string through a Schema, mapping errors to JiraError. */
const decodeJiraResponse = <A, I>(schema: Schema.Schema<A, I, never>) =>
  (stdout: string): Effect.Effect<A, JiraError> => {
    const { json, hadNoise } = extractJsonEnvelope(stdout)
    return (hadNoise ? Effect.logWarning("Jira subprocess emitted non-JSON prefix before JSON payload") : Effect.void).pipe(
      Effect.flatMap(() =>
        Schema.decodeUnknown(Schema.parseJson(schema))(json).pipe(
          Effect.mapError((e) =>
            new JiraError({
              message: `Schema decode failed: ${e.message}`,
              operation: "decodeResponse",
            }),
          ),
        ),
      ),
    )
  }

// ── JiraService ─────────────────────────────────────────────────

export interface JiraServiceShape {
  readonly resolveKey: (key: string) => Effect.Effect<ResolvedKey | null, JiraError>
  readonly fetchTask: (key: string) => Effect.Effect<JiraTask, JiraError>
  readonly fetchTasksForEpic: (epicKey: string) => Effect.Effect<JiraTask[], JiraError>
}

export class JiraService extends Context.Tag("@dalinar/JiraService")<
  JiraService,
  JiraServiceShape
>() {}

/** Map decoded Jira fields to a JiraTask Schema.Class instance. */
const fieldsToJiraTask = (key: string, fields: JiraIssueFieldsType | undefined): JiraTask =>
  new JiraTask({
    key,
    summary: fields?.summary ?? "",
    status: fields?.status?.name ?? "Unknown",
    issueType: fields?.issuetype?.name ?? "Unknown",
    assignee: fields?.assignee?.displayName,
    storyPoints: fields?.customfield_10016,
    labels: fields?.labels,
    parentKey: fields?.parent?.key ?? fields?.customfield_10014,
  })

const jiraRetry = Schedule.exponential("500 millis").pipe(
  Schedule.intersect(Schedule.recurs(3)),
)

const makeJiraService = Effect.gen(function* () {
  const subprocess = yield* SubprocessService

  const resolveKey: JiraServiceShape["resolveKey"] = (key) =>
    Effect.gen(function* () {
      const result = yield* subprocess
        .run(resolveJiraScript(), {
          args: ["GET", `/rest/api/2/issue/${key}?fields=issuetype,parent,customfield_10014,summary`],
          nothrow: true,
          timeout: "10 seconds",
        })
        .pipe(
          Effect.mapError(
            (e) =>
              new JiraError({
                message: `resolveKey failed: ${e.message}`,
                operation: "resolveKey",
                key,
                cause: e,
              }),
          ),
        )

      if (result.exitCode !== 0) return null

      const data = yield* decodeJiraResponse(JiraIssueResponse)(result.stdout).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      )
      if (!data) return null

      const fields = data.fields
      const issueType: string = fields?.issuetype?.name ?? "Unknown"
      const summary: string | undefined = fields?.summary

      if (issueType === "Epic") {
        return { epicKey: key, issueType } satisfies ResolvedKey
      }

      const parentKey: string | undefined =
        fields?.parent?.key ?? fields?.customfield_10014 ?? undefined

      return {
        epicKey: parentKey ?? key,
        taskKey: key,
        issueType,
        taskSummary: summary,
      } satisfies ResolvedKey
    }).pipe(
      Effect.catchAll(() => Effect.succeed(null)),
      Effect.withSpan("jira-resolve-key"),
    )

  const fetchTask: JiraServiceShape["fetchTask"] = (key) =>
    Effect.gen(function* () {
      const result = yield* subprocess
        .run(resolveJiraScript(), {
          args: [
            "GET",
            `/rest/api/2/issue/${key}?fields=summary,status,issuetype,assignee,customfield_10016,labels,parent,customfield_10014`,
          ],
          nothrow: true,
          timeout: "30 seconds",
          retryPolicy: jiraRetry,
        })
        .pipe(
          Effect.mapError(
            (e) =>
              new JiraError({
                message: `fetchTask failed: ${e.message}`,
                operation: "fetchTask",
                key,
                cause: e,
              }),
          ),
        )

      if (result.exitCode !== 0) {
        return yield* new JiraError({
          message: `fetchTask returned exit code ${result.exitCode}: ${result.stderr}`,
          operation: "fetchTask",
          key,
        })
      }

      const data = yield* decodeJiraResponse(JiraIssueResponse)(result.stdout).pipe(
        Effect.mapError(
          (e) =>
            new JiraError({
              message: `fetchTask decode failed: ${e.message}`,
              operation: "fetchTask",
              key,
              cause: e,
            }),
        ),
      )

      return fieldsToJiraTask(key, data.fields)
    }).pipe(Effect.withSpan("jira-fetch-task"))

  const fetchTasksForEpic: JiraServiceShape["fetchTasksForEpic"] = (epicKey) =>
    Effect.gen(function* () {
      const jql = encodeURIComponent(
        `"Epic Link" = ${epicKey} OR parent = ${epicKey}`,
      )
      const result = yield* subprocess
        .run(resolveJiraScript(), {
          args: [
            "GET",
            `/rest/api/2/search?jql=${jql}&fields=summary,status,issuetype,assignee,customfield_10016,labels,parent,customfield_10014&maxResults=50`,
          ],
          nothrow: true,
          timeout: "30 seconds",
          retryPolicy: jiraRetry,
        })
        .pipe(
          Effect.mapError(
            (e) =>
              new JiraError({
                message: `fetchTasksForEpic failed: ${e.message}`,
                operation: "fetchTasksForEpic",
                key: epicKey,
                cause: e,
              }),
          ),
        )

      if (result.exitCode !== 0) {
        return yield* new JiraError({
          message: `fetchTasksForEpic returned exit code ${result.exitCode}: ${result.stderr}`,
          operation: "fetchTasksForEpic",
          key: epicKey,
        })
      }

      const data = yield* decodeJiraResponse(JiraSearchResponse)(result.stdout).pipe(
        Effect.mapError(
          (e) =>
            new JiraError({
              message: `fetchTasksForEpic decode failed: ${e.message}`,
              operation: "fetchTasksForEpic",
              key: epicKey,
              cause: e,
            }),
        ),
      )

      if (!data.issues || !Array.isArray(data.issues)) {
        return yield* new JiraError({
          message: "fetchTasksForEpic returned no issues array",
          operation: "fetchTasksForEpic",
          key: epicKey,
        })
      }

      return data.issues.map((issue) => fieldsToJiraTask(issue.key, issue.fields))
    }).pipe(Effect.withSpan("jira-fetch-tasks-for-epic"))

  return {
    resolveKey,
    fetchTask,
    fetchTasksForEpic,
  } satisfies JiraServiceShape
})

export const JiraServiceLive = Layer.effect(JiraService, makeJiraService)
