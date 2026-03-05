/**
 * Shared knowledge extraction from Sazed analysis markdown.
 *
 * Pure function (string in, array out) — used by both the imperative
 * and Effect pipelines. Extracts domain notes, architecture context,
 * API contracts, acceptance criteria, and integration points.
 */

import type { ExtractEntry } from "./jasnah.js"

const MAX_NOTES = 8

export interface ExtractionContext {
  epicKey: string
  taskKey?: string | undefined
}

/** Truncate at the last newline boundary before the limit. */
function truncateAtBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text
  const truncated = text.slice(0, limit)
  const lastNewline = truncated.lastIndexOf("\n")
  return lastNewline > limit * 0.5 ? truncated.slice(0, lastNewline) : truncated
}

function baseTags(ctx: ExtractionContext): string[] {
  const tags = [ctx.epicKey.toLowerCase()]
  if (ctx.taskKey) tags.push(ctx.taskKey.toLowerCase())
  return tags
}

export function extractNotesFromAnalysis(
  markdown: string,
  ctx: ExtractionContext,
): ExtractEntry[] {
  const entries: ExtractEntry[] = []
  const tags = baseTags(ctx)

  // Rule 1: Domain Notes (highest value — already typed/tagged by Sazed)
  const domainNotesSection = markdown.match(
    /## Domain Notes\n[\s\S]*?(?=\n## [A-Z]|\s*$)/,
  )
  if (domainNotesSection) {
    const notePattern =
      /### (.+)\n\n- \*\*Type\*\*: (\S+)\n- \*\*Tags\*\*: (.+)\n(?:- \*\*Related\*\*: .+\n)?\n([\s\S]*?)(?=\n### |\s*$)/g
    let match: RegExpExecArray | null
    while ((match = notePattern.exec(domainNotesSection[0])) !== null) {
      const [, title, type, noteTags, content] = match
      const trimmed = content.trim()
      if (trimmed.length < 30) continue

      const sazedTags = noteTags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
        .slice(0, 2) // max 2 Sazed tags

      entries.push({
        type,
        summary: title.slice(0, 100),
        content: truncateAtBoundary(trimmed, 2000),
        tags: [...tags, ...sazedTags],
        confidence: "high",
      })
    }
  }

  // Rule 2: Context Summary → architecture
  const contextMatch = markdown.match(
    /## Context Summary\n\n?([\s\S]*?)(?=\n## )/,
  )
  if (contextMatch && contextMatch[1].trim().length > 50) {
    entries.push({
      type: "architecture",
      summary: `Architecture context for ${ctx.epicKey}`.slice(0, 100),
      content: truncateAtBoundary(contextMatch[1].trim(), 2000),
      tags: [...tags],
      confidence: "medium",
    })
  }

  // Rule 3: Communication Flow → api-contract (fixed \Z bug)
  const commMatch = markdown.match(
    /## Communication Flow\n\n?([\s\S]*?)(?=\n## [A-Z]|\s*$)/,
  )
  if (commMatch && commMatch[1].trim().length > 50) {
    entries.push({
      type: "api-contract",
      summary: `Integration points for ${ctx.epicKey}`.slice(0, 100),
      content: truncateAtBoundary(commMatch[1].trim(), 2000),
      tags: [...tags, "integration"],
      confidence: "medium",
    })
  }

  // Rule 4: Acceptance Criteria grouped by task → domain-fact
  const taskPattern =
    /### Task \d+: (.+)\n[\s\S]*?\*\*Acceptance Criteria\*\*:\n\n?((?:- .+\n)+)/g
  let taskMatch: RegExpExecArray | null
  while ((taskMatch = taskPattern.exec(markdown)) !== null) {
    const [, taskTitle, criteria] = taskMatch
    const trimmed = criteria.trim()
    if (trimmed.length < 30) continue
    entries.push({
      type: "domain-fact",
      summary: `Acceptance criteria: ${taskTitle}`.slice(0, 100),
      content: truncateAtBoundary(trimmed, 2000),
      tags: [...tags, "acceptance-criteria"],
      confidence: "medium",
    })
  }

  // Rule 5: Integration Points (consolidated) → architecture
  const ipPattern = /\*\*Integration points\*\*:\n((?:- .+\n)+)/g
  let ipMatch: RegExpExecArray | null
  const allIPs: string[] = []
  while ((ipMatch = ipPattern.exec(markdown)) !== null) {
    allIPs.push(ipMatch[1].trim())
  }
  if (allIPs.length > 0) {
    const combined = allIPs.join("\n")
    entries.push({
      type: "architecture",
      summary: `Integration points for ${ctx.epicKey} tasks`.slice(0, 100),
      content: truncateAtBoundary(combined, 1500),
      tags: [...tags, "integration-points"],
      confidence: "medium",
    })
  }

  // Budget: cap at MAX_NOTES, prioritizing high confidence first
  if (entries.length > MAX_NOTES) {
    entries.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return (order[a.confidence] ?? 2) - (order[b.confidence] ?? 2)
    })
    entries.length = MAX_NOTES
  }

  return entries
}
