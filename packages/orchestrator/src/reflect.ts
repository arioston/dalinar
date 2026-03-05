#!/usr/bin/env bun
/**
 * reflect — Post-sprint retrospective capture.
 *
 * Captures corrections and learnings after a sprint when actuals are known:
 * - What tasks took longer than estimated?
 * - What blockers appeared that weren't anticipated?
 * - What went well that should be repeated?
 * - What decisions need revisiting?
 *
 * Feeds corrections back as lesson-learned entries via Jasnah,
 * creating a feedback loop that improves future analyses.
 *
 * Usage:
 *   bun run packages/orchestrator/src/reflect.ts --sprint sprint-42
 *   bun run packages/orchestrator/src/reflect.ts --sprint sprint-42 --dry-run
 *   echo '<json>' | bun run packages/orchestrator/src/reflect.ts --sprint sprint-42
 */

import { extractMemories, type ExtractEntry } from "./jasnah.js"

// ── Types ─────────────────────────────────────────────────────────

export interface SprintReflection {
  sprint: string
  epicKeys?: string[]
  estimateAccuracy?: EstimateCorrection[]
  blockers?: BlockerEntry[]
  wins?: WinEntry[]
  revisions?: DecisionRevision[]
}

export interface EstimateCorrection {
  taskDescription: string
  estimatedEffort: string
  actualEffort: string
  reason: string
}

export interface BlockerEntry {
  description: string
  impact: string
  wasAnticipated: boolean
}

export interface WinEntry {
  description: string
  replicable: boolean
}

export interface DecisionRevision {
  originalDecision: string
  revision: string
  reason: string
}

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv: string[]): { sprint: string; dryRun: boolean; root: string } {
  const args = argv.slice(2)

  const sprintIdx = args.indexOf("--sprint")
  const sprint = sprintIdx !== -1 ? args[sprintIdx + 1] : undefined

  if (!sprint) {
    console.error("Usage: reflect --sprint <sprint-name> [--dry-run]")
    console.error("")
    console.error("Input: pipe JSON reflection data to stdin, or run interactively")
    console.error("")
    console.error("JSON format:")
    console.error(JSON.stringify({
      sprint: "sprint-42",
      estimateAccuracy: [{ taskDescription: "...", estimatedEffort: "2d", actualEffort: "5d", reason: "..." }],
      blockers: [{ description: "...", impact: "...", wasAnticipated: false }],
      wins: [{ description: "...", replicable: true }],
      revisions: [{ originalDecision: "...", revision: "...", reason: "..." }],
    }, null, 2))
    process.exit(1)
  }

  return {
    sprint,
    dryRun: args.includes("--dry-run"),
    root: process.cwd(),
  }
}

// ── Reflection to memories ────────────────────────────────────────

export function reflectionToMemories(reflection: SprintReflection): ExtractEntry[] {
  const entries: ExtractEntry[] = []
  const sprintTag = reflection.sprint.toLowerCase().replace(/\s+/g, "-")

  // Estimate corrections → lesson-learned
  if (reflection.estimateAccuracy) {
    for (const correction of reflection.estimateAccuracy) {
      entries.push({
        type: "lesson-learned",
        summary: `Estimate drift: ${correction.taskDescription}`.slice(0, 100),
        content: `Estimated ${correction.estimatedEffort}, actual ${correction.actualEffort}. Reason: ${correction.reason}`.slice(0, 500),
        tags: [sprintTag, "estimation", "estimate-drift"],
        confidence: "high",
      })
    }
  }

  // Unanticipated blockers → lesson-learned
  if (reflection.blockers) {
    for (const blocker of reflection.blockers) {
      if (!blocker.wasAnticipated) {
        entries.push({
          type: "lesson-learned",
          summary: `Unanticipated blocker: ${blocker.description}`.slice(0, 100),
          content: `Blocker: ${blocker.description}. Impact: ${blocker.impact}. This was not anticipated in the original analysis and should be watched for in future sprints.`.slice(0, 500),
          tags: [sprintTag, "blocker"],
          confidence: "high",
        })
      }
    }
  }

  // Replicable wins → domain-fact (positive knowledge)
  if (reflection.wins) {
    for (const win of reflection.wins) {
      if (win.replicable) {
        entries.push({
          type: "domain-fact",
          summary: `Best practice: ${win.description}`.slice(0, 100),
          content: `This approach worked well in ${reflection.sprint} and is replicable: ${win.description}`.slice(0, 500),
          tags: [sprintTag, "best-practice"],
          confidence: "medium",
        })
      }
    }
  }

  // Decision revisions → architecture (superseding previous decisions)
  if (reflection.revisions) {
    for (const rev of reflection.revisions) {
      entries.push({
        type: "architecture",
        summary: `Decision revised: ${rev.originalDecision}`.slice(0, 100),
        content: `Original: ${rev.originalDecision}. Revised to: ${rev.revision}. Reason: ${rev.reason}`.slice(0, 500),
        tags: [sprintTag, "decision-revision"],
        confidence: "high",
      })
    }
  }

  // Add epic key tags if present
  if (reflection.epicKeys) {
    const epicTags = reflection.epicKeys.map((k) => k.toLowerCase())
    for (const entry of entries) {
      entry.tags.push(...epicTags)
    }
  }

  return entries
}

// ── Main pipeline ─────────────────────────────────────────────────

export async function runReflection(
  reflection: SprintReflection,
  opts: { dryRun?: boolean; root?: string } = {},
): Promise<{ entries: ExtractEntry[]; extractResult?: { success: boolean; output: string } }> {
  console.log(`\n[dalinar] Processing retrospective for ${reflection.sprint}...\n`)

  const entries = reflectionToMemories(reflection)

  if (entries.length === 0) {
    console.log("[dalinar] No actionable entries from reflection.")
    return { entries }
  }

  console.log(`[dalinar] Generated ${entries.length} memory entries:`)
  for (const entry of entries) {
    console.log(`  [${entry.type}] ${entry.summary}`)
  }

  if (opts.dryRun) {
    console.log("\n[dalinar] Dry run — not extracting.")
    return { entries }
  }

  console.log(`\n[dalinar] Extracting ${entries.length} entries to Jasnah...`)
  const extractResult = await extractMemories(entries, {
    root: opts.root,
    source: `sprint-retro:${reflection.sprint}`,
  })

  if (extractResult.success) {
    console.log(`[dalinar] Done. ${entries.length} reflections saved.`)
  } else {
    console.warn(`[dalinar] Extraction failed: ${extractResult.output}`)
  }

  return { entries, extractResult }
}

// ── Run ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const opts = parseArgs(process.argv)

  // Try to read JSON from stdin
  let reflection: SprintReflection

  const stdinText = await Bun.stdin.text()
  if (stdinText.trim()) {
    try {
      const parsed = JSON.parse(stdinText.trim())
      reflection = { sprint: opts.sprint, ...parsed }
    } catch {
      console.error("[dalinar] Failed to parse stdin as JSON")
      process.exit(1)
    }
  } else {
    // Interactive mode: output template for the user/agent to fill
    console.log("[dalinar] No stdin input. Provide reflection data as JSON via stdin.")
    console.log("")
    console.log("Example:")
    console.log(`echo '${JSON.stringify({
      estimateAccuracy: [{ taskDescription: "DB migration", estimatedEffort: "2d", actualEffort: "5d", reason: "Cascade updates in dependent services" }],
      blockers: [{ description: "Auth service rate limiting", impact: "Delayed integration testing by 1 day", wasAnticipated: false }],
      wins: [{ description: "Using worktrees for parallel feature work", replicable: true }],
    })}' | bun run packages/orchestrator/src/reflect.ts --sprint ${opts.sprint}`)
    process.exit(0)
  }

  // Use Effect pipeline with fallback to original
  try {
    const { Effect } = await import("effect")
    const { reflectPipeline } = await import("./effect/pipelines/reflect.js")
    const { OrchestratorLive } = await import("./effect/runtime.js")
    const result = await Effect.runPromise(
      reflectPipeline(reflection, { dryRun: opts.dryRun, root: opts.root }).pipe(
        Effect.provide(OrchestratorLive),
      ),
    )
    // Pipeline handles logging internally
    void result
  } catch {
    // Fallback to original implementation if Effect not available
    await runReflection(reflection, { dryRun: opts.dryRun, root: opts.root })
  }
}
