import { Effect } from "effect"
import { JasnahService, SazedService, type ExtractEntry } from "../services.js"
import { SubprocessService } from "../subprocess.js"

export interface ImplementOptions {
  ticketKey: string
  shouldAnalyze: boolean
  useWorktree: boolean
  root: string
}

export interface ImplementationContext {
  ticketKey: string
  priorContext: string
  analysisMarkdown?: string | undefined
  worktreePath?: string | undefined
  worktreeBranch?: string | undefined
}

const createWorktree = (ticketKey: string, root: string) =>
  Effect.gen(function* () {
    const subprocess = yield* SubprocessService
    const branch = `feat/${ticketKey.toLowerCase()}`
    const worktreePath = `${root}/.worktrees/${ticketKey.toLowerCase()}`

    const git = (args: string[]) =>
      subprocess.run("git", { args, rawCommand: true, cwd: root, nothrow: true, timeout: "30 seconds" })

    // Step 1: Fetch remote so we know about remote branches
    yield* Effect.logInfo("Fetching remote...")
    yield* git(["fetch", "origin", "--prune"]).pipe(
      Effect.tapError((e) => Effect.logWarning(`git fetch failed: ${e.message}`)),
      Effect.orElseSucceed(() => ({ stdout: "", stderr: "", exitCode: 1, timedOut: false })),
    )

    // Step 2: Check if branch exists remotely or locally
    const remoteBranch = `origin/${branch}`
    const remoteCheck = yield* git(["rev-parse", "--verify", remoteBranch])
    const localCheck = yield* git(["rev-parse", "--verify", branch])
    const hasRemote = remoteCheck.exitCode === 0
    const hasLocal = localCheck.exitCode === 0

    // Step 3: Create worktree with appropriate strategy
    let result: { stdout: string; stderr: string; exitCode: number; timedOut: boolean }

    if (hasLocal) {
      // Branch exists locally — attach worktree to it
      yield* Effect.logInfo(`Branch ${branch} exists locally, attaching worktree`)
      result = yield* git(["worktree", "add", worktreePath, branch])
    } else if (hasRemote) {
      // Branch exists on remote — create local tracking branch
      yield* Effect.logInfo(`Branch ${branch} exists on remote, creating tracking worktree`)
      result = yield* git(["worktree", "add", "--track", "-b", branch, worktreePath, remoteBranch])
    } else {
      // New branch — create from HEAD
      yield* Effect.logInfo(`Creating new branch ${branch}`)
      result = yield* git(["worktree", "add", "-b", branch, worktreePath])
    }

    if (result.exitCode !== 0) {
      yield* Effect.logWarning(`Failed to create worktree: ${result.stderr}`)
      return null
    }

    // Step 4: If local branch existed and remote is ahead, pull updates
    if (hasLocal && hasRemote) {
      yield* Effect.logInfo("Pulling latest from remote...")
      yield* subprocess.run("git", {
        args: ["pull", "--ff-only", "origin", branch],
        rawCommand: true,
        cwd: worktreePath,
        nothrow: true,
        timeout: "30 seconds",
      }).pipe(
        Effect.tap((r) =>
          r.exitCode !== 0
            ? Effect.logWarning(`git pull --ff-only failed: ${r.stderr}. Worktree may be behind remote.`)
            : Effect.void,
        ),
      )
    }

    return { path: worktreePath, branch }
  })

// ── Effect pipeline ────────────────────────────────────────────────

export const implementTicketPipeline = (opts: ImplementOptions) =>
  Effect.gen(function* () {
    const jasnah = yield* JasnahService
    const sazed = yield* SazedService

    const { ticketKey, root } = opts

    yield* Effect.log(`Preparing implementation context for ${ticketKey}...`)

    // Stage 1: Search Jasnah for prior context
    yield* Effect.log("Step 1: Searching Jasnah for prior context...")
    const memories = yield* jasnah.searchContextForEpic(ticketKey, root)
    const priorContext = yield* jasnah.formatContextForPrompt(memories)

    if (memories.length > 0) {
      yield* Effect.log(`  Found ${memories.length} relevant memories`)
    } else {
      yield* Effect.log("  No prior context found")
    }

    // Stage 2: Optionally run Sazed analysis
    let analysisMarkdown: string | undefined
    if (opts.shouldAnalyze) {
      yield* Effect.log(`Step 2: Running Sazed analysis for ${ticketKey}...`)
      const analysisResult = yield* sazed.analyze({
        epicKey: ticketKey,
        force: false,
        notes: true,
      }).pipe(
        Effect.map((output) => ({ success: true as const, output })),
        Effect.catchAll((e) =>
          Effect.as(
            Effect.logWarning(`  Analysis failed: ${e.message}, continuing without it`),
            { success: false as const, output: null },
          ),
        ),
      )
      if (analysisResult.success) {
        analysisMarkdown = analysisResult.output.markdown
        yield* Effect.log(
          `  Analysis complete (${analysisResult.output.markdown.length} chars)`,
        )
      }
    }

    // Stage 3: Optionally create worktree
    let worktreePath: string | undefined
    let worktreeBranch: string | undefined
    if (opts.useWorktree) {
      yield* Effect.log(`Step 3: Creating git worktree for ${ticketKey}...`)
      const wt = yield* createWorktree(ticketKey, root)
      if (wt) {
        worktreePath = wt.path
        worktreeBranch = wt.branch
        yield* Effect.log(
          `  Worktree created at ${wt.path} (branch: ${wt.branch})`,
        )
      } else {
        yield* Effect.logWarning(
          "  Worktree creation failed, using main tree",
        )
      }
    }

    return { ticketKey, priorContext, analysisMarkdown, worktreePath, worktreeBranch }
  }).pipe(Effect.withSpan("implement-ticket"))

export const postImplementExtractPipeline = (
  ticketKey: string,
  sessionNotes: ExtractEntry[],
  root?: string,
) =>
  Effect.gen(function* () {
    const jasnah = yield* JasnahService

    yield* Effect.log(`Extracting session memories for ${ticketKey}...`)
    const result = yield* jasnah.extractMemories(sessionNotes, {
      root,
      source: `implement-${ticketKey}`,
    })

    if (result.success) {
      yield* Effect.log(`Extracted ${sessionNotes.length} memories`)
    } else {
      yield* Effect.logWarning(`Extraction failed: ${result.output}`)
    }

    return result
  }).pipe(Effect.withSpan("post-implement-extract"))
