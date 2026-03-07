import { Effect } from "effect"
import { JasnahService, SazedService, type ExtractEntry } from "../services.js"
import type { SazedAnalyzeOutput } from "@dalinar/protocol"

// ── Structured note extraction ────────────────────────────────────

const MAX_NOTES = 8

function structuredNotesToEntries(
  output: SazedAnalyzeOutput,
  ctx: { epicKey: string; taskKey?: string | undefined },
): ExtractEntry[] {
  const tags = [ctx.epicKey.toLowerCase()]
  if (ctx.taskKey) tags.push(ctx.taskKey.toLowerCase())

  const entries: ExtractEntry[] = []

  for (const note of output.notes) {
    if (note.content.length < 30) continue
    entries.push({
      type: note.type,
      summary: note.title.slice(0, 100),
      content: note.content.slice(0, 2000),
      tags: [...tags, ...note.tags.slice(0, 2)],
      confidence: "high",
    })
  }

  if (output.contextSummary.length > 50) {
    entries.push({
      type: "architecture",
      summary: `Architecture context for ${ctx.epicKey}`.slice(0, 100),
      content: output.contextSummary.slice(0, 2000),
      tags: [...tags],
      confidence: "medium",
    })
  }

  if (entries.length > MAX_NOTES) {
    entries.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return (order[a.confidence] ?? 2) - (order[b.confidence] ?? 2)
    })
    entries.length = MAX_NOTES
  }

  return entries
}

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

    // Step 3: Run Sazed analysis (returns structured JSON, errors via error channel)
    const result = yield* sazed.analyze({
      epicKey: opts.epicKey,
      context: contextBlock,
      ...(opts.force ? { force: opts.force } : {}),
      ...(opts.notes ? { notes: opts.notes } : {}),
      ...(opts.noMap ? { noMap: opts.noMap } : {}),
      ...(opts.noCache ? { noCache: opts.noCache } : {}),
      ...(opts.forensics ? { forensics: opts.forensics } : {}),
    })

    // Step 4: Extract notes back to Jasnah (structured data, no regex parsing)
    const epicKey = opts.epicKey
    const taskKey = opts.taskKey
    const newNotes = structuredNotesToEntries(result, { epicKey, taskKey })

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
