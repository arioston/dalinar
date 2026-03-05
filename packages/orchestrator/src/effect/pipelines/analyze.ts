import { Effect } from "effect"
import { JasnahService, SazedService, type AnalyzeOptions, type ExtractEntry } from "../services.js"
import { SazedError } from "../errors.js"
import { vaultSyncPipeline } from "./vault-sync.js"

function extractNotesFromAnalysis(
  markdown: string,
  epicKey: string,
): ExtractEntry[] {
  const entries: ExtractEntry[] = []

  const contextMatch = markdown.match(
    /## Context Summary\n([\s\S]*?)(?=\n## |\n---|\Z)/,
  )
  if (contextMatch && contextMatch[1].trim().length > 50) {
    entries.push({
      type: "architecture",
      summary: `Architecture context for ${epicKey}`,
      content: contextMatch[1].trim().slice(0, 500),
      tags: [epicKey.toLowerCase(), "epic-analysis"],
      confidence: "medium",
    })
  }

  const commMatch = markdown.match(
    /## Communication Flow\n([\s\S]*?)(?=\n## |\n---|\Z)/,
  )
  if (commMatch && commMatch[1].trim().length > 50) {
    entries.push({
      type: "api-contract",
      summary: `Integration points for ${epicKey}`,
      content: commMatch[1].trim().slice(0, 500),
      tags: [epicKey.toLowerCase(), "integration"],
      confidence: "medium",
    })
  }

  return entries
}

// ── Effect pipeline ────────────────────────────────────────────────

export const analyzeWithContextPipeline = (
  opts: AnalyzeOptions & { root?: string },
) =>
  Effect.gen(function* () {
    const jasnah = yield* JasnahService
    const sazed = yield* SazedService

    const { epicKey, root } = opts

    yield* Effect.log(`Analyzing ${epicKey} with context...`)

    // Stage 1: Search Jasnah for prior context
    yield* Effect.log("Step 1: Searching Jasnah for prior context...")
    const memories = yield* jasnah.searchContextForEpic(epicKey, root)

    if (memories.length > 0) {
      yield* Effect.log(`  Found ${memories.length} relevant memories`)
      const contextBlock = yield* jasnah.formatContextForPrompt(memories)
      // Inject context for Sazed subprocess
      yield* Effect.sync(() => {
        process.env.DALINAR_CONTEXT = contextBlock
      })
    } else {
      yield* Effect.log("  No prior context found (clean slate)")
    }

    // Stage 2: Run Sazed analysis
    yield* Effect.log(`Step 2: Running Sazed analysis for ${epicKey}...`)
    const result = yield* sazed.analyze(opts)

    if (!result.success) {
      return yield* new SazedError({
        message: `Analysis failed:\n${result.markdown}`,
        epicKey,
      })
    }

    yield* Effect.log(`  Analysis complete (${result.markdown.length} chars)`)

    // Stage 3: Extract new domain knowledge back to Jasnah
    yield* Effect.log("Step 3: Extracting domain knowledge back to Jasnah...")
    const newNotes = extractNotesFromAnalysis(result.markdown, epicKey)

    if (newNotes.length > 0) {
      const extraction = yield* jasnah.extractMemories(newNotes, {
        root,
        source: `dalinar-analyze-${epicKey}`,
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
    const vaultResult = yield* vaultSyncPipeline(root)
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
      `Done. ${epicKey} analyzed with ${memories.length} prior context entries.`,
    )

    return { markdown: result.markdown, memoriesUsed: memories.length }
  }).pipe(Effect.withSpan("analyze-with-context"))
