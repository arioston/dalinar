import { Context, Effect, Layer, Schema } from "effect"
import { $ } from "bun"
import { resolve } from "path"
import { JasnahError, SazedError, HoidError } from "./errors.js"
import { SubprocessService } from "./subprocess.js"
import {
  SAZED_CONTRACT_VERSION,
  SazedAnalyzeOutput,
  SazedSyncOutput,
  SazedStatusOutput,
  SazedNotesListOutput,
} from "@dalinar/protocol"

// ── Jasnah Service ─────────────────────────────────────────────────

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

export interface JasnahServiceShape {
  readonly searchMemories: (
    opts: SearchOptions,
  ) => Effect.Effect<readonly MemorySearchResult[], JasnahError>
  readonly searchContextForEpic: (
    epicDescription: string,
    root?: string,
  ) => Effect.Effect<readonly MemorySearchResult[], JasnahError>
  readonly extractMemories: (
    entries: readonly ExtractEntry[],
    opts?: { root?: string | undefined; source?: string | undefined; dryRun?: boolean | undefined },
  ) => Effect.Effect<{ success: boolean; output: string }, JasnahError>
  readonly formatContextForPrompt: (
    results: readonly MemorySearchResult[],
  ) => Effect.Effect<string, never>
}

export class JasnahService extends Context.Tag("@dalinar/JasnahService")<
  JasnahService,
  JasnahServiceShape
>() {}

function resolveJasnahRoot(): string {
  return (
    process.env.JASNAH_ROOT ??
    resolve(
      process.env.XDG_DATA_HOME ?? resolve(process.env.HOME!, ".local/share"),
      "jasnah",
    )
  )
}

function parseSearchOutput(stdout: string): MemorySearchResult[] {
  if (!stdout) return []
  try {
    const parsed = JSON.parse(stdout)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // Output is human-readable text
  }
  return [
    {
      memory_id: "search-context",
      type: "mixed",
      summary: "Prior context from Jasnah memories",
      content: stdout,
      tags: [],
      confidence: "high",
      score: 1.0,
      retention: 1.0,
    },
  ]
}

const makeJasnah = Effect.gen(function* () {
  const subprocess = yield* SubprocessService

  const searchMemories: JasnahServiceShape["searchMemories"] = (opts) =>
    Effect.gen(function* () {
      const jasnahRoot = resolveJasnahRoot()
      const scriptPath = resolve(jasnahRoot, "scripts/search-memory.ts")

      const args: string[] = [opts.query]
      if (opts.type) args.push("--type", opts.type)
      if (opts.limit) args.push("--limit", String(opts.limit))
      if (opts.tags) {
        for (const tag of opts.tags) args.push("--tag", tag)
      }
      if (opts.root) args.push("--root", opts.root)

      const result = yield* subprocess
        .run(scriptPath, { args, nothrow: true })
        .pipe(
          Effect.mapError(
            (e) =>
              new JasnahError({
                message: `Search failed: ${e.message}`,
                operation: "searchMemories",
                cause: e,
              }),
          ),
        )

      if (result.exitCode !== 0) {
        if (
          result.stderr.includes("not configured") ||
          result.stderr.includes("QDRANT")
        ) {
          return [] as MemorySearchResult[]
        }
        yield* Effect.logWarning(`Jasnah search failed: ${result.stderr}`)
        return [] as MemorySearchResult[]
      }

      return parseSearchOutput(result.stdout)
    })

  const searchContextForEpic: JasnahServiceShape["searchContextForEpic"] = (
    epicDescription,
    root,
  ) =>
    Effect.gen(function* () {
      const types = [
        "architecture",
        "domain-fact",
        "api-contract",
        "lesson-learned",
      ]
      const results = yield* Effect.all(
        types.map((type) =>
          searchMemories({ query: epicDescription, type, limit: 5, root }),
        ),
        { concurrency: "unbounded" },
      )

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
      merged.sort((a, b) => b.score - a.score)
      return merged
    })

  const extractMemories: JasnahServiceShape["extractMemories"] = (
    entries,
    opts = {},
  ) =>
    Effect.gen(function* () {
      if (entries.length === 0)
        return { success: true, output: "No entries to extract" }

      const jasnahRoot = resolveJasnahRoot()
      const scriptPath = resolve(jasnahRoot, "scripts/extract-inline.ts")

      const args: string[] = []
      if (opts.root) args.push("--root", opts.root)
      if (opts.source) args.push("--source", opts.source)
      if (opts.dryRun) args.push("--dry-run")

      const json = JSON.stringify(entries)
      // Piped stdin requires direct shell access (can't route through SubprocessService)
      const result = yield* Effect.tryPromise({
        try: async () => {
          const proc = await $`echo ${json} | bun run ${scriptPath} ${args}`
            .quiet()
            .nothrow()
            .env({ ...process.env })

          return {
            stdout: proc.stdout.toString().trim(),
            stderr: proc.stderr.toString().trim(),
            exitCode: proc.exitCode,
          }
        },
        catch: (error) =>
          new JasnahError({
            message: "Memory extraction failed",
            operation: "extractMemories",
            cause: error,
          }),
      })

      if (result.exitCode !== 0) {
        yield* Effect.logWarning(
          `Memory extraction failed: ${result.stderr}`,
        )
        return { success: false, output: result.stderr }
      }

      return { success: true, output: result.stdout || result.stderr }
    })

  const formatContextForPrompt: JasnahServiceShape["formatContextForPrompt"] =
    (results) =>
      Effect.sync(() => {
        if (results.length === 0) return ""
        const lines = ["## Prior Context (from Jasnah memory)", ""]
        for (const r of results) {
          lines.push(`### [${r.type}] ${r.summary}`)
          lines.push(r.content)
          if (r.tags.length > 0) lines.push(`Tags: ${r.tags.join(", ")}`)
          lines.push("")
        }
        return lines.join("\n")
      })

  return {
    searchMemories,
    searchContextForEpic,
    extractMemories,
    formatContextForPrompt,
  } satisfies JasnahServiceShape
})

export const JasnahServiceLive = Layer.effect(JasnahService, makeJasnah)

// ── Sazed Service ──────────────────────────────────────────────────

export interface AnalyzeOptions {
  epicKey: string
  context?: string | undefined
  force?: boolean
  notes?: boolean
  noMap?: boolean
  noCache?: boolean
  forensics?: boolean
  stdout?: boolean
}

export interface SyncOptions {
  epicKey: string
  dryRun?: boolean
}

export interface SazedServiceShape {
  readonly analyze: (
    opts: AnalyzeOptions,
  ) => Effect.Effect<SazedAnalyzeOutput, SazedError>
  readonly syncToJira: (
    opts: SyncOptions,
  ) => Effect.Effect<SazedSyncOutput, SazedError>
  readonly checkStatus: (
    epicKey: string,
  ) => Effect.Effect<SazedStatusOutput, SazedError>
  readonly listNotes: () => Effect.Effect<SazedNotesListOutput, SazedError>
  readonly searchNotes: (
    query: string,
  ) => Effect.Effect<SazedNotesListOutput, SazedError>
}

export class SazedService extends Context.Tag("@dalinar/SazedService")<
  SazedService,
  SazedServiceShape
>() {}

function resolveSazedRoot(): string {
  const dalinarRoot = process.env.DALINAR_ROOT ?? process.cwd()
  return resolve(dalinarRoot, "modules/sazed")
}

function sazedCli(): string {
  return resolve(resolveSazedRoot(), "packages/cli/src/main.ts")
}

const makeSazed = Effect.gen(function* () {
  const subprocess = yield* SubprocessService

  const runSazed = (args: string[], env?: Record<string, string | undefined>) =>
    subprocess
      .run(sazedCli(), {
        args,
        cwd: resolveSazedRoot(),
        nothrow: true,
        env,
      })
      .pipe(
        Effect.mapError(
          (e) =>
            new SazedError({
              message: `Sazed command failed: ${e.message}`,
              cause: e,
            }),
        ),
      )

  /** Extract last JSON line from mixed stdout (Effect logs may precede the envelope). */
  const extractJson = (stdout: string): string => {
    const lines = stdout.trim().split("\n")
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (line.startsWith("{")) return line
    }
    return stdout
  }

  const decodeSazed = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
    (stdout: string) => {
      const Envelope = Schema.parseJson(
        Schema.Struct({
          contractVersion: Schema.String,
          data: schema,
        }),
      )
      return Schema.decodeUnknown(Envelope)(extractJson(stdout)).pipe(
        Effect.tap((envelope) =>
          envelope.contractVersion !== SAZED_CONTRACT_VERSION
            ? Effect.logWarning(
                `Sazed contract version mismatch: expected ${SAZED_CONTRACT_VERSION}, got ${envelope.contractVersion}`,
              )
            : Effect.void,
        ),
        Effect.map((envelope) => envelope.data),
        Effect.mapError(
          (e) =>
            new SazedError({
              message: `Failed to decode Sazed output: ${e.message}`,
            }),
        ),
      )
    }

  const analyze: SazedServiceShape["analyze"] = (opts) =>
    Effect.gen(function* () {
      const args: string[] = ["analyze", opts.epicKey, "--json"]
      if (opts.force) args.push("--force")
      if (opts.notes) args.push("--notes")
      if (opts.noMap) args.push("--no-map")
      if (opts.noCache) args.push("--no-cache")
      if (opts.forensics) args.push("--forensics")

      const env = opts.context ? { DALINAR_CONTEXT: opts.context } : undefined
      const result = yield* runSazed(args, env)

      if (result.exitCode !== 0) {
        return yield* new SazedError({
          message: `Analysis failed: ${result.stderr}`,
          epicKey: opts.epicKey,
        })
      }

      return yield* decodeSazed(SazedAnalyzeOutput)(result.stdout)
    })

  const syncToJira: SazedServiceShape["syncToJira"] = (opts) =>
    Effect.gen(function* () {
      const args: string[] = ["sync", opts.epicKey, "--json"]
      if (opts.dryRun) args.push("--dry-run")

      const result = yield* runSazed(args)

      if (result.exitCode !== 0) {
        return yield* new SazedError({
          message: `Sync failed: ${result.stderr}`,
          epicKey: opts.epicKey,
        })
      }

      return yield* decodeSazed(SazedSyncOutput)(result.stdout)
    })

  const checkStatus: SazedServiceShape["checkStatus"] = (epicKey) =>
    Effect.gen(function* () {
      const result = yield* runSazed(["status", epicKey, "--json"])

      if (result.exitCode !== 0) {
        return yield* new SazedError({
          message: `Status check failed: ${result.stderr}`,
          epicKey,
        })
      }

      return yield* decodeSazed(SazedStatusOutput)(result.stdout)
    })

  const listNotes: SazedServiceShape["listNotes"] = () =>
    Effect.gen(function* () {
      const result = yield* runSazed(["notes", "list", "--json"])

      if (result.exitCode !== 0) {
        return yield* new SazedError({
          message: `Notes list failed: ${result.stderr}`,
        })
      }

      return yield* decodeSazed(SazedNotesListOutput)(result.stdout)
    })

  const searchNotes: SazedServiceShape["searchNotes"] = (query) =>
    Effect.gen(function* () {
      const result = yield* runSazed(["notes", "search", query, "--json"])

      if (result.exitCode !== 0) {
        return yield* new SazedError({
          message: `Notes search failed: ${result.stderr}`,
        })
      }

      return yield* decodeSazed(SazedNotesListOutput)(result.stdout)
    })

  return {
    analyze,
    syncToJira,
    checkStatus,
    listNotes,
    searchNotes,
  } satisfies SazedServiceShape
})

export const SazedServiceLive = Layer.effect(SazedService, makeSazed)

// ── Hoid Service ───────────────────────────────────────────────────

export interface CalendarListOptions {
  from?: string
  to?: string
  days?: number
  account?: string
}

export interface FreeSlotsOptions {
  from?: string
  to?: string
  days?: number
  minDuration?: number
  workingHours?: string
  account?: string
}

export interface CreateEventOptions {
  account?: string
  title: string
  start: string
  end: string
  description?: string
  location?: string
}

export interface MoveEventOptions {
  eventId: string
  source: string
  newStart: string
  newEnd: string
  target?: string
}

export interface ConflictsOptions {
  from?: string
  to?: string
  days?: number
  account?: string
}

export interface HoidServiceShape {
  readonly listEvents: (
    opts?: CalendarListOptions,
  ) => Effect.Effect<string, HoidError>
  readonly freeSlots: (
    opts?: FreeSlotsOptions,
  ) => Effect.Effect<string, HoidError>
  readonly createEvent: (
    opts: CreateEventOptions,
  ) => Effect.Effect<string, HoidError>
  readonly moveEvent: (
    opts: MoveEventOptions,
  ) => Effect.Effect<string, HoidError>
  readonly conflicts: (
    opts?: ConflictsOptions,
  ) => Effect.Effect<string, HoidError>
}

export class HoidService extends Context.Tag("@dalinar/HoidService")<
  HoidService,
  HoidServiceShape
>() {}

function resolveHoidRoot(): string {
  return (
    process.env.HOID_ROOT ??
    resolve(process.env.DALINAR_ROOT ?? process.cwd(), "modules/hoid")
  )
}

function hoidCliScript(name: string): string {
  return resolve(resolveHoidRoot(), `packages/cli/src/${name}.ts`)
}

const makeHoid = Effect.gen(function* () {
  const subprocess = yield* SubprocessService

  const runHoid = (script: string, args: string[]) =>
    subprocess
      .run(hoidCliScript(script), { args, nothrow: true })
      .pipe(
        Effect.mapError(
          (e) =>
            new HoidError({
              message: `Hoid command failed: ${e.message}`,
              operation: script,
              cause: e,
            }),
        ),
      )

  const buildCalendarArgs = (
    opts: CalendarListOptions | FreeSlotsOptions | ConflictsOptions = {},
  ): string[] => {
    const args: string[] = ["--json"]
    if (opts.from) args.push("--from", opts.from)
    if (opts.to) args.push("--to", opts.to)
    if (opts.days) args.push("--days", String(opts.days))
    if (opts.account) args.push("--account", opts.account)
    return args
  }

  const listEvents: HoidServiceShape["listEvents"] = (opts = {}) =>
    Effect.gen(function* () {
      const result = yield* runHoid("calendar-list", buildCalendarArgs(opts))
      if (result.exitCode !== 0) {
        yield* Effect.logWarning(`Hoid listEvents failed: ${result.stderr}`)
        return "[]"
      }
      return result.stdout
    })

  const freeSlots: HoidServiceShape["freeSlots"] = (opts = {}) =>
    Effect.gen(function* () {
      const args = buildCalendarArgs(opts)
      if (opts?.minDuration)
        args.push("--min-duration", String(opts.minDuration))
      if (opts?.workingHours)
        args.push("--working-hours", opts.workingHours)

      const result = yield* runHoid("calendar-free-slots", args)
      if (result.exitCode !== 0) {
        yield* Effect.logWarning(`Hoid freeSlots failed: ${result.stderr}`)
        return "[]"
      }
      return result.stdout
    })

  const createEvent: HoidServiceShape["createEvent"] = (opts) =>
    Effect.gen(function* () {
      const args: string[] = [
        "--json",
        "--title",
        opts.title,
        "--start",
        opts.start,
        "--end",
        opts.end,
      ]
      if (opts.account) args.push("--account", opts.account)
      if (opts.description) args.push("--description", opts.description)
      if (opts.location) args.push("--location", opts.location)

      const result = yield* runHoid("calendar-create", args)
      if (result.exitCode !== 0) {
        return yield* new HoidError({
          message: `createEvent failed: ${result.stderr}`,
          operation: "createEvent",
        })
      }
      return result.stdout
    })

  const moveEvent: HoidServiceShape["moveEvent"] = (opts) =>
    Effect.gen(function* () {
      const args: string[] = [
        "--json",
        "--event-id",
        opts.eventId,
        "--source",
        opts.source,
        "--new-start",
        opts.newStart,
        "--new-end",
        opts.newEnd,
      ]
      if (opts.target) args.push("--target", opts.target)

      const result = yield* runHoid("calendar-move", args)
      if (result.exitCode !== 0) {
        return yield* new HoidError({
          message: `moveEvent failed: ${result.stderr}`,
          operation: "moveEvent",
        })
      }
      return result.stdout
    })

  const conflicts: HoidServiceShape["conflicts"] = (opts = {}) =>
    Effect.gen(function* () {
      const result = yield* runHoid(
        "calendar-conflicts",
        buildCalendarArgs(opts),
      )
      if (result.exitCode !== 0) {
        yield* Effect.logWarning(`Hoid conflicts failed: ${result.stderr}`)
        return "[]"
      }
      return result.stdout
    })

  return {
    listEvents,
    freeSlots,
    createEvent,
    moveEvent,
    conflicts,
  } satisfies HoidServiceShape
})

export const HoidServiceLive = Layer.effect(HoidService, makeHoid)

// ── Project Root ────────────────────────────────────────────────

export class ProjectRoot extends Context.Tag("@dalinar/ProjectRoot")<
  ProjectRoot,
  { readonly root: string }
>() {}

export const ProjectRootLive = (root: string) =>
  Layer.succeed(ProjectRoot, { root })
