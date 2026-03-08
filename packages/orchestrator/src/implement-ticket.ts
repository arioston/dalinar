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

export { implementTicketPipeline } from "./effect/pipelines/implement.js"
export { postImplementExtractPipeline } from "./effect/pipelines/implement.js"

// ── CLI entry point ──────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2)
  const ticketKey = args.find((a) => !a.startsWith("--"))
  if (!ticketKey) {
    console.error("Usage: implement-ticket <TICKET-KEY> [--analyze] [--worktree]")
    process.exit(1)
  }

  const opts = {
    ticketKey,
    shouldAnalyze: args.includes("--analyze"),
    useWorktree: args.includes("--worktree"),
    root: process.cwd(),
  }

  const { Effect } = await import("effect")
  const { implementTicketPipeline } = await import("./effect/pipelines/implement.js")
  const { OrchestratorLive, runCli } = await import("./effect/runtime.js")

  runCli(
    implementTicketPipeline(opts).pipe(
      Effect.tap((context) =>
        Effect.sync(() => {
          console.log("\n" + "=".repeat(60))
          console.log(`## Implementation Context for ${context.ticketKey}\n`)
          if (context.priorContext) console.log(context.priorContext)
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
        }),
      ),
      Effect.provide(OrchestratorLive),
      Effect.asVoid,
    ),
  )
}
