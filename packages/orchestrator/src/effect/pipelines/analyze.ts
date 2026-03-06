import { Effect, Option } from "effect"
import { type AnalyzeOptions } from "../services.js"
import { vaultSyncPipeline } from "./vault-sync.js"
import { analyzeTask } from "./analyze-helper.js"
import { JiraService } from "../services/jira.js"

// ── Effect pipeline ────────────────────────────────────────────────

export const analyzeWithContextPipeline = (
  opts: AnalyzeOptions & { root?: string },
) =>
  Effect.gen(function* () {
    // Stage 0: Resolve key (task → parent epic) — uses JiraService if available
    const jiraOption = yield* Effect.serviceOption(JiraService)

    let epicKey = opts.epicKey
    let taskKey: string | undefined

    if (Option.isSome(jiraOption)) {
      const resolved = yield* jiraOption.value.resolveKey(opts.epicKey).pipe(
        Effect.orElseSucceed(() => null),
      )
      if (resolved) {
        epicKey = resolved.epicKey
        taskKey = resolved.taskKey
        if (taskKey) {
          yield* Effect.log(`Resolved task ${taskKey} (${resolved.issueType}) → epic ${epicKey}`)
        }
      }
    }

    yield* Effect.log(`Analyzing ${epicKey} with context...`)

    // Stages 1-3: Search context → Sazed analysis → Extract notes (via shared helper)
    const result = yield* analyzeTask({
      epicKey,
      taskKey,
      root: opts.root,
      ...(opts.force ? { force: opts.force } : {}),
      ...(opts.notes ? { notes: opts.notes } : {}),
      ...(opts.noMap ? { noMap: opts.noMap } : {}),
      ...(opts.noCache ? { noCache: opts.noCache } : {}),
      ...(opts.forensics ? { forensics: opts.forensics } : {}),
    })

    yield* Effect.log(`Analysis complete (${result.markdown.length} chars, ${result.notesExtracted} notes extracted)`)

    // Stage 4: Vault sync
    yield* Effect.log("Vault sync...")
    const vaultResult = yield* vaultSyncPipeline(opts.root)
    if (vaultResult.synced) {
      yield* Effect.log(`Synced to ${vaultResult.target}`)
    } else {
      yield* Effect.log(`Skipped: ${vaultResult.reason}`)
    }

    // Output the analysis
    yield* Effect.log("\n" + "=".repeat(60))
    yield* Effect.log(result.markdown)
    yield* Effect.log("=".repeat(60))
    yield* Effect.log(
      `Done. ${epicKey} analyzed with ${result.memoriesUsed} prior context entries.`,
    )

    return { markdown: result.markdown, memoriesUsed: result.memoriesUsed }
  }).pipe(Effect.withSpan("analyze-with-context"))
