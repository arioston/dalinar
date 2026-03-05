#!/usr/bin/env bun
/**
 * analyze-with-context — The core Dalinar pipeline.
 *
 * 1. Resolve key (task → parent epic if needed)
 * 2. Search Jasnah memories for prior context related to the epic
 * 3. Run Sazed analysis with that context injected
 * 4. Extract new domain knowledge back to Jasnah
 *
 * Usage:
 *   bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123
 *   bun run packages/orchestrator/src/analyze-with-context.ts PROJ-456  # task key — resolves to parent epic
 *   bun run packages/orchestrator/src/analyze-with-context.ts EPIC-123 --force --notes
 */

import { searchContextForEpic, extractMemories, formatContextForPrompt, type MemorySearchResult } from "./jasnah.js"
import { analyze, type AnalyzeOptions } from "./sazed.js"
import { syncToVault } from "./vault-sync.js"
import { extractNotesFromAnalysis } from "./extract-notes.js"
import { resolveKey } from "./resolve-key.js"

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv: string[]): AnalyzeOptions & { root?: string } {
  const args = argv.slice(2)
  const epicKey = args.find((a) => !a.startsWith("--"))
  if (!epicKey) {
    console.error("Usage: analyze-with-context <KEY> [--force] [--notes] [--no-map] [--no-cache] [--forensics]")
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

// ── Main pipeline ─────────────────────────────────────────────────

export async function analyzeWithContext(opts: AnalyzeOptions & { root?: string }): Promise<void> {
  const { root } = opts
  let epicKey = opts.epicKey
  let taskKey: string | undefined

  // Step 0: Resolve key (task → parent epic)
  const resolved = await resolveKey(epicKey)
  if (resolved) {
    epicKey = resolved.epicKey
    taskKey = resolved.taskKey
    if (taskKey) {
      console.log(`[dalinar] Resolved task ${taskKey} (${resolved.issueType}) → epic ${epicKey}`)
    }
  }

  console.log(`\n[dalinar] Analyzing ${epicKey} with context...\n`)

  // Step 1: Search Jasnah for prior context
  console.log("[dalinar] Step 1: Searching Jasnah for prior context...")
  const memories = await searchContextForEpic(epicKey, root)

  // If task resolved, also search for task-specific context
  if (resolved?.taskSummary) {
    const taskMemories = await searchContextForEpic(resolved.taskSummary, root)
    const seen = new Set(memories.map((m) => m.memory_id))
    for (const m of taskMemories) {
      if (!seen.has(m.memory_id)) {
        memories.push(m)
        seen.add(m.memory_id)
      }
    }
  }

  // Cap at 10 results after merge
  memories.sort((a: MemorySearchResult, b: MemorySearchResult) => b.score - a.score)
  if (memories.length > 10) memories.length = 10

  if (memories.length > 0) {
    console.log(`[dalinar]   Found ${memories.length} relevant memories`)
    const contextBlock = formatContextForPrompt(memories)
    process.env.DALINAR_CONTEXT = contextBlock
  } else {
    console.log("[dalinar]   No prior context found (clean slate)")
  }

  // Step 2: Run Sazed analysis
  console.log(`[dalinar] Step 2: Running Sazed analysis for ${epicKey}...`)
  const result = await analyze({ ...opts, epicKey })

  if (!result.success) {
    console.error(`[dalinar] Analysis failed:\n${result.markdown}`)
    process.exit(1)
  }

  console.log(`[dalinar]   Analysis complete (${result.markdown.length} chars)`)

  // Step 3: Extract new domain knowledge back to Jasnah
  console.log("[dalinar] Step 3: Extracting domain knowledge back to Jasnah...")
  const newNotes = extractNotesFromAnalysis(result.markdown, { epicKey, taskKey })

  const source = taskKey
    ? `dalinar-analyze-${epicKey}-task-${taskKey}`
    : `dalinar-analyze-${epicKey}`

  if (newNotes.length > 0) {
    const extraction = await extractMemories(newNotes, { root, source })
    if (extraction.success) {
      console.log(`[dalinar]   Extracted ${newNotes.length} notes back to Jasnah`)
    } else {
      console.warn(`[dalinar]   Extraction failed: ${extraction.output}`)
    }
  } else {
    console.log("[dalinar]   No new notes to extract")
  }

  // Step 4: Sync .memory/ to Obsidian vault (opt-in)
  console.log("[dalinar] Step 4: Vault sync...")
  const vaultResult = await syncToVault(root)
  if (vaultResult.synced) {
    console.log(`[dalinar]   Synced to ${vaultResult.target}`)
  } else {
    console.log(`[dalinar]   Skipped: ${vaultResult.reason}`)
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

  try {
    const { Effect } = await import("effect")
    const { analyzeWithContextPipeline } = await import("./effect/pipelines/analyze.js")
    const { OrchestratorLive } = await import("./effect/runtime.js")
    await Effect.runPromise(
      analyzeWithContextPipeline(opts).pipe(Effect.provide(OrchestratorLive)),
    )
  } catch {
    await analyzeWithContext(opts)
  }
}
