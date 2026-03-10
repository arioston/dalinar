import { Effect } from "effect"
import { SubprocessService } from "../subprocess.js"
import type { JiraTask } from "../jira-schemas.js"

// ── Types ─────────────────────────────────────────────────────────

export interface CompletedTaskEvidence {
  readonly taskKey: string
  readonly summary: string
  readonly commitLog: string
}

// ── Git log extraction ────────────────────────────────────────────

/**
 * Extract git commit evidence for a completed task.
 * Looks for commits mentioning the task key in messages,
 * or on branches named feat/{task-key}.
 */
export const getCompletedTaskEvidence = (
  task: JiraTask,
  root: string,
): Effect.Effect<CompletedTaskEvidence, never, SubprocessService> =>
  Effect.gen(function* () {
    const subprocess = yield* SubprocessService
    const keyLower = task.key.toLowerCase()

    // Strategy 1: commits mentioning the task key in message (case-insensitive)
    const grepResult = yield* subprocess
      .run("git", {
        args: ["log", "--all", "--oneline", `--grep=${task.key}`, "-i", "-20"],
        cwd: root,
        rawCommand: true,
        nothrow: true,
        timeout: "10 seconds",
      })
      .pipe(Effect.catchAll(() => Effect.succeed({ stdout: "", stderr: "", exitCode: 1, timedOut: false })))

    // Strategy 2: commits on feat/{task-key} branch (if it exists)
    const branchResult = yield* subprocess
      .run("git", {
        args: ["log", `feat/${keyLower}`, "--oneline", "-20", "--not", "main"],
        cwd: root,
        rawCommand: true,
        nothrow: true,
        timeout: "10 seconds",
      })
      .pipe(Effect.catchAll(() => Effect.succeed({ stdout: "", stderr: "", exitCode: 1, timedOut: false })))

    // Merge and deduplicate (by commit hash prefix)
    const seen = new Set<string>()
    const lines: string[] = []

    for (const raw of [grepResult.stdout, branchResult.stdout]) {
      if (!raw) continue
      for (const line of raw.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const hash = trimmed.split(" ")[0]
        if (hash && !seen.has(hash)) {
          seen.add(hash)
          lines.push(trimmed)
        }
      }
    }

    const commitLog = lines.length > 0
      ? lines.join("\n")
      : "(no commits found)"

    return {
      taskKey: task.key,
      summary: task.summary,
      commitLog,
    } satisfies CompletedTaskEvidence
  })

// ── Formatting ────────────────────────────────────────────────────

export function formatEvidenceAsContext(
  evidence: readonly CompletedTaskEvidence[],
): string {
  const meaningful = evidence.filter((e) => e.commitLog !== "(no commits found)")
  if (meaningful.length === 0) return ""

  const lines = ["## Completed Task Evidence (from git history)", ""]
  for (const e of meaningful) {
    lines.push(`### ${e.taskKey}: ${e.summary}`)
    lines.push("```")
    lines.push(e.commitLog)
    lines.push("```")
    lines.push("")
  }
  return lines.join("\n")
}
