import { Effect, Layer } from "effect"
import { JasnahService, ProjectRoot, ProjectRootLive } from "../services.js"
import { JiraService } from "../services/jira.js"
import { OrchestratorLive } from "../runtime.js"
import { WALServiceLive } from "../wal/service.js"
import { readOrders } from "../wal/read.js"
import type { Order } from "../wal/schema.js"
import { vaultSyncPipeline } from "./vault-sync.js"
import { analyzeTask, type AnalyzeTaskResult } from "./analyze-helper.js"
import { buildTaskRetro, type TaskRetro } from "./retro.js"
import type { JiraTask } from "../jira-schemas.js"
import type { MemorySearchResult } from "../services.js"

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
  readonly retros: readonly TaskRetro[]
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

function formatRetrosAsContext(retros: readonly TaskRetro[]): string {
  const meaningful = retros.filter(
    (r) => r.learnings.length > 0 || r.deltas.length > 0 || r.surprises.length > 0,
  )
  if (meaningful.length === 0) return ""

  const lines = ["## Sibling Task Retrospectives", ""]
  for (const retro of meaningful) {
    lines.push(`### ${retro.taskKey}: ${retro.summary} (${retro.status})`)
    if (retro.learnings.length > 0) {
      lines.push("**Learnings:**")
      for (const l of retro.learnings) lines.push(`- ${l}`)
    }
    if (retro.deltas.length > 0) {
      lines.push("**Plan vs Actual:**")
      for (const d of retro.deltas) lines.push(`- ${d.field}: planned "${d.planned}" → actual "${d.actual}"`)
    }
    if (retro.surprises.length > 0) {
      lines.push("**Surprises:**")
      for (const s of retro.surprises) lines.push(`- ${s}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

// ── Pipeline ──────────────────────────────────────────────────────

export const deepAnalyzePipeline = (opts: DeepAnalyzeOptions) =>
  Effect.gen(function* () {
    const jira = yield* JiraService
    const jasnah = yield* JasnahService
    const { root } = yield* ProjectRoot

    const ordersDir = `${root}/.orders`

    // Step 0: Resolve key
    yield* Effect.log(`Resolving key: ${opts.key}...`)
    const resolved = yield* jira.resolveKey(opts.key).pipe(
      Effect.orElseSucceed(() => null),
    )

    const epicKey = resolved?.epicKey ?? opts.key
    const targetTaskKey = resolved?.taskKey

    if (targetTaskKey) {
      yield* Effect.log(`Resolved task ${targetTaskKey} → epic ${epicKey}`)
    }

    // Step 1: Fetch epic hierarchy
    yield* Effect.log(`Fetching task hierarchy for ${epicKey}...`)
    const allTasks = yield* jira.fetchTasksForEpic(epicKey)
    const completed = allTasks.filter(isCompleted)
    const pending = allTasks.filter((t) => !isCompleted(t))

    yield* Effect.log(`Found ${allTasks.length} tasks: ${completed.length} completed, ${pending.length} pending`)

    // Step 2: Load WAL orders
    const orders = yield* readOrders(ordersDir).pipe(
      Effect.catchAll(() => Effect.succeed([] as Order[])),
    )

    // Step 3: Build retrospectives for completed tasks
    yield* Effect.log("Building retrospectives for completed tasks...")

    const retroResults = yield* Effect.partition(
      completed,
      (task) =>
        Effect.gen(function* () {
          const memories = yield* jasnah.searchMemories({
            query: task.summary,
            tags: [task.key.toLowerCase()],
            limit: 5,
            root,
          }).pipe(Effect.catchAll(() => Effect.succeed([] as MemorySearchResult[])))

          return buildTaskRetro(task, orders, memories)
        }),
      { concurrency: "unbounded" },
    )

    const [retroErrors, retros] = retroResults
    if (retroErrors.length > 0) {
      yield* Effect.log(`  ${retroErrors.length} retro builds failed (non-fatal)`)
    }
    yield* Effect.log(`  Built ${retros.length} retrospectives`)

    // Format retros as context for pending task analysis
    const retroContext = formatRetrosAsContext(retros)

    // Step 4: Analyze pending tasks
    let analyses: readonly TaskAnalysis[]

    if (targetTaskKey) {
      // Targeted mode: only analyze the specific task
      const targetTask = pending.find((t) => t.key === targetTaskKey)
        ?? allTasks.find((t) => t.key === targetTaskKey)

      if (targetTask) {
        yield* Effect.log(`Targeted analysis for ${targetTaskKey}...`)
        const result = yield* analyzeTask({
          epicKey,
          taskKey: targetTaskKey,
          extraContext: retroContext || undefined,
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

        analyses = [{
          taskKey: targetTaskKey,
          markdown: result.markdown,
          success: !result.markdown.startsWith("Analysis failed:"),
        }]
      } else {
        yield* Effect.log(`Task ${targetTaskKey} not found in epic hierarchy`)
        analyses = []
      }
    } else {
      // Full mode: sequential analysis with accumulated learnings via Effect.reduce
      yield* Effect.log(`Analyzing ${pending.length} pending tasks sequentially...`)

      interface ReduceState {
        readonly context: string
        readonly results: readonly TaskAnalysis[]
      }

      const final = yield* Effect.reduce(
        pending,
        { context: retroContext, results: [] } as ReduceState,
        (state, task, index) =>
          Effect.gen(function* () {
            yield* Effect.log(`  [${index + 1}/${pending.length}] Analyzing ${task.key}: ${task.summary}`)

            const result = yield* analyzeTask({
              epicKey,
              taskKey: task.key,
              extraContext: state.context || undefined,
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
            const analysis: TaskAnalysis = {
              taskKey: task.key,
              markdown: result.markdown,
              success,
            }

            return {
              context: success
                ? state.context + `\n### ${task.key} analysis summary\n${result.markdown.slice(0, 500)}`
                : state.context,
              results: [...state.results, analysis],
            }
          }),
      )

      analyses = final.results
    }

    const successCount = analyses.filter((a) => a.success).length
    yield* Effect.log(`Completed: ${successCount}/${analyses.length} analyses succeeded`)

    // Step 5: Vault sync (once at the end)
    yield* Effect.log("Vault sync...")
    const vaultResult = yield* vaultSyncPipeline(root)
    if (vaultResult.synced) {
      yield* Effect.log(`Synced to ${vaultResult.target}`)
    } else {
      yield* Effect.log(`Skipped: ${vaultResult.reason}`)
    }

    return {
      epicKey,
      retros,
      analyses,
      memoriesUsed: retros.length,
    } satisfies DeepAnalyzeResult
  }).pipe(Effect.withSpan("deep-analyze"))

// ── Layer composition ─────────────────────────────────────────────

export const DeepAnalyzeLive = (root: string) =>
  Layer.mergeAll(
    WALServiceLive,
  ).pipe(
    Layer.provideMerge(OrchestratorLive),
    Layer.provideMerge(ProjectRootLive(root)),
  )
