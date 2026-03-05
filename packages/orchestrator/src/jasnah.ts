/**
 * Jasnah integration for the Dalinar orchestrator.
 *
 * Provides programmatic access to Jasnah's memory search and extraction.
 * Uses the Jasnah workspace package when available, falls back to subprocess.
 */

import { $ } from "bun"
import { resolve } from "path"

// ── Types ─────────────────────────────────────────────────────────

export interface MemorySearchResult {
  memory_id: string
  type: string
  summary: string
  content: string
  tags: string[]
  confidence: string
  score: number
  retention: number
}

export interface SearchOptions {
  query: string
  root?: string | undefined
  type?: string | undefined
  limit?: number | undefined
  tags?: string[] | undefined
}

export interface ExtractEntry {
  type: string
  summary: string
  content: string
  tags: string[]
  confidence: "high" | "medium" | "low"
}

// ── Resolve Jasnah root ───────────────────────────────────────────

function resolveJasnahRoot(): string {
  return process.env.JASNAH_ROOT
    ?? resolve(process.env.XDG_DATA_HOME ?? resolve(process.env.HOME!, ".local/share"), "jasnah")
}

// ── Search ────────────────────────────────────────────────────────

/**
 * Search Jasnah memories via the search-memory script.
 * Returns parsed results or empty array if Qdrant is not configured.
 */
export async function searchMemories(opts: SearchOptions): Promise<MemorySearchResult[]> {
  const jasnahRoot = resolveJasnahRoot()
  const scriptPath = resolve(jasnahRoot, "scripts/search-memory.ts")

  const args: string[] = [opts.query]
  if (opts.type) args.push("--type", opts.type)
  if (opts.limit) args.push("--limit", String(opts.limit))
  if (opts.tags) {
    for (const tag of opts.tags) args.push("--tag", tag)
  }
  if (opts.root) args.push("--root", opts.root)

  const result = await $`bun run ${scriptPath} ${args}`
    .quiet()
    .nothrow()
    .env({ ...process.env })

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    // Qdrant not configured is not an error — just no results
    if (stderr.includes("not configured") || stderr.includes("QDRANT")) {
      return []
    }
    console.warn(`[dalinar] Jasnah search failed: ${stderr}`)
    return []
  }

  // Parse the output — search-memory.ts outputs formatted text
  // We return the raw output as a single "context block" for now
  const stdout = result.stdout.toString().trim()
  if (!stdout) return []

  // Try to parse structured output; fall back to wrapping as single result
  try {
    const parsed = JSON.parse(stdout)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // Output is human-readable text, not JSON
  }

  return [{
    memory_id: "search-context",
    type: "mixed",
    summary: "Prior context from Jasnah memories",
    content: stdout,
    tags: [],
    confidence: "high",
    score: 1.0,
    retention: 1.0,
  }]
}

/**
 * Search memories across multiple types relevant to an epic analysis.
 * Queries architecture, domain-fact, and api-contract types.
 */
export async function searchContextForEpic(
  epicDescription: string,
  root?: string,
): Promise<MemorySearchResult[]> {
  const types = ["architecture", "domain-fact", "api-contract", "lesson-learned"]
  const results = await Promise.all(
    types.map((type) =>
      searchMemories({ query: epicDescription, type, limit: 5, root })
    ),
  )
  // Flatten and deduplicate by memory_id
  const seen = new Set<string>()
  const merged: MemorySearchResult[] = []
  for (const batch of results) {
    for (const r of batch) {
      if (!seen.has(r.memory_id)) {
        seen.add(r.memory_id)
        merged.push(r)
      }
    }
  }
  // Sort by score descending
  merged.sort((a, b) => b.score - a.score)
  return merged
}

// ── Extract ───────────────────────────────────────────────────────

/**
 * Extract memories by piping entries to Jasnah's extract-inline script.
 */
export async function extractMemories(
  entries: ExtractEntry[],
  opts: { root?: string | undefined; source?: string | undefined; dryRun?: boolean | undefined } = {},
): Promise<{ success: boolean; output: string }> {
  if (entries.length === 0) return { success: true, output: "No entries to extract" }

  const jasnahRoot = resolveJasnahRoot()
  const scriptPath = resolve(jasnahRoot, "scripts/extract-inline.ts")

  const args: string[] = []
  if (opts.root) args.push("--root", opts.root)
  if (opts.source) args.push("--source", opts.source)
  if (opts.dryRun) args.push("--dry-run")

  const json = JSON.stringify(entries)
  const result = await $`echo ${json} | bun run ${scriptPath} ${args}`
    .quiet()
    .nothrow()
    .env({ ...process.env })

  const stdout = result.stdout.toString().trim()
  const stderr = result.stderr.toString().trim()

  if (result.exitCode !== 0) {
    console.warn(`[dalinar] Memory extraction failed: ${stderr}`)
    return { success: false, output: stderr }
  }

  return { success: true, output: stdout || stderr }
}

/**
 * Format search results as context for injection into an LLM prompt.
 */
export function formatContextForPrompt(results: MemorySearchResult[]): string {
  if (results.length === 0) return ""

  const lines = ["## Prior Context (from Jasnah memory)", ""]
  for (const r of results) {
    lines.push(`### [${r.type}] ${r.summary}`)
    lines.push(r.content)
    if (r.tags.length > 0) lines.push(`Tags: ${r.tags.join(", ")}`)
    lines.push("")
  }
  return lines.join("\n")
}
