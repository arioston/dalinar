/**
 * Unified @effect/cli entry point for all orchestrator pipelines.
 *
 * Replaces manual process.argv parsing in each entry point with
 * typed, validated CLI commands using @effect/cli.
 */

import { Args, Command, Options } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Option } from "effect"
import { resolve } from "path"
import { OrchestratorLive } from "./runtime.js"
import { preflight } from "./paths.js"
import { doctor } from "./doctor.js"
import { SubprocessServiceLive } from "./subprocess.js"
import { NodeFileSystem } from "@effect/platform-node"

// ── analyze-with-context ──────────────────────────────────────────

const analyzeKey = Args.text({ name: "key" }).pipe(
  Args.withDescription("Epic or task key (e.g., EPIC-123 or PROJ-456)"),
)

const analyzeCommand = Command.make(
  "analyze",
  {
    key: analyzeKey,
    force: Options.boolean("force").pipe(Options.withDescription("Re-analyze even if nothing changed")),
    notes: Options.boolean("notes").pipe(Options.withDescription("Extract domain notes after planning")),
    noMap: Options.boolean("no-map").pipe(Options.withDescription("Skip loading the repo map")),
    noCache: Options.boolean("no-cache").pipe(Options.withDescription("Skip exploration cache")),
    forensics: Options.boolean("forensics").pipe(Options.withDescription("Auto-generate forensics report")),
    stdout: Options.boolean("stdout").pipe(Options.withDescription("Write output to stdout instead of file")),
    datastoreIntrospect: Options.boolean("datastore-introspect").pipe(
      Options.withDescription("Include datastore constraint introspection"),
    ),
    datastoreProvider: Options.text("datastore-provider").pipe(
      Options.withDefault("relational"),
      Options.withDescription("Datastore provider: 'relational' or 'elasticsearch'"),
    ),
    datastoreEnv: Options.text("datastore-env").pipe(
      Options.withDefault("local"),
      Options.withDescription("Datastore environment for introspection"),
    ),
    datastoreTargets: Options.text("datastore-targets").pipe(
      Options.optional,
      Options.withDescription("Comma-separated list of targets for datastore introspection"),
    ),
    noDatastoreCache: Options.boolean("no-datastore-cache").pipe(
      Options.withDescription("Skip datastore constraint cache"),
    ),
  },
  ({
    key,
    force,
    notes,
    noMap,
    noCache,
    forensics,
    stdout,
    datastoreIntrospect,
    datastoreProvider,
    datastoreEnv,
    datastoreTargets,
    noDatastoreCache,
  }) =>
    Effect.gen(function* () {
      const { analyzeWithContextPipeline } = yield* Effect.promise(
        () => import("./pipelines/analyze.js"),
      )

      const datastore = datastoreIntrospect
        ? {
            introspect: true as const,
            provider: datastoreProvider as "relational" | "elasticsearch",
            env: datastoreEnv,
            targets: Option.getOrUndefined(datastoreTargets),
            noCache: noDatastoreCache,
          }
        : undefined

      yield* analyzeWithContextPipeline({
        epicKey: key,
        force,
        notes,
        noMap,
        noCache,
        forensics,
        stdout,
        datastore,
        root: process.cwd(),
      }).pipe(Effect.provide(OrchestratorLive), Effect.asVoid)
    }),
)

// ── deep-analyze ──────────────────────────────────────────────────

const deepAnalyzeCommand = Command.make(
  "deep-analyze",
  {
    key: Args.text({ name: "key" }).pipe(Args.withDescription("Epic or task key")),
    force: Options.boolean("force").pipe(Options.withDescription("Re-analyze even if nothing changed")),
    notes: Options.boolean("notes").pipe(Options.withDescription("Extract domain notes")),
    taskOnly: Options.boolean("task-only").pipe(Options.withDescription("Analyze target task only")),
  },
  ({ key, force, notes, taskOnly }) =>
    Effect.gen(function* () {
      const { deepAnalyzePipeline, DeepAnalyzeLive } = yield* Effect.promise(
        () => import("./pipelines/deep-analyze.js"),
      )

      yield* deepAnalyzePipeline({
        key,
        force: force || undefined,
        notes: notes || undefined,
        taskOnly: taskOnly || undefined,
        root: process.cwd(),
      }).pipe(Effect.provide(DeepAnalyzeLive(process.cwd())), Effect.asVoid)
    }),
)

// ── implement-ticket ──────────────────────────────────────────────

const implementCommand = Command.make(
  "implement",
  {
    key: Args.text({ name: "ticket-key" }).pipe(Args.withDescription("Jira ticket key")),
    analyze: Options.boolean("analyze").pipe(Options.withDescription("Run Sazed analysis")),
    worktree: Options.boolean("worktree").pipe(Options.withDescription("Create git worktree")),
  },
  ({ key, analyze: shouldAnalyze, worktree }) =>
    Effect.gen(function* () {
      const { implementTicketPipeline } = yield* Effect.promise(
        () => import("./pipelines/implement.js"),
      )

      const context = yield* implementTicketPipeline({
        ticketKey: key,
        shouldAnalyze,
        useWorktree: worktree,
        root: process.cwd(),
      }).pipe(Effect.provide(OrchestratorLive))

      yield* Console.log("\n" + "=".repeat(60))
      yield* Console.log(`## Implementation Context for ${context.ticketKey}\n`)
      if (context.priorContext) yield* Console.log(context.priorContext)
      if (context.analysisMarkdown) {
        yield* Console.log("## Sazed Analysis\n")
        yield* Console.log(context.analysisMarkdown)
      }
      if (context.worktreePath) {
        yield* Console.log("## Worktree\n")
        yield* Console.log(`Path: ${context.worktreePath}`)
        yield* Console.log(`Branch: ${context.worktreeBranch}`)
        yield* Console.log(`\nSwitch to worktree: cd ${context.worktreePath}`)
      }
      yield* Console.log("\n" + "=".repeat(60))
    }),
)

// ── audit ─────────────────────────────────────────────────────────

const auditCommand = Command.make(
  "audit",
  {
    extract: Options.boolean("extract").pipe(Options.withDescription("Write findings as memories")),
    json: Options.boolean("json").pipe(Options.withDescription("Output as JSON")),
    roots: Options.text("roots").pipe(
      Options.optional,
      Options.withDescription("Base directory to scan all projects"),
    ),
  },
  ({ extract, json, roots }) =>
    Effect.gen(function* () {
      const { auditPipeline } = yield* Effect.promise(
        () => import("./pipelines/audit.js"),
      )

      yield* auditPipeline(process.cwd(), {
        rootsBase: Option.map(roots, (r) => resolve(r)).pipe(Option.getOrUndefined),
        extract,
        json,
      }).pipe(Effect.provide(OrchestratorLive), Effect.asVoid)
    }),
)

// ── reflect ───────────────────────────────────────────────────────

const reflectCommand = Command.make(
  "reflect",
  {
    sprint: Options.text("sprint").pipe(Options.withDescription("Sprint name (e.g., sprint-42)")),
    dryRun: Options.boolean("dry-run").pipe(Options.withDescription("Preview without extracting")),
  },
  ({ sprint, dryRun }) =>
    Effect.gen(function* () {
      const { reflectPipeline } = yield* Effect.promise(
        () => import("./pipelines/reflect.js"),
      )

      // Read JSON from stdin
      const stdinText = yield* Effect.promise(() => Bun.stdin.text())
      if (!stdinText.trim()) {
        yield* Console.log("[dalinar] No stdin input. Provide reflection data as JSON via stdin.")
        yield* Console.log("")
        yield* Console.log(`Example: echo '{"estimateAccuracy":[...]}' | dalinar reflect --sprint ${sprint}`)
        return
      }

      const parsed = yield* Effect.try({
        try: () => JSON.parse(stdinText.trim()),
        catch: () => new Error("[dalinar] Failed to parse stdin as JSON"),
      })

      const reflection = { sprint, ...parsed }

      yield* reflectPipeline(reflection, { dryRun, root: process.cwd() }).pipe(
        Effect.provide(OrchestratorLive),
        Effect.asVoid,
      )
    }),
)

// ── dialectic ─────────────────────────────────────────────────────

const dialecticCommand = Command.make(
  "dialectic",
  {
    question: Args.text({ name: "question" }).pipe(Args.withDescription("Decision question to analyze")),
    extract: Options.boolean("extract").pipe(Options.withDescription("Extract findings as memories")),
  },
  ({ question, extract: _extract }) =>
    Effect.gen(function* () {
      const { dialecticPipeline } = yield* Effect.promise(
        () => import("./pipelines/dialectic.js"),
      )

      const result = yield* dialecticPipeline(
        { question },
        process.cwd(),
      ).pipe(Effect.provide(OrchestratorLive))

      yield* Console.log("\n" + "=".repeat(60))
      yield* Console.log("## Agent A Prompt")
      yield* Console.log("=".repeat(60))
      yield* Console.log(result.prompts.positionA)

      yield* Console.log("\n" + "=".repeat(60))
      yield* Console.log("## Agent B Prompt")
      yield* Console.log("=".repeat(60))
      yield* Console.log(result.prompts.positionB)

      yield* Console.log("\n" + "=".repeat(60))
      yield* Console.log("## Synthesis Prompt")
      yield* Console.log("=".repeat(60))
      yield* Console.log(result.prompts.synthesis)

      yield* Console.log("\n[dalinar] Run each prompt in isolated agent contexts, then combine with the synthesis prompt.")
    }),
)

// ── vault-sync ────────────────────────────────────────────────────

const vaultSyncCommand = Command.make(
  "vault-sync",
  {
    root: Args.text({ name: "project-root" }).pipe(
      Args.withDefault(process.cwd()),
      Args.withDescription("Project root directory"),
    ),
  },
  ({ root }) =>
    Effect.gen(function* () {
      const { vaultSyncPipeline } = yield* Effect.promise(
        () => import("./pipelines/vault-sync.js"),
      )

      const result = yield* vaultSyncPipeline(root).pipe(Effect.provide(OrchestratorLive))

      if (result.synced) {
        yield* Effect.logInfo(`Synced to ${result.target}`)
      } else {
        yield* Effect.logInfo(`Skipped: ${result.reason}`)
      }
    }),
)

// ── Root command ──────────────────────────────────────────────────

const dalinar = Command.make("dalinar").pipe(
  Command.withSubcommands([
    analyzeCommand,
    deepAnalyzeCommand,
    implementCommand,
    auditCommand,
    reflectCommand,
    dialecticCommand,
    vaultSyncCommand,
  ]),
)

// ── CLI app ───────────────────────────────────────────────────────

export const cliApp = Command.run(dalinar, {
  name: "dalinar",
  version: "0.1.0",
})

// ── Main ──────────────────────────────────────────────────────────

export const runCliApp = (args: string[]) => {
  const program = Effect.gen(function* () {
    // Preflight checks
    yield* preflight.pipe(
      Effect.provide(NodeFileSystem.layer),
      Effect.provide(SubprocessServiceLive),
      Effect.catchAll((e) => Effect.logWarning(`Preflight failed: ${e}`)),
    )

    yield* doctor.pipe(
      Effect.provide(NodeFileSystem.layer),
      Effect.provide(SubprocessServiceLive),
      Effect.catchAll((e) => Effect.logWarning(`Doctor check failed: ${String(e)}`)),
    )

    yield* cliApp(args)
  }).pipe(
    Effect.tapError((error) => {
      if (error == null || typeof error !== "object") return Effect.void
      const e = { ...error } as Record<string, unknown>
      const annotations: Record<string, string> = {}
      for (const [k, v] of Object.entries(e)) {
        if (v !== undefined && k !== "cause" && typeof v !== "object") {
          annotations[k] = String(v)
        }
      }
      if (Object.keys(annotations).length === 0) return Effect.void
      return Effect.logError("[dalinar] Pipeline failed").pipe(
        Effect.annotateLogs(annotations),
      )
    }),
    Effect.provide(NodeContext.layer),
  )

  NodeRuntime.runMain(program)
}

if (import.meta.main) {
  runCliApp(process.argv)
}
