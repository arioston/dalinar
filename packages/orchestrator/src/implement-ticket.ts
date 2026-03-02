#!/usr/bin/env bun
/**
 * implement-ticket — Full lifecycle pipeline from Jira ticket to PR.
 *
 * 1. Search Jasnah for prior context on affected areas
 * 2. Optionally run Sazed analysis for task breakdown
 * 3. Create git worktree for isolated work
 * 4. Output implementation plan for the agent to execute
 * 5. After implementation: extract session memories
 *
 * This pipeline is designed to be invoked by an AI agent (Claude Code / OpenCode)
 * as part of the Jira skill workflow. It handles the context-gathering and
 * environment setup; the agent handles the actual implementation.
 *
 * Usage:
 *   bun run packages/orchestrator/src/implement-ticket.ts PROJ-123
 *   bun run packages/orchestrator/src/implement-ticket.ts PROJ-123 --analyze
 *   bun run packages/orchestrator/src/implement-ticket.ts PROJ-123 --worktree
 */

import { $ } from "bun"
import { searchContextForEpic, extractMemories, formatContextForPrompt, type ExtractEntry } from "./jasnah.js"
import { analyze } from "./sazed.js"

// ── Types ─────────────────────────────────────────────────────────

interface ImplementOptions {
  ticketKey: string
  shouldAnalyze: boolean
  useWorktree: boolean
  root: string
}

interface ImplementationContext {
  ticketKey: string
  priorContext: string
  analysisMarkdown?: string
  worktreePath?: string
  worktreeBranch?: string
}

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv: string[]): ImplementOptions {
  const args = argv.slice(2)
  const ticketKey = args.find((a) => !a.startsWith("--"))
  if (!ticketKey) {
    console.error("Usage: implement-ticket <TICKET-KEY> [--analyze] [--worktree]")
    process.exit(1)
  }

  return {
    ticketKey,
    shouldAnalyze: args.includes("--analyze"),
    useWorktree: args.includes("--worktree"),
    root: process.cwd(),
  }
}

// ── Worktree setup ────────────────────────────────────────────────

async function createWorktree(ticketKey: string, root: string): Promise<{ path: string; branch: string } | null> {
  const branch = `feat/${ticketKey.toLowerCase()}`
  const worktreePath = `${root}/.worktrees/${ticketKey.toLowerCase()}`

  const result = await $`git worktree add -b ${branch} ${worktreePath}`
    .cwd(root)
    .quiet()
    .nothrow()

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    // Branch may already exist
    if (stderr.includes("already exists")) {
      const retry = await $`git worktree add ${worktreePath} ${branch}`
        .cwd(root)
        .quiet()
        .nothrow()
      if (retry.exitCode === 0) {
        return { path: worktreePath, branch }
      }
    }
    console.warn(`[dalinar] Failed to create worktree: ${stderr}`)
    return null
  }

  return { path: worktreePath, branch }
}

// ── Main pipeline ─────────────────────────────────────────────────

export async function implementTicket(opts: ImplementOptions): Promise<ImplementationContext> {
  const { ticketKey, root } = opts

  console.log(`\n[dalinar] Preparing implementation context for ${ticketKey}...\n`)

  // Step 1: Search Jasnah for prior context
  console.log("[dalinar] Step 1: Searching Jasnah for prior context...")
  const memories = await searchContextForEpic(ticketKey, root)
  const priorContext = formatContextForPrompt(memories)

  if (memories.length > 0) {
    console.log(`[dalinar]   Found ${memories.length} relevant memories`)
  } else {
    console.log("[dalinar]   No prior context found")
  }

  const context: ImplementationContext = { ticketKey, priorContext }

  // Step 2: Optionally run Sazed analysis
  if (opts.shouldAnalyze) {
    console.log(`[dalinar] Step 2: Running Sazed analysis for ${ticketKey}...`)
    const result = await analyze({
      epicKey: ticketKey,
      force: false,
      notes: true,
    })
    if (result.success) {
      context.analysisMarkdown = result.markdown
      console.log(`[dalinar]   Analysis complete (${result.markdown.length} chars)`)
    } else {
      console.warn(`[dalinar]   Analysis failed, continuing without it`)
    }
  }

  // Step 3: Optionally create worktree
  if (opts.useWorktree) {
    console.log(`[dalinar] Step 3: Creating git worktree for ${ticketKey}...`)
    const wt = await createWorktree(ticketKey, root)
    if (wt) {
      context.worktreePath = wt.path
      context.worktreeBranch = wt.branch
      console.log(`[dalinar]   Worktree created at ${wt.path} (branch: ${wt.branch})`)
    } else {
      console.warn("[dalinar]   Worktree creation failed, using main tree")
    }
  }

  // Output the implementation context
  console.log("\n" + "=".repeat(60))
  console.log(`## Implementation Context for ${ticketKey}\n`)

  if (context.priorContext) {
    console.log(context.priorContext)
  }

  if (context.analysisMarkdown) {
    console.log("## Sazed Analysis\n")
    console.log(context.analysisMarkdown)
  }

  if (context.worktreePath) {
    console.log(`## Worktree\n`)
    console.log(`Path: ${context.worktreePath}`)
    console.log(`Branch: ${context.worktreeBranch}`)
    console.log(`\nSwitch to worktree: cd ${context.worktreePath}`)
  }

  console.log("\n" + "=".repeat(60))

  return context
}

/**
 * Post-implementation: extract session memories.
 * Call this after the agent finishes implementing the ticket.
 */
export async function postImplementExtract(
  ticketKey: string,
  sessionNotes: ExtractEntry[],
  root?: string,
): Promise<void> {
  console.log(`\n[dalinar] Extracting session memories for ${ticketKey}...`)
  const result = await extractMemories(sessionNotes, {
    root,
    source: `implement-${ticketKey}`,
  })

  if (result.success) {
    console.log(`[dalinar] Extracted ${sessionNotes.length} memories`)
  } else {
    console.warn(`[dalinar] Extraction failed: ${result.output}`)
  }
}

// ── Run ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const opts = parseArgs(process.argv)
  await implementTicket(opts)
}
