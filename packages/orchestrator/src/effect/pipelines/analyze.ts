import { Effect, Option } from "effect"
import { FileSystem } from "@effect/platform"
import { resolve } from "path"
import { type AnalyzeOptions } from "../services.js"
import { FileOperationError } from "../errors.js"
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

    yield* Effect.logInfo("Starting analysis with context")

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
      const outPath = resolve(outDir, `${epicKey}-analysis.md`)
      yield* fs.makeDirectory(outDir, { recursive: true }).pipe(
        Effect.flatMap(() => fs.writeFileString(outPath, result.markdown)),
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
