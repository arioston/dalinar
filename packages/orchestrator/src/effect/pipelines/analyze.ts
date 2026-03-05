import { Effect } from "effect"
import { JasnahService, SazedService, type AnalyzeOptions } from "../services.js"
import { SazedError } from "../errors.js"
import { vaultSyncPipeline } from "./vault-sync.js"
import { extractNotesFromAnalysis } from "../../extract-notes.js"
import { resolveKey } from "../../resolve-key.js"

// ── Effect pipeline ────────────────────────────────────────────────

export const analyzeWithContextPipeline = (
  opts: AnalyzeOptions & { root?: string },
) =>
  Effect.gen(function* () {
    const jasnah = yield* JasnahService
    const sazed = yield* SazedService

    // Stage 0: Resolve key (task → parent epic)
    const resolved = yield* Effect.tryPromise({
      try: () => resolveKey(opts.epicKey),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null))

    const epicKey = resolved?.epicKey ?? opts.epicKey
    const taskKey = resolved?.taskKey

    if (taskKey) {
      yield* Effect.log(`Resolved task ${taskKey} (${resolved?.issueType}) → epic ${epicKey}`)
    }

    yield* Effect.log(`Analyzing ${epicKey} with context...`)

    // Stage 1: Search Jasnah for prior context
    yield* Effect.log("Step 1: Searching Jasnah for prior context...")
    const memories = yield* jasnah.searchContextForEpic(epicKey, opts.root)

    // If task resolved, also search for task-specific context
    if (resolved?.taskSummary) {
      const taskMemories = yield* jasnah.searchContextForEpic(
        resolved.taskSummary,
        opts.root,
      )
      const seen = new Set(memories.map((m) => m.memory_id))
      for (const m of taskMemories) {
        if (!seen.has(m.memory_id)) {
          ;(memories as any[]).push(m)
          seen.add(m.memory_id)
        }
      }
    }

    // Cap at 10 results after merge
    const capped = [...memories]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)

    if (capped.length > 0) {
      yield* Effect.log(`  Found ${capped.length} relevant memories`)
      const contextBlock = yield* jasnah.formatContextForPrompt(capped)
      yield* Effect.sync(() => {
        process.env.DALINAR_CONTEXT = contextBlock
      })
    } else {
      yield* Effect.log("  No prior context found (clean slate)")
    }

    // Stage 2: Run Sazed analysis
    yield* Effect.log(`Step 2: Running Sazed analysis for ${epicKey}...`)
    const result = yield* sazed.analyze({ ...opts, epicKey })

    if (!result.success) {
      return yield* new SazedError({
        message: `Analysis failed:\n${result.markdown}`,
        epicKey,
      })
    }

    yield* Effect.log(`  Analysis complete (${result.markdown.length} chars)`)

    // Stage 3: Extract new domain knowledge back to Jasnah
    yield* Effect.log("Step 3: Extracting domain knowledge back to Jasnah...")
    const newNotes = extractNotesFromAnalysis(result.markdown, {
      epicKey,
      taskKey,
    })

    const source = taskKey
      ? `dalinar-analyze-${epicKey}-task-${taskKey}`
      : `dalinar-analyze-${epicKey}`

    if (newNotes.length > 0) {
      const extraction = yield* jasnah.extractMemories(newNotes, {
        root: opts.root,
        source,
      })
      if (extraction.success) {
        yield* Effect.log(
          `  Extracted ${newNotes.length} notes back to Jasnah`,
        )
      } else {
        yield* Effect.logWarning(
          `  Extraction failed: ${extraction.output}`,
        )
      }
    } else {
      yield* Effect.log("  No new notes to extract")
    }

    // Stage 4: Vault sync
    yield* Effect.log("Step 4: Vault sync...")
    const vaultResult = yield* vaultSyncPipeline(opts.root)
    if (vaultResult.synced) {
      yield* Effect.log(`  Synced to ${vaultResult.target}`)
    } else {
      yield* Effect.log(`  Skipped: ${vaultResult.reason}`)
    }

    // Output the analysis
    yield* Effect.log("\n" + "=".repeat(60))
    yield* Effect.log(result.markdown)
    yield* Effect.log("=".repeat(60))
    yield* Effect.log(
      `Done. ${epicKey} analyzed with ${capped.length} prior context entries.`,
    )

    return { markdown: result.markdown, memoriesUsed: capped.length }
  }).pipe(Effect.withSpan("analyze-with-context"))
