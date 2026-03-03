#!/usr/bin/env bun
/**
 * audit — Cross-session pattern detection.
 *
 * Scans the memory store for recurring patterns across sessions and epics:
 * 1. Load all memories from .memory/ (or query Qdrant)
 * 2. Cluster related entries by tags, types, and content similarity
 * 3. Detect patterns:
 *    - Recurring blockers (tags that co-occur with lesson-learned entries)
 *    - Estimate drift (Sazed analysis vs actual outcomes)
 *    - Decision oscillation (superseded architecture decisions)
 *    - Knowledge gaps (codebase areas with no architecture/api-contract notes)
 * 4. Surface meta-insights as new lesson-learned entries
 * 5. Report findings to user
 *
 * Usage:
 *   bun run packages/orchestrator/src/audit.ts
 *   bun run packages/orchestrator/src/audit.ts --extract   (write findings as memories)
 *   bun run packages/orchestrator/src/audit.ts --json      (output as JSON)
 *   bun run packages/orchestrator/src/audit.ts --roots ~/workspace  (scan all projects)
 */

import { resolve, basename } from "path"
import { readdir, readFile, access } from "fs/promises"
import { parseFrontmatter } from "@dalinar/protocol"
import { extractMemories, type ExtractEntry } from "./jasnah.js"

// ── Types ─────────────────────────────────────────────────────────

export interface AuditFinding {
  category: "recurring-blocker" | "decision-oscillation" | "knowledge-gap" | "tag-cluster"
  severity: "high" | "medium" | "low"
  summary: string
  details: string
  evidence: string[]
}

export interface AuditReport {
  timestamp: string
  memoriesScanned: number
  findings: AuditFinding[]
  tagFrequency: Record<string, number>
  typeDistribution: Record<string, number>
  projects?: { name: string; count: number }[]
}

interface MemoryEntry {
  id: string
  type: string
  summary: string
  content: string
  tags: string[]
  confidence: string
  createdAt?: string
  source?: string
  project?: string
}

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv: string[]): { root: string; roots?: string; extract: boolean; json: boolean } {
  const args = argv.slice(2)
  const rootsIdx = args.indexOf("--roots")
  return {
    root: process.cwd(),
    roots: rootsIdx !== -1 && args[rootsIdx + 1] ? resolve(args[rootsIdx + 1]) : undefined,
    extract: args.includes("--extract"),
    json: args.includes("--json"),
  }
}

// ── Memory loading ────────────────────────────────────────────────

const MEMORY_DIRS = [
  "decisions", "insights", "facts",
  "architecture", "domain-facts", "api-contracts", "glossary", "lessons-learned",
]

function formatEvidence(entry: MemoryEntry): string {
  const prefix = entry.project ? `[${entry.project}] ` : ""
  return `${prefix}${entry.summary}`
}

function extractFirstLine(content: string): string {
  const lines = content.split("\n")
  const line = lines.find((l) => l.trim() && !l.startsWith("#"))
  return line?.trim().slice(0, 120) ?? ""
}

async function discoverMemoryRoots(basePath: string): Promise<{ root: string; project: string }[]> {
  const results: { root: string; project: string }[] = []
  let topLevel: string[]
  try {
    topLevel = await readdir(basePath)
  } catch {
    return results
  }

  for (const entry of topLevel) {
    const candidateMemory = resolve(basePath, entry, ".memory")
    try {
      await access(candidateMemory)
      results.push({ root: resolve(basePath, entry), project: entry })
    } catch {
      // No .memory dir here
    }
  }

  return results
}

async function loadMemoriesFromRoot(root: string, project?: string): Promise<MemoryEntry[]> {
  const memoryRoot = resolve(root, ".memory")
  const entries: MemoryEntry[] = []

  for (const dir of MEMORY_DIRS) {
    const dirPath = resolve(memoryRoot, dir)
    let files: string[]
    try {
      files = await readdir(dirPath)
    } catch {
      continue
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue
      try {
        const raw = await readFile(resolve(dirPath, file), "utf-8")
        const { frontmatter, content } = parseFrontmatter(raw)
        entries.push({
          id: (frontmatter.id as string) ?? basename(file, ".md"),
          type: (frontmatter.type as string) ?? dir,
          summary: (frontmatter.summary as string) || extractFirstLine(content),
          content,
          tags: Array.isArray(frontmatter.tags) ? (frontmatter.tags as string[]) : [],
          confidence: (frontmatter.confidence as string) ?? "medium",
          createdAt: frontmatter.createdAt as string | undefined,
          source: frontmatter.source as string | undefined,
          project,
        })
      } catch {
        // Skip malformed files
      }
    }
  }

  return entries
}

async function loadMemories(root: string, rootsBase?: string): Promise<{ entries: MemoryEntry[]; projects?: { name: string; count: number }[] }> {
  if (!rootsBase) {
    return { entries: await loadMemoriesFromRoot(root) }
  }

  const roots = await discoverMemoryRoots(rootsBase)
  if (roots.length === 0) {
    console.warn(`[dalinar] No .memory/ directories found under ${rootsBase}`)
    return { entries: [] }
  }

  const allEntries: MemoryEntry[] = []
  const projects: { name: string; count: number }[] = []

  for (const { root: r, project } of roots) {
    const entries = await loadMemoriesFromRoot(r, project)
    allEntries.push(...entries)
    projects.push({ name: project, count: entries.length })
  }

  projects.sort((a, b) => b.count - a.count)
  return { entries: allEntries, projects }
}

// ── Analysis ──────────────────────────────────────────────────────

function computeTagFrequency(entries: MemoryEntry[]): Record<string, number> {
  const freq: Record<string, number> = {}
  for (const e of entries) {
    for (const tag of e.tags) {
      freq[tag] = (freq[tag] ?? 0) + 1
    }
  }
  return freq
}

function computeTypeDistribution(entries: MemoryEntry[]): Record<string, number> {
  const dist: Record<string, number> = {}
  for (const e of entries) {
    dist[e.type] = (dist[e.type] ?? 0) + 1
  }
  return dist
}

function detectRecurringBlockers(entries: MemoryEntry[]): AuditFinding[] {
  const findings: AuditFinding[] = []

  // Find tags that appear in 3+ lesson-learned entries
  const lessonTags = new Map<string, MemoryEntry[]>()
  const lessons = entries.filter((e) => e.type === "lesson-learned" || e.type === "insight")

  for (const entry of lessons) {
    for (const tag of entry.tags) {
      const existing = lessonTags.get(tag) ?? []
      existing.push(entry)
      lessonTags.set(tag, existing)
    }
  }

  for (const [tag, tagEntries] of lessonTags) {
    if (tagEntries.length >= 3) {
      findings.push({
        category: "recurring-blocker",
        severity: tagEntries.length >= 5 ? "high" : "medium",
        summary: `Recurring issues with "${tag}" (${tagEntries.length} lessons)`,
        details: `The tag "${tag}" appears in ${tagEntries.length} lesson-learned entries, suggesting a systematic problem area that may need architectural attention.`,
        evidence: tagEntries.map(formatEvidence),
      })
    }
  }

  return findings
}

function detectDecisionOscillation(entries: MemoryEntry[]): AuditFinding[] {
  const findings: AuditFinding[] = []

  // Group architecture decisions by tag overlap
  const archEntries = entries.filter((e) => e.type === "architecture" || e.type === "decision")
  const tagGroups = new Map<string, MemoryEntry[]>()

  for (const entry of archEntries) {
    for (const tag of entry.tags) {
      const existing = tagGroups.get(tag) ?? []
      existing.push(entry)
      tagGroups.set(tag, existing)
    }
  }

  // Flag groups with 3+ decisions on the same topic
  for (const [tag, group] of tagGroups) {
    if (group.length >= 3) {
      findings.push({
        category: "decision-oscillation",
        severity: group.length >= 4 ? "high" : "medium",
        summary: `Multiple architecture decisions on "${tag}" (${group.length} entries)`,
        details: `Found ${group.length} architecture/decision entries related to "${tag}". This may indicate decision oscillation — the same topic being revisited repeatedly without convergence.`,
        evidence: group.map(formatEvidence),
      })
    }
  }

  return findings
}

function detectKnowledgeGaps(entries: MemoryEntry[], tagFrequency: Record<string, number>): AuditFinding[] {
  const findings: AuditFinding[] = []

  // Find tags that appear in domain-fact/fact entries but have no architecture notes
  const tagTypes = new Map<string, Set<string>>()
  for (const entry of entries) {
    for (const tag of entry.tags) {
      const types = tagTypes.get(tag) ?? new Set()
      types.add(entry.type)
      tagTypes.set(tag, types)
    }
  }

  const architectureTypes = new Set(["architecture", "decision"])
  const contractTypes = new Set(["api-contract"])

  for (const [tag, types] of tagTypes) {
    const freq = tagFrequency[tag] ?? 0
    if (freq < 2) continue // Skip infrequent tags

    const hasArchitecture = [...types].some((t) => architectureTypes.has(t))
    const hasContract = [...types].some((t) => contractTypes.has(t))

    if (!hasArchitecture && freq >= 3) {
      const tagEntries = entries.filter((e) => e.tags.includes(tag))
      findings.push({
        category: "knowledge-gap",
        severity: freq >= 5 ? "high" : "low",
        summary: `No architecture notes for "${tag}" (${freq} other entries)`,
        details: `The tag "${tag}" appears in ${freq} entries but none are architecture/decision type. Consider documenting architectural decisions for this area.`,
        evidence: tagEntries.map(formatEvidence).filter(Boolean),
      })
    }

    if (!hasContract && types.has("domain-fact") && freq >= 3) {
      const tagEntries = entries.filter((e) => e.tags.includes(tag))
      findings.push({
        category: "knowledge-gap",
        severity: "low",
        summary: `No API contracts documented for "${tag}"`,
        details: `The tag "${tag}" has domain facts but no API contract documentation. If this area has service interfaces, they should be documented.`,
        evidence: tagEntries.map(formatEvidence).filter(Boolean),
      })
    }
  }

  return findings
}

function detectTagClusters(entries: MemoryEntry[]): AuditFinding[] {
  const findings: AuditFinding[] = []

  // Find tags that frequently co-occur
  const cooccurrence = new Map<string, number>()
  for (const entry of entries) {
    const tags = entry.tags.sort()
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const pair = `${tags[i]}+${tags[j]}`
        cooccurrence.set(pair, (cooccurrence.get(pair) ?? 0) + 1)
      }
    }
  }

  // Report strongly coupled tag pairs
  for (const [pair, count] of cooccurrence) {
    if (count >= 4) {
      const [tagA, tagB] = pair.split("+")
      const pairEntries = entries.filter((e) => e.tags.includes(tagA) && e.tags.includes(tagB))
      findings.push({
        category: "tag-cluster",
        severity: "low",
        summary: `Strong coupling: "${tagA}" and "${tagB}" (${count} co-occurrences)`,
        details: `Tags "${tagA}" and "${tagB}" appear together in ${count} entries. This cluster may represent a cohesive domain area worth tracking as a first-class concept.`,
        evidence: pairEntries.map(formatEvidence).filter(Boolean),
      })
    }
  }

  return findings
}

// ── Main pipeline ─────────────────────────────────────────────────

export async function runAudit(root: string, rootsBase?: string): Promise<AuditReport> {
  const { entries, projects } = await loadMemories(root, rootsBase)
  const tagFrequency = computeTagFrequency(entries)
  const typeDistribution = computeTypeDistribution(entries)

  const findings: AuditFinding[] = [
    ...detectRecurringBlockers(entries),
    ...detectDecisionOscillation(entries),
    ...detectKnowledgeGaps(entries, tagFrequency),
    ...detectTagClusters(entries),
  ]

  // Sort by severity
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
  findings.sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2))

  return {
    timestamp: new Date().toISOString(),
    memoriesScanned: entries.length,
    findings,
    tagFrequency,
    typeDistribution,
    projects,
  }
}

function formatReport(report: AuditReport): string {
  const lines: string[] = [
    "# Dalinar Audit Report",
    "",
    `**Date:** ${report.timestamp}`,
    `**Memories scanned:** ${report.memoriesScanned}`,
    "",
  ]

  // Projects scanned (multi-root mode)
  if (report.projects && report.projects.length > 0) {
    lines.push("## Projects Scanned")
    lines.push("")
    for (const p of report.projects) {
      lines.push(`- **${p.name}**: ${p.count} memories`)
    }
    lines.push("")
  }

  // Type distribution
  lines.push("## Memory Distribution")
  lines.push("")
  for (const [type, count] of Object.entries(report.typeDistribution).sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${type}**: ${count}`)
  }
  lines.push("")

  // Findings
  if (report.findings.length === 0) {
    lines.push("## Findings")
    lines.push("")
    lines.push("No patterns detected. The knowledge base looks healthy.")
  } else {
    lines.push(`## Findings (${report.findings.length})`)
    lines.push("")

    for (const finding of report.findings) {
      const icon = finding.severity === "high" ? "[!]" : finding.severity === "medium" ? "[~]" : "[.]"
      lines.push(`### ${icon} ${finding.summary}`)
      lines.push("")
      lines.push(`**Category:** ${finding.category} | **Severity:** ${finding.severity}`)
      lines.push("")
      lines.push(finding.details)
      if (finding.evidence.length > 0) {
        lines.push("")
        lines.push("**Evidence:**")
        for (const e of finding.evidence.slice(0, 5)) {
          lines.push(`- ${e}`)
        }
        if (finding.evidence.length > 5) {
          lines.push(`- ... and ${finding.evidence.length - 5} more`)
        }
      }
      lines.push("")
    }
  }

  // Top tags
  const topTags = Object.entries(report.tagFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)

  if (topTags.length > 0) {
    lines.push("## Top Tags")
    lines.push("")
    for (const [tag, count] of topTags) {
      lines.push(`- **${tag}**: ${count}`)
    }
  }

  return lines.join("\n")
}

function findingsToExtractEntries(findings: AuditFinding[]): ExtractEntry[] {
  return findings
    .filter((f) => f.severity === "high" || f.severity === "medium")
    .map((f) => ({
      type: "lesson-learned" as const,
      summary: f.summary.slice(0, 100),
      content: `${f.details}\n\nEvidence: ${f.evidence.slice(0, 3).join("; ")}`.slice(0, 500),
      tags: ["audit", f.category],
      confidence: f.severity === "high" ? "high" as const : "medium" as const,
    }))
}

// ── Run ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const opts = parseArgs(process.argv)

  console.log("[dalinar] Running audit...\n")
  const report = await runAudit(opts.root, opts.roots)

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(formatReport(report))
  }

  if (opts.extract && report.findings.length > 0) {
    const entries = findingsToExtractEntries(report.findings)
    if (entries.length > 0) {
      console.log(`\n[dalinar] Extracting ${entries.length} audit findings as memories...`)
      const result = await extractMemories(entries, {
        root: opts.root,
        source: `audit-${new Date().toISOString().slice(0, 10)}`,
      })
      if (result.success) {
        console.log(`[dalinar] Done. ${entries.length} findings saved.`)
      } else {
        console.warn(`[dalinar] Extraction failed: ${result.output}`)
      }
    }
  }
}
