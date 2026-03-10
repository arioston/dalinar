import { Effect, Layer } from "effect"
import { ProjectRoot, ProjectRootLive } from "../services.js"
import { JiraService } from "../services/jira.js"
import { OrchestratorLive } from "../runtime.js"
import { vaultSyncPipeline } from "./vault-sync.js"
import { analyzeTask, type AnalyzeTaskResult } from "./analyze-helper.js"
import {
  getCompletedTaskEvidence,
  formatEvidenceAsContext,
  type CompletedTaskEvidence,
} from "./retro.js"
import type { JiraTask } from "../jira-schemas.js"

// ── Types ─────────────────────────────────────────────────────────

export interface DeepAnalyzeOptions {
  readonly key: string
  readonly root?: string | undefined
  readonly force?: boolean | undefined
  readonly notes?: boolean | undefined
  readonly taskOnly?: boolean | undefined
}

export interface DeepAnalyzeResult {
  readonly epicKey: string
  readonly mode: "plan" | "analyze-pending"
  readonly evidence: readonly CompletedTaskEvidence[]
  readonly analyses: readonly TaskAnalysis[]
  readonly memoriesUsed: number
}

export interface TaskAnalysis {
  readonly taskKey: string
  readonly markdown: string
  readonly success: boolean
}

// ── Helpers ───────────────────────────────────────────────────────

const DONE_STATUSES = new Set(["done", "closed", "resolved"])

function isCompleted(task: JiraTask): boolean {
  return DONE_STATUSES.has(task.status.toLowerCase())
}

// ── Pipeline ──────────────────────────────────────────────────────

export const deepAnalyzePipeline = (opts: DeepAnalyzeOptions) =>
  Effect.gen(function* () {
    const jira = yield* JiraService
    const { root } = yield* ProjectRoot

    // Step 0: Resolve key
    yield* Effect.log(`Resolving key: ${opts.key}...`)
    const resolved = yield* jira.resolveKey(opts.key).pipe(
      Effect.orElseSucceed(() => null),
    )

    const epicKey = resolved?.epicKey ?? opts.key
    const targetTaskKey = resolved?.taskKey

    if (targetTaskKey) {
      yield* Effect.log(`Resolved task ${targetTaskKey} -> epic ${epicKey}`)
    }

    // Step 1: Fetch epic hierarchy
    yield* Effect.log(`Fetching task hierarchy for ${epicKey}...`)
    const allTasks = yield* jira.fetchTasksForEpic(epicKey)

    // Branch: no tasks = plan the epic, has tasks = analyze pending with git context
    if (allTasks.length === 0) {
      // ── Plan mode: full epic decomposition ──
      yield* Effect.log("No tasks found — running full epic decomposition")

      const result = yield* analyzeTask({
        epicKey,
        root,
        ...(opts.force ? { force: opts.force } : {}),
        ...(opts.notes ? { notes: opts.notes } : {}),
      }).pipe(
        Effect.timeout("5 minutes"),
        Effect.catchAll((err) =>
          Effect.succeed({
            markdown: `Analysis failed: ${err}`,
            memoriesUsed: 0,
            notesExtracted: 0,
          } satisfies AnalyzeTaskResult),
        ),
      )

      const analysis: TaskAnalysis = {
        taskKey: epicKey,
        markdown: result.markdown,
        success: !result.markdown.startsWith("Analysis failed:"),
      }

      yield* vaultSync(root)

      return {
        epicKey,
        mode: "plan" as const,
        evidence: [],
        analyses: [analysis],
        memoriesUsed: result.memoriesUsed,
      } satisfies DeepAnalyzeResult
    }

    // ── Analyze-pending mode: git evidence from completed, analyze open ──
    const completed = allTasks.filter(isCompleted)
    const pending = allTasks.filter((t) => !isCompleted(t))

    yield* Effect.log(
      `Found ${allTasks.length} tasks: ${completed.length} completed, ${pending.length} pending`,
    )

    // Step 2: Extract git evidence for completed tasks (parallel)
    yield* Effect.log("Extracting git evidence for completed tasks...")
    const evidence = yield* Effect.forEach(
      completed,
      (task) => getCompletedTaskEvidence(task, root),
      { concurrency: "unbounded" },
    )

    const withCommits = evidence.filter((e) => e.commitLog !== "(no commits found)")
    yield* Effect.log(`  ${withCommits.length}/${completed.length} tasks have git commits`)

    const evidenceContext = formatEvidenceAsContext(evidence)

    // Step 3: Analyze pending tasks
    const tasksToAnalyze: JiraTask[] = targetTaskKey
      ? (() => {
          const inPending = pending.filter((t) => t.key === targetTaskKey)
          if (inPending.length > 0) return inPending
          // Target task might be completed — still allow analysis
          const target = allTasks.find((t) => t.key === targetTaskKey)
          if (target) return [target]
          return []
        })()
      : [...pending]

    if (tasksToAnalyze.length === 0 && targetTaskKey) {
      yield* Effect.log(`Task ${targetTaskKey} not found in epic hierarchy`)
    }

    yield* Effect.log(`Analyzing ${tasksToAnalyze.length} tasks sequentially...`)

    // Use evidence-grounded context only — no LLM output accumulation
    // to ensure analysis is deterministic regardless of task order
    const analyses: TaskAnalysis[] = []

    for (const [index, task] of tasksToAnalyze.entries()) {
      yield* Effect.log(`  [${index + 1}/${tasksToAnalyze.length}] Analyzing ${task.key}: ${task.summary}`)

      const result = yield* analyzeTask({
        epicKey,
        taskKey: task.key,
        extraContext: evidenceContext || undefined,
        root,
        ...(opts.force ? { force: opts.force } : {}),
        ...(opts.notes ? { notes: opts.notes } : {}),
      }).pipe(
        Effect.timeout("5 minutes"),
        Effect.catchAll((err) =>
          Effect.succeed({
            markdown: `Analysis failed: ${err}`,
            memoriesUsed: 0,
            notesExtracted: 0,
          } satisfies AnalyzeTaskResult),
        ),
      )

      const success = !result.markdown.startsWith("Analysis failed:")
      analyses.push({
        taskKey: task.key,
        markdown: result.markdown,
        success,
      })
    }
    const successCount = analyses.filter((a) => a.success).length
    yield* Effect.log(`Completed: ${successCount}/${analyses.length} analyses succeeded`)

    yield* vaultSync(root)

    return {
      epicKey,
      mode: "analyze-pending" as const,
      evidence,
      analyses,
      memoriesUsed: evidence.length,
    } satisfies DeepAnalyzeResult
  }).pipe(Effect.withSpan("deep-analyze"))

// ── Vault sync helper ─────────────────────────────────────────────

const vaultSync = (root: string) =>
  Effect.gen(function* () {
    yield* Effect.log("Vault sync...")
    const vaultResult = yield* vaultSyncPipeline(root)
    if (vaultResult.synced) {
      yield* Effect.log(`Synced to ${vaultResult.target}`)
    } else {
      yield* Effect.log(`Skipped: ${vaultResult.reason}`)
    }
  })

// ── Layer composition ─────────────────────────────────────────────

export const DeepAnalyzeLive = (root: string) =>
  OrchestratorLive.pipe(
    Layer.provideMerge(ProjectRootLive(root)),
  )
