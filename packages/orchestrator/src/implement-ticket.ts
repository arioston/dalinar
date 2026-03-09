#!/usr/bin/env bun
/**
 * implement-ticket — Full lifecycle pipeline from Jira ticket to PR.
 *
 * Usage:
 *   bun run packages/orchestrator/src/implement-ticket.ts PROJ-123
 *   bun run packages/orchestrator/src/implement-ticket.ts PROJ-123 --analyze --worktree
 *
 * Or via unified CLI:
 *   bun run packages/orchestrator/src/effect/cli.ts implement PROJ-123 --analyze --worktree
 */

export { implementTicketPipeline } from "./effect/pipelines/implement.js"
export { postImplementExtractPipeline } from "./effect/pipelines/implement.js"

// Legacy entry point — delegates to @effect/cli
if (import.meta.main) {
  const { runCliApp } = await import("./effect/cli.js")
  const args = [...process.argv.slice(0, 2), "implement", ...process.argv.slice(2)]
  runCliApp(args)
}
