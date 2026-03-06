import { Context, Effect, Layer, Schedule } from "effect"
import { resolve } from "path"
import { JiraError } from "../errors.js"
import { JiraTask } from "../jira-schemas.js"
import { SubprocessService } from "../subprocess.js"

// ── ResolvedKey ─────────────────────────────────────────────────

export interface ResolvedKey {
  epicKey: string
  taskKey?: string | undefined
  issueType: string
  taskSummary?: string | undefined
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

function jiraScript(): string {
  return resolve(
    process.env.DALINAR_ROOT ?? process.cwd(),
    "skills/jira/jira-request.ts",
  )
}

function parseJsonFromStdout(stdout: string): unknown {
  const jsonLine = stdout.split("\n").find((l) => l.startsWith("{") || l.startsWith("["))
  if (!jsonLine) return undefined
  return JSON.parse(jsonLine)
}

// Jira API response shapes (minimal — just the fields we access)
interface JiraIssueFields {
  readonly summary?: string
  readonly status?: { readonly name: string }
  readonly issuetype?: { readonly name: string }
  readonly assignee?: { readonly displayName: string }
  readonly parent?: { readonly key: string }
  readonly customfield_10014?: string  // Epic Link
  readonly customfield_10016?: number  // Story Points
  readonly labels?: readonly string[]
}

interface JiraIssueResponse {
  readonly fields?: JiraIssueFields
}

interface JiraSearchResponse {
  readonly issues?: readonly (JiraIssueResponse & { readonly key: string })[]
}

const jiraRetry = Schedule.exponential("500 millis").pipe(
  Schedule.intersect(Schedule.recurs(3)),
)

const makeJiraService = Effect.gen(function* () {
  const subprocess = yield* SubprocessService

  const resolveKey: JiraServiceShape["resolveKey"] = (key) =>
    Effect.gen(function* () {
      const result = yield* subprocess
        .run(jiraScript(), {
          args: ["GET", `/rest/api/2/issue/${key}?fields=issuetype,parent,customfield_10014,summary`],
          nothrow: true,
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

      let data: JiraIssueResponse | undefined
      try {
        data = parseJsonFromStdout(result.stdout) as JiraIssueResponse | undefined
      } catch {
        return null
      }
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
        .run(jiraScript(), {
          args: [
            "GET",
            `/rest/api/2/issue/${key}?fields=summary,status,issuetype,assignee,customfield_10016,labels,parent,customfield_10014`,
          ],
          nothrow: true,
        })
        .pipe(
          Effect.retry({ schedule: jiraRetry, while: (e) => e._tag === "SubprocessError" }),
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

      let data: JiraIssueResponse | undefined
      try {
        data = parseJsonFromStdout(result.stdout) as JiraIssueResponse | undefined
      } catch (err) {
        return yield* new JiraError({
          message: `fetchTask failed to parse JSON: ${err}`,
          operation: "fetchTask",
          key,
          cause: err,
        })
      }

      if (!data) {
        return yield* new JiraError({
          message: "fetchTask returned no JSON",
          operation: "fetchTask",
          key,
        })
      }

      const fields = data.fields
      return new JiraTask({
        key,
        summary: fields?.summary ?? "",
        status: fields?.status?.name ?? "Unknown",
        issueType: fields?.issuetype?.name ?? "Unknown",
        assignee: fields?.assignee?.displayName,
        storyPoints: fields?.customfield_10016,
        labels: fields?.labels as string[] | undefined,
        parentKey: fields?.parent?.key ?? fields?.customfield_10014,
      })
    }).pipe(Effect.withSpan("jira-fetch-task"))

  const fetchTasksForEpic: JiraServiceShape["fetchTasksForEpic"] = (epicKey) =>
    Effect.gen(function* () {
      const jql = encodeURIComponent(
        `"Epic Link" = ${epicKey} OR parent = ${epicKey}`,
      )
      const result = yield* subprocess
        .run(jiraScript(), {
          args: [
            "GET",
            `/rest/api/2/search?jql=${jql}&fields=summary,status,issuetype,assignee,customfield_10016,labels,parent,customfield_10014&maxResults=50`,
          ],
          nothrow: true,
        })
        .pipe(
          Effect.retry({ schedule: jiraRetry, while: (e) => e._tag === "SubprocessError" }),
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

      let data: JiraSearchResponse | undefined
      try {
        data = parseJsonFromStdout(result.stdout) as JiraSearchResponse | undefined
      } catch (err) {
        return yield* new JiraError({
          message: `fetchTasksForEpic failed to parse JSON: ${err}`,
          operation: "fetchTasksForEpic",
          key: epicKey,
          cause: err,
        })
      }

      if (!data || !Array.isArray(data.issues)) {
        return yield* new JiraError({
          message: "fetchTasksForEpic returned no issues array",
          operation: "fetchTasksForEpic",
          key: epicKey,
        })
      }

      return (data.issues ?? []).map((issue) => {
        const fields = issue.fields
        return new JiraTask({
          key: issue.key,
          summary: fields?.summary ?? "",
          status: fields?.status?.name ?? "Unknown",
          issueType: fields?.issuetype?.name ?? "Unknown",
          assignee: fields?.assignee?.displayName,
          storyPoints: fields?.customfield_10016,
          labels: fields?.labels as string[] | undefined,
          parentKey: fields?.parent?.key ?? fields?.customfield_10014,
        })
      }) as JiraTask[]
    }).pipe(Effect.withSpan("jira-fetch-tasks-for-epic"))

  return {
    resolveKey,
    fetchTask,
    fetchTasksForEpic,
  } satisfies JiraServiceShape
})

export const JiraServiceLive = Layer.effect(JiraService, makeJiraService)
