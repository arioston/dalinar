import { Effect } from "effect"
import { JasnahService, type ExtractEntry } from "../services.js"
import type {
  SprintReflection,
  EstimateCorrection,
  BlockerEntry,
  WinEntry,
  DecisionRevision,
} from "../types/reflect.js"

// Re-export types for convenience
export type { SprintReflection, EstimateCorrection, BlockerEntry, WinEntry, DecisionRevision }

export interface ReflectOptions {
  dryRun?: boolean
  root?: string
}

export interface ReflectResult {
  entries: ExtractEntry[]
  extractResult?: { success: boolean; output: string }
}

// ── Pure conversion (stays pure, no Effect wrapper needed) ─────────

export function reflectionToMemories(reflection: SprintReflection): ExtractEntry[] {
  const entries: ExtractEntry[] = []
  const sprintTag = reflection.sprint.toLowerCase().replace(/\s+/g, "-")

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

  if (reflection.epicKeys) {
    const epicTags = reflection.epicKeys.map((k) => k.toLowerCase())
    for (const entry of entries) {
      entry.tags.push(...epicTags)
    }
  }

  return entries
}

// ── Effect pipeline ────────────────────────────────────────────────

export const reflectPipeline = (
  reflection: SprintReflection,
  opts: ReflectOptions = {},
) =>
  Effect.gen(function* () {
    const jasnah = yield* JasnahService

    // Stage 1: Convert reflection to memory entries
    yield* Effect.log(`Processing retrospective for ${reflection.sprint}...`)
    const entries = reflectionToMemories(reflection)

    if (entries.length === 0) {
      yield* Effect.log("No actionable entries from reflection.")
      return { entries } satisfies ReflectResult
    }

    yield* Effect.log(`Generated ${entries.length} memory entries:`)
    for (const entry of entries) {
      yield* Effect.log(`  [${entry.type}] ${entry.summary}`)
    }

    // Stage 2: Extract to Jasnah (unless dry run)
    if (opts.dryRun) {
      yield* Effect.log("Dry run — not extracting.")
      return { entries } satisfies ReflectResult
    }

    yield* Effect.log(`Extracting ${entries.length} entries to Jasnah...`)
    const extractResult = yield* jasnah.extractMemories(entries, {
      root: opts.root,
      source: `sprint-retro:${reflection.sprint}`,
    })

    if (extractResult.success) {
      yield* Effect.log(`Done. ${entries.length} reflections saved.`)
    } else {
      yield* Effect.logWarning(`Extraction failed: ${extractResult.output}`)
    }

    return { entries, extractResult } satisfies ReflectResult
  }).pipe(Effect.withSpan("reflect"))
