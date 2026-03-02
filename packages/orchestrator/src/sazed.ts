/**
 * Sazed integration for the Dalinar orchestrator.
 *
 * Wraps Sazed CLI commands as async functions. Sazed uses Effect TypeScript
 * with a complex service layer, so we invoke via subprocess rather than
 * importing the Effect runtime directly.
 */

import { $ } from "bun"
import { resolve } from "path"

// ── Types ─────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  epicKey: string
  force?: boolean
  notes?: boolean
  noMap?: boolean
  noCache?: boolean
  forensics?: boolean
  stdout?: boolean
}

export interface AnalyzeResult {
  success: boolean
  markdown: string
  outputPath?: string
}

export interface SyncOptions {
  epicKey: string
  dryRun?: boolean
}

export interface SyncResult {
  success: boolean
  output: string
}

// ── Resolve Sazed root ────────────────────────────────────────────

function resolveSazedRoot(): string {
  // When in Dalinar workspace, Sazed is at modules/sazed
  const dalinarRoot = process.env.DALINAR_ROOT ?? process.cwd()
  return resolve(dalinarRoot, "modules/sazed")
}

function sazedCli(): string {
  return resolve(resolveSazedRoot(), "packages/cli/src/main.ts")
}

// ── Analyze ───────────────────────────────────────────────────────

/**
 * Run Sazed epic analysis.
 * Returns the markdown output (when --stdout) or the output file path.
 */
export async function analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const args: string[] = ["analyze", opts.epicKey]
  if (opts.force) args.push("--force")
  if (opts.notes) args.push("--notes")
  if (opts.noMap) args.push("--no-map")
  if (opts.noCache) args.push("--no-cache")
  if (opts.forensics) args.push("--forensics")
  // Always use stdout for orchestrator consumption
  args.push("--stdout")

  const result = await $`bun run ${sazedCli()} ${args}`
    .quiet()
    .nothrow()
    .cwd(resolveSazedRoot())
    .env({ ...process.env })

  const stdout = result.stdout.toString().trim()
  const stderr = result.stderr.toString().trim()

  if (result.exitCode !== 0) {
    console.error(`[dalinar] Sazed analysis failed: ${stderr}`)
    return { success: false, markdown: stderr }
  }

  return { success: true, markdown: stdout }
}

// ── Sync to Jira ──────────────────────────────────────────────────

/**
 * Sync refined tasks to Jira as subtasks.
 */
export async function syncToJira(opts: SyncOptions): Promise<SyncResult> {
  const args: string[] = ["sync", opts.epicKey]
  if (opts.dryRun) args.push("--dry-run")

  const result = await $`bun run ${sazedCli()} ${args}`
    .quiet()
    .nothrow()
    .cwd(resolveSazedRoot())
    .env({ ...process.env })

  const stdout = result.stdout.toString().trim()
  const stderr = result.stderr.toString().trim()

  return {
    success: result.exitCode === 0,
    output: stdout || stderr,
  }
}

// ── Status ────────────────────────────────────────────────────────

/**
 * Check staleness of a refined epic.
 */
export async function checkStatus(epicKey: string): Promise<string> {
  const result = await $`bun run ${sazedCli()} status ${epicKey}`
    .quiet()
    .nothrow()
    .cwd(resolveSazedRoot())
    .env({ ...process.env })

  return result.stdout.toString().trim() || result.stderr.toString().trim()
}

// ── Notes ─────────────────────────────────────────────────────────

/**
 * List persisted domain notes with retention scores.
 */
export async function listNotes(): Promise<string> {
  const result = await $`bun run ${sazedCli()} notes list`
    .quiet()
    .nothrow()
    .cwd(resolveSazedRoot())
    .env({ ...process.env })

  return result.stdout.toString().trim() || result.stderr.toString().trim()
}

/**
 * Search Sazed's domain notes.
 */
export async function searchNotes(query: string): Promise<string> {
  const result = await $`bun run ${sazedCli()} notes search ${query}`
    .quiet()
    .nothrow()
    .cwd(resolveSazedRoot())
    .env({ ...process.env })

  return result.stdout.toString().trim() || result.stderr.toString().trim()
}
