import { Effect } from "effect"
import { FileSystem } from "@effect/platform"
import { resolve } from "path"
import { type AnalyzeOptions } from "../services.js"
import { FileOperationError } from "../errors.js"
import { vaultSyncPipeline } from "./vault-sync.js"
import { analyzeTask } from "./analyze-helper.js"
import { JiraService } from "../services/jira.js"
import type { JiraTask } from "../jira-schemas.js"
import {
  getCompletedTaskEvidence,
  formatEvidenceAsContext,
} from "./retro.js"

// ── Helpers ───────────────────────────────────────────────────────

const DONE_STATUSES = new Set(["done", "closed", "resolved"])

function formatTaskHierarchy(
  tasks: readonly JiraTask[],
  evidenceContext: string,
): string {
  if (tasks.length === 0) return ""

  const completed = tasks.filter(t => DONE_STATUSES.has(t.status.toLowerCase()))
  const pending = tasks.filter(t => !DONE_STATUSES.has(t.status.toLowerCase()))

  const lines = ["## Epic Task Structure (from Jira)", ""]

  // Completed tasks as evidence
  if (completed.length > 0) {
    lines.push("### Completed Tasks")
    for (const t of completed) {
      const assignee = t.assignee ? ` (assigned: ${t.assignee})` : ""
      lines.push(`- ~~${t.key}: ${t.summary}~~ — ${t.status}${assignee}`)
    }
    lines.push("")
  }

  // Pending tasks as the required plan skeleton
  if (pending.length > 0) {
    lines.push("### Pending Tasks — YOU MUST PLAN EXACTLY THESE")
    lines.push("")
    for (const t of pending) {
      const assignee = t.assignee ? ` (assigned: ${t.assignee})` : ""
      const points = t.storyPoints ? ` [${t.storyPoints}pts]` : ""
      lines.push(`- **${t.key}**: ${t.summary}${assignee}${points}`)
    }
    lines.push("")
    lines.push(`**BINDING CONSTRAINT**: Your plan MUST produce exactly ${pending.length} tasks.`)
    lines.push(`Each task MUST use the Jira key as its ID (${pending.map(t => t.key).join(", ")}).`)
    lines.push(`Each task title MUST start with its Jira key (e.g., "${pending[0].key} — ${pending[0].summary}").`)
    lines.push("Do NOT invent new tasks. Do NOT merge or split these tasks. Do NOT renumber them.")
  }

  if (evidenceContext) {
    lines.push("")
    lines.push(evidenceContext)
  }

  return lines.join("\n")
}

// ── Effect pipeline ────────────────────────────────────────────────

export const analyzeWithContextPipeline = (
  opts: AnalyzeOptions & { root?: string },
) =>
  Effect.gen(function* () {
    // Stage 0: Resolve key (task → parent epic) via Jira
    const jira = yield* JiraService

    let epicKey = opts.epicKey
    let taskKey: string | undefined

    const resolved = yield* jira.resolveKey(opts.epicKey).pipe(
      Effect.orElseSucceed(() => null),
    )
    if (resolved) {
      epicKey = resolved.epicKey
      taskKey = resolved.taskKey
      if (taskKey) {
        yield* Effect.log(`Resolved task ${taskKey} (${resolved.issueType}) -> epic ${epicKey}`)
      }
    }

    yield* Effect.logInfo("Starting analysis with context")

    // Stage 0.5: Fetch task hierarchy — always task-aware when epic has children
    let extraContext: string | undefined
    const epicTasks = yield* jira.fetchTasksForEpic(epicKey).pipe(
      Effect.tapError((e) => Effect.logWarning(`fetchTasksForEpic failed: ${e.message}`)),
      Effect.catchAll(() => Effect.succeed([] as JiraTask[])),
    )

    if (epicTasks.length > 0) {
      const completed = epicTasks.filter(t => DONE_STATUSES.has(t.status.toLowerCase()))
      const pending = epicTasks.filter(t => !DONE_STATUSES.has(t.status.toLowerCase()))

      yield* Effect.logInfo("Epic task hierarchy loaded").pipe(
        Effect.annotateLogs({
          total: String(epicTasks.length),
          completed: String(completed.length),
          pending: String(pending.length),
        }),
      )

      // Gather git evidence for completed tasks
      let evidenceContext = ""
      if (completed.length > 0) {
        yield* Effect.logInfo(`Gathering git evidence from ${completed.length} completed tasks`)
        const root = opts.root ?? process.cwd()
        const evidence = yield* Effect.forEach(
          completed,
          (task) => getCompletedTaskEvidence(task, root),
          { concurrency: "unbounded" },
        )
        evidenceContext = formatEvidenceAsContext(evidence)
      }

      extraContext = formatTaskHierarchy(epicTasks, evidenceContext)
    }

    // Stages 1-3: Search context → Sazed analysis → Extract notes (via shared helper)
    const result = yield* analyzeTask({
      epicKey,
      taskKey,
      extraContext,
      root: opts.root,
      force: opts.force,
      notes: opts.notes,
      noMap: opts.noMap,
      noCache: opts.noCache,
      forensics: opts.forensics,
      datastore: opts.datastore,
    })

    yield* Effect.logInfo("Analysis complete").pipe(
      Effect.annotateLogs({ chars: String(result.markdown.length), notesExtracted: String(result.notesExtracted) }),
    )

    // Stage 4: Vault sync
    yield* Effect.logInfo("Vault sync...")
    const vaultResult = yield* vaultSyncPipeline(opts.root).pipe(
      Effect.withLogSpan("vault-sync"),
    )
    if (vaultResult.synced) {
      yield* Effect.logInfo(`Synced to ${vaultResult.target}`)
    } else {
      yield* Effect.logDebug(`Vault sync skipped: ${vaultResult.reason}`)
    }

    // Output the analysis
    if (opts.stdout) {
      yield* Effect.log("\n" + "=".repeat(60))
      yield* Effect.log(result.markdown)
      yield* Effect.log("=".repeat(60))
    } else {
      const fs = yield* FileSystem.FileSystem
      const outDir = resolve(opts.root ?? process.cwd(), ".refinement")
      yield* fs.makeDirectory(outDir, { recursive: true }).pipe(
        Effect.mapError((e) => new FileOperationError({
          message: `Failed to create output directory: ${e.message}`,
          filePath: outDir,
          cause: e,
        })),
      )

      // Find next available version to avoid overwriting
      const baseName = `${epicKey}-analysis`
      let outPath = resolve(outDir, `${baseName}.md`)
      const baseExists = yield* fs.exists(outPath)
      if (baseExists) {
        let v = 2
        while (yield* fs.exists(resolve(outDir, `${baseName}-v${v}.md`))) v++
        outPath = resolve(outDir, `${baseName}-v${v}.md`)
      }

      yield* fs.writeFileString(outPath, result.markdown).pipe(
        Effect.mapError((e) => new FileOperationError({
          message: `Failed to write analysis: ${e.message}`,
          filePath: outPath,
          cause: e,
        })),
      )
      yield* Effect.logInfo(`Written to ${outPath}`)
    }

    yield* Effect.logInfo(
      `Done. ${epicKey} analyzed with ${result.memoriesUsed} prior context entries.`,
    )

    return { markdown: result.markdown, memoriesUsed: result.memoriesUsed }
  }).pipe(
    Effect.annotateLogs({
      pipeline: "analyze-with-context",
      epicKey: opts.epicKey,
    }),
    Effect.withLogSpan("analyze-with-context"),
    Effect.withSpan("analyze-with-context"),
  )
