import { Context, Duration, Effect, Layer, Schema } from "effect"
import { JasnahError, SazedError, HoidError } from "./errors.js"
import { SubprocessService } from "./subprocess.js"
import {
  resolveJasnahScript,
  resolveSazedRoot,
  resolveSazedCli,
  resolveHoidScript,
} from "./paths.js"
import {
  SazedAnalyzeOutput,
  SazedSyncOutput,
  SazedStatusOutput,
  SazedNotesListOutput,
  SAZED_CONTRACT_VERSION,
  checkVersionCompat,
} from "@dalinar/protocol"
import type {
  CalendarListOutput,
  FreeSlotsOutput,
  CalendarEvent,
  ConflictsOutput,
} from "./hoid-schemas.js"
import {
  CalendarListOutput as CalendarListSchema,
  FreeSlotsOutput as FreeSlotsSchema,
  CalendarEvent as CalendarEventSchema,
  ConflictsOutput as ConflictsSchema,
} from "./hoid-schemas.js"

// ── JSON extraction ──────────────────────────────────────────────

/**
 * Extract the first complete JSON object or array from a string that
 * may contain leading/trailing non-JSON content (e.g. log lines
 * leaking to stdout in --json mode).
 *
 * Tries each candidate `{` or `[` position and returns the first
 * balanced extraction that parses as valid JSON.
 */
export function extractJsonEnvelope(raw: string): string {
  const trimmed = raw.trim()

  // Fast path: already clean JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { JSON.parse(trimmed); return trimmed } catch { /* fall through */ }
  }

  // Scan for each potential JSON start
  for (let pos = 0; pos < trimmed.length; pos++) {
    const ch = trimmed[pos]
    if (ch !== "{" && ch !== "[") continue

    const candidate = extractBalanced(trimmed, pos)
    if (candidate !== null) {
      try { JSON.parse(candidate); return candidate } catch { /* try next */ }
    }
  }

  return trimmed
}

function extractBalanced(s: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (escape) { escape = false; continue }
    if (ch === "\\") { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === "{" || ch === "[") depth++
    if (ch === "}" || ch === "]") depth--
    if (depth === 0) return s.slice(start, i + 1)
  }

  return null
}

// ── Sazed Envelope schema factory ────────────────────────────────

export const SazedEnvelope = <A extends Schema.Schema.AnyNoContext>(dataSchema: A) =>
  Schema.parseJson(
    Schema.Struct({
      contractVersion: Schema.String,
      data: dataSchema,
    }),
  )

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
      const scriptPath = resolveJasnahScript("search-memory.ts")

      const args: string[] = [opts.query]
      if (opts.type) args.push("--type", opts.type)
      if (opts.limit) args.push("--limit", String(opts.limit))
      if (opts.tags) {
        for (const tag of opts.tags) args.push("--tag", tag)
      }
      if (opts.root) args.push("--root", opts.root)

      const result = yield* subprocess
        .run(scriptPath, { args, nothrow: true, timeout: "15 seconds" })
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

      const scriptPath = resolveJasnahScript("extract-inline.ts")

      const args: string[] = []
      if (opts.root) args.push("--root", opts.root)
      if (opts.source) args.push("--source", opts.source)
      if (opts.dryRun) args.push("--dry-run")

      const result = yield* subprocess
        .run(scriptPath, {
          args,
          stdin: JSON.stringify(entries),
          nothrow: true,
          timeout: "30 seconds",
        })
        .pipe(
          Effect.mapError(
            (e) =>
              new JasnahError({
                message: "Memory extraction failed",
                operation: "extractMemories",
                cause: e,
              }),
          ),
        )

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

const makeSazed = Effect.gen(function* () {
  const subprocess = yield* SubprocessService

  const runSazed = (args: string[], env?: Record<string, string | undefined>) =>
    subprocess
      .run(resolveSazedCli(), {
        args,
        cwd: resolveSazedRoot(),
        nothrow: true,
        timeout: "120 seconds",
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

  const decodeSazed = <A, I>(schema: Schema.Schema<A, I, never>) =>
    (stdout: string) => {
      const Envelope = SazedEnvelope(schema)
      const cleaned = extractJsonEnvelope(stdout)
      return Schema.decodeUnknown(Envelope)(cleaned).pipe(
        Effect.tap((envelope) => {
          const compat = checkVersionCompat(SAZED_CONTRACT_VERSION, envelope.contractVersion)
          return compat === "major-mismatch"
            ? Effect.fail(
                new SazedError({
                  message: `Incompatible Sazed contract version: ${envelope.contractVersion}`,
                }),
              )
            : compat === "minor-drift"
              ? Effect.logWarning(
                  `Sazed contract version drift: ${envelope.contractVersion} (expected ${SAZED_CONTRACT_VERSION})`,
                )
              : Effect.void
        }),
        Effect.map((envelope) => envelope.data),
        Effect.mapError(
          (e) =>
            new SazedError({
              message: `Failed to decode Sazed output: ${e.message}`,
            }),
        ),
      )
    }

  const runAndDecode = <A, I>(
    args: string[],
    schema: Schema.Schema<A, I, never>,
    errorContext: string,
    opts?: { epicKey?: string; env?: Record<string, string | undefined> | undefined },
  ) =>
    runSazed(args, opts?.env).pipe(
      Effect.filterOrFail(
        (r) => r.exitCode === 0,
        (r) => new SazedError({ message: `${errorContext} failed: ${r.stderr}`, epicKey: opts?.epicKey }),
      ),
      Effect.flatMap((r) => decodeSazed(schema)(r.stdout)),
    )

  const analyze: SazedServiceShape["analyze"] = (opts) => {
    const args: string[] = ["analyze", opts.epicKey, "--json"]
    if (opts.force) args.push("--force")
    if (opts.notes) args.push("--notes")
    if (opts.noMap) args.push("--no-map")
    if (opts.noCache) args.push("--no-cache")
    if (opts.forensics) args.push("--forensics")

    const env = opts.context ? { DALINAR_CONTEXT: opts.context } : undefined
    return runAndDecode(args, SazedAnalyzeOutput, "Analysis", { epicKey: opts.epicKey, env })
  }

  const syncToJira: SazedServiceShape["syncToJira"] = (opts) => {
    const args: string[] = ["sync", opts.epicKey, "--json"]
    if (opts.dryRun) args.push("--dry-run")
    return runAndDecode(args, SazedSyncOutput, "Sync", { epicKey: opts.epicKey })
  }

  const checkStatus: SazedServiceShape["checkStatus"] = (epicKey) =>
    runAndDecode(["status", epicKey, "--json"], SazedStatusOutput, "Status check", { epicKey })

  const listNotes: SazedServiceShape["listNotes"] = () =>
    runAndDecode(["notes", "list", "--json"], SazedNotesListOutput, "Notes list")

  const searchNotes: SazedServiceShape["searchNotes"] = (query) =>
    runAndDecode(["notes", "search", query, "--json"], SazedNotesListOutput, "Notes search")

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
  ) => Effect.Effect<CalendarListOutput, HoidError>
  readonly freeSlots: (
    opts?: FreeSlotsOptions,
  ) => Effect.Effect<FreeSlotsOutput, HoidError>
  readonly createEvent: (
    opts: CreateEventOptions,
  ) => Effect.Effect<CalendarEvent, HoidError>
  readonly moveEvent: (
    opts: MoveEventOptions,
  ) => Effect.Effect<CalendarEvent, HoidError>
  readonly conflicts: (
    opts?: ConflictsOptions,
  ) => Effect.Effect<ConflictsOutput, HoidError>
}

export class HoidService extends Context.Tag("@dalinar/HoidService")<
  HoidService,
  HoidServiceShape
>() {}

const makeHoid = Effect.gen(function* () {
  const subprocess = yield* SubprocessService

  const runHoid = (script: string, args: string[], timeout: Duration.DurationInput = "15 seconds") =>
    subprocess
      .run(resolveHoidScript(script), { args, nothrow: true, timeout })
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

  const decodeHoid = <A, I>(schema: Schema.Schema<A, I, never>, operation: string) =>
    (stdout: string) =>
      Schema.decodeUnknown(Schema.parseJson(schema))(extractJsonEnvelope(stdout)).pipe(
        Effect.mapError(
          (e) =>
            new HoidError({
              message: `Failed to decode Hoid ${operation} output: ${e.message}`,
              operation,
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

  const runAndDecode = <A, I>(
    script: string,
    args: string[],
    schema: Schema.Schema<A, I, never>,
    operation: string,
    opts?: { timeout?: Duration.DurationInput },
  ) =>
    runHoid(script, args, opts?.timeout).pipe(
      Effect.filterOrFail(
        (r) => r.exitCode === 0,
        (r) => new HoidError({ message: `${operation} failed: ${r.stderr}`, operation }),
      ),
      Effect.flatMap((r) => decodeHoid(schema, operation)(r.stdout)),
    )

  const listEvents: HoidServiceShape["listEvents"] = (opts = {}) =>
    runAndDecode("calendar-list", buildCalendarArgs(opts), CalendarListSchema, "listEvents")

  const freeSlots: HoidServiceShape["freeSlots"] = (opts = {}) => {
    const args = buildCalendarArgs(opts)
    if (opts?.minDuration)
      args.push("--min-duration", String(opts.minDuration))
    if (opts?.workingHours)
      args.push("--working-hours", opts.workingHours)
    return runAndDecode("calendar-free-slots", args, FreeSlotsSchema, "freeSlots")
  }

  const createEvent: HoidServiceShape["createEvent"] = (opts) => {
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
    return runAndDecode("calendar-create", args, CalendarEventSchema, "createEvent", { timeout: "30 seconds" })
  }

  const moveEvent: HoidServiceShape["moveEvent"] = (opts) => {
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
    return runAndDecode("calendar-move", args, CalendarEventSchema, "moveEvent", { timeout: "30 seconds" })
  }

  const conflicts: HoidServiceShape["conflicts"] = (opts = {}) =>
    runAndDecode("calendar-conflicts", buildCalendarArgs(opts), ConflictsSchema, "conflicts")

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
