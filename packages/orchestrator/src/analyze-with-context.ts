#!/usr/bin/env bun
/**
 * analyze-with-context — The core Dalinar pipeline.
 *
 * 1. Search Jasnah memories for prior context related to the epic
 * 2. Run Sazed analysis with that context injected
 * 3. Extract new domain knowledge back to Jasnah
 *
 * Usage:
 *   bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123
 *   bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123 --force --notes
 */

import { searchContextForEpic, extractMemories, formatContextForPrompt, type ExtractEntry } from "./jasnah.js"
import { analyze, type AnalyzeOptions } from "./sazed.js"

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv: string[]): AnalyzeOptions & { root?: string } {
  const args = argv.slice(2)
  const epicKey = args.find((a) => !a.startsWith("--"))
  if (!epicKey) {
    console.error("Usage: analyze-with-context <EPIC-KEY> [--force] [--notes] [--no-map] [--no-cache] [--forensics]")
    process.exit(1)
  }

  return {
    epicKey,
    force: args.includes("--force"),
    notes: args.includes("--notes"),
    noMap: args.includes("--no-map"),
    noCache: args.includes("--no-cache"),
    forensics: args.includes("--forensics"),
    root: process.cwd(),
  }
}

// ── Extract notes from analysis markdown ──────────────────────────

/**
 * Parse the Sazed analysis output to extract potential domain knowledge
 * entries that should be fed back into Jasnah.
 *
 * Looks for patterns like:
 * - Technical definitions and constraints
 * - Architecture decisions made during analysis
 * - API contracts discovered
 */
function extractNotesFromAnalysis(markdown: string, epicKey: string): ExtractEntry[] {
  const entries: ExtractEntry[] = []

  // Extract the context summary as an architecture note
  const contextMatch = markdown.match(/## Context Summary\n([\s\S]*?)(?=\n## |\n---|\Z)/)
  if (contextMatch && contextMatch[1].trim().length > 50) {
    entries.push({
      type: "architecture",
      summary: `Architecture context for ${epicKey}`,
      content: contextMatch[1].trim().slice(0, 500),
      tags: [epicKey.toLowerCase(), "epic-analysis"],
      confidence: "medium",
    })
  }

  // Extract communication flows as api-contract notes
  const commMatch = markdown.match(/## Communication Flow\n([\s\S]*?)(?=\n## |\n---|\Z)/)
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

// ── Main pipeline ─────────────────────────────────────────────────

export async function analyzeWithContext(opts: AnalyzeOptions & { root?: string }): Promise<void> {
  const { epicKey, root } = opts

  console.log(`\n[dalinar] Analyzing ${epicKey} with context...\n`)

  // Step 1: Search Jasnah for prior context
  console.log("[dalinar] Step 1: Searching Jasnah for prior context...")
  const memories = await searchContextForEpic(epicKey, root)

  if (memories.length > 0) {
    console.log(`[dalinar]   Found ${memories.length} relevant memories`)
    const contextBlock = formatContextForPrompt(memories)

    // Inject context via environment variable for Sazed to pick up
    // Sazed's LLM prompt can read DALINAR_CONTEXT if available
    process.env.DALINAR_CONTEXT = contextBlock
  } else {
    console.log("[dalinar]   No prior context found (clean slate)")
  }

  // Step 2: Run Sazed analysis
  console.log(`[dalinar] Step 2: Running Sazed analysis for ${epicKey}...`)
  const result = await analyze(opts)

  if (!result.success) {
    console.error(`[dalinar] Analysis failed:\n${result.markdown}`)
    process.exit(1)
  }

  console.log(`[dalinar]   Analysis complete (${result.markdown.length} chars)`)

  // Step 3: Extract new domain knowledge back to Jasnah
  console.log("[dalinar] Step 3: Extracting domain knowledge back to Jasnah...")
  const newNotes = extractNotesFromAnalysis(result.markdown, epicKey)

  if (newNotes.length > 0) {
    const extraction = await extractMemories(newNotes, {
      root,
      source: `dalinar-analyze-${epicKey}`,
    })
    if (extraction.success) {
      console.log(`[dalinar]   Extracted ${newNotes.length} notes back to Jasnah`)
    } else {
      console.warn(`[dalinar]   Extraction failed: ${extraction.output}`)
    }
  } else {
    console.log("[dalinar]   No new notes to extract")
  }

  // Output the analysis
  console.log("\n" + "=".repeat(60))
  console.log(result.markdown)
  console.log("=".repeat(60))
  console.log(`\n[dalinar] Done. ${epicKey} analyzed with ${memories.length} prior context entries.`)
}

// ── Run ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const opts = parseArgs(process.argv)
  await analyzeWithContext(opts)
}
