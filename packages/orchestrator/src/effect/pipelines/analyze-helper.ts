import { Effect } from "effect"
import { JasnahService, SazedService } from "../services.js"
import { SazedError } from "../errors.js"
import { extractNotesFromAnalysis } from "../../extract-notes.js"

// ── Shared analysis helper ────────────────────────────────────────
// Reusable building block for both analyzeWithContextPipeline and
// deepAnalyzePipeline. Handles: Jasnah search → format context →
// Sazed analysis → extract notes back to Jasnah.

export interface AnalyzeTaskOptions {
  readonly epicKey: string
  readonly taskKey?: string | undefined
  /** Extra context (e.g. sibling retrospectives) appended to Jasnah context */
  readonly extraContext?: string | undefined
  readonly root?: string | undefined
  readonly force?: boolean | undefined
  readonly notes?: boolean | undefined
  readonly noMap?: boolean | undefined
  readonly noCache?: boolean | undefined
  readonly forensics?: boolean | undefined
}

export interface AnalyzeTaskResult {
  readonly markdown: string
  readonly memoriesUsed: number
  readonly notesExtracted: number
}

/**
 * Search Jasnah → format context → run Sazed → extract notes.
 * Does NOT do vault sync or key resolution — those are pipeline concerns.
 */
export const analyzeTask = (opts: AnalyzeTaskOptions) =>
  Effect.gen(function* () {
    const jasnah = yield* JasnahService
    const sazed = yield* SazedService

    // Step 1: Search Jasnah for prior context
    const memories = yield* jasnah.searchContextForEpic(opts.epicKey, opts.root)

    // Cap at 10 results
    const capped = [...memories]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)

    // Step 2: Build context block
    let contextBlock: string | undefined
    if (capped.length > 0) {
      contextBlock = yield* jasnah.formatContextForPrompt(capped)
    }

    // Append extra context (e.g. sibling retros)
    if (opts.extraContext) {
      contextBlock = [contextBlock, opts.extraContext].filter(Boolean).join("\n\n")
    }

    // Step 3: Run Sazed analysis
    const result = yield* sazed.analyze({
      epicKey: opts.epicKey,
      context: contextBlock,
      ...(opts.force ? { force: opts.force } : {}),
      ...(opts.notes ? { notes: opts.notes } : {}),
      ...(opts.noMap ? { noMap: opts.noMap } : {}),
      ...(opts.noCache ? { noCache: opts.noCache } : {}),
      ...(opts.forensics ? { forensics: opts.forensics } : {}),
    })

    if (!result.success) {
      return yield* new SazedError({
        message: `Analysis failed:\n${result.markdown}`,
        epicKey: opts.epicKey,
      })
    }

    // Step 4: Extract notes back to Jasnah
    const epicKey = opts.epicKey
    const taskKey = opts.taskKey
    const newNotes = extractNotesFromAnalysis(result.markdown, { epicKey, taskKey })

    const source = taskKey
      ? `dalinar-analyze-${epicKey}-task-${taskKey}`
      : `dalinar-analyze-${epicKey}`

    let notesExtracted = 0
    if (newNotes.length > 0) {
      const extraction = yield* jasnah.extractMemories(newNotes, {
        root: opts.root,
        source,
      })
      if (extraction.success) {
        notesExtracted = newNotes.length
      } else {
        yield* Effect.logWarning(`Extraction failed: ${extraction.output}`)
      }
    }

    return {
      markdown: result.markdown,
      memoriesUsed: capped.length,
      notesExtracted,
    } satisfies AnalyzeTaskResult
  }).pipe(Effect.withSpan("analyze-task"))
