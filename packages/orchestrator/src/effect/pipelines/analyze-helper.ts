import { Effect, RateLimiter, Schema } from "effect"
import { FileSystem } from "@effect/platform"
import { JasnahService, SazedService, type ExtractEntry, type DatastoreOptions } from "../services.js"
import type { SazedAnalyzeOutput } from "@dalinar/protocol"
import { JiraService } from "../services/jira.js"
import { JiraComment, JiraTask } from "../jira-schemas.js"

// ── Extraction rules ──────────────────────────────────────────────
// Each rule is a pure function: SazedAnalyzeOutput → ExtractEntry[].
// Rules are composed by priority — lower = higher priority for budget.

const MAX_NOTES = 15

interface ExtractionCtx {
  readonly epicKey: string
  readonly taskKey?: string | undefined
  readonly enrichedTickets?: ReadonlyMap<string, JiraTask>
}

interface ExtractionRule {
  readonly name: string
  readonly priority: number
  readonly extract: (output: SazedAnalyzeOutput, ctx: ExtractionCtx) => ExtractEntry[]
}

const baseTags = (ctx: ExtractionCtx): string[] => {
  const tags = [ctx.epicKey.toLowerCase()]
  if (ctx.taskKey) tags.push(ctx.taskKey.toLowerCase())
  return tags
}

const notesRule: ExtractionRule = {
  name: "notes",
  priority: 0,
  extract: (output, ctx) => {
    const tags = baseTags(ctx)
    const entries: ExtractEntry[] = []
    for (const note of output.notes) {
      if (note.content.length < 30) continue
      entries.push({
        type: note.type,
        summary: note.title.slice(0, 100),
        content: note.content.slice(0, 2000),
        tags: [...tags, ...note.tags.slice(0, 2)],
        confidence: "high",
      })
    }
    return entries
  },
}

const contextSummaryRule: ExtractionRule = {
  name: "contextSummary",
  priority: 1,
  extract: (output, ctx) => {
    if (output.contextSummary.length <= 50) return []
    return [{
      type: "architecture",
      summary: `Architecture context for ${ctx.epicKey}`.slice(0, 100),
      content: output.contextSummary.slice(0, 2000),
      tags: baseTags(ctx),
      confidence: "medium" as const,
    }]
  },
}

const acceptanceCriteriaRule: ExtractionRule = {
  name: "acceptanceCriteria",
  priority: 2,
  extract: (output, ctx) => {
    const entries: ExtractEntry[] = []
    for (const task of output.tasks) {
      if (task.acceptanceCriteria.length === 0) continue
      const criteria = task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
      entries.push({
        type: "domain-fact",
        summary: `Acceptance criteria for ${task.id}: ${task.title}`.slice(0, 100),
        content: criteria.slice(0, 2000),
        tags: [...baseTags(ctx), task.id.toLowerCase()],
        confidence: "high",
      })
    }
    return entries
  },
}

const communicationFlowRule: ExtractionRule = {
  name: "communicationFlow",
  priority: 3,
  extract: (output, ctx) => {
    if (!output.communicationFlow.applicable || !output.communicationFlow.mermaidDiagram) return []
    return [{
      type: "api-contract",
      summary: `Communication flow for ${ctx.epicKey}`.slice(0, 100),
      content: output.communicationFlow.mermaidDiagram.slice(0, 2000),
      tags: [...baseTags(ctx), "communication-flow"],
      confidence: "medium" as const,
    }]
  },
}

const integrationPointsRule: ExtractionRule = {
  name: "integrationPoints",
  priority: 4,
  extract: (output, ctx) => {
    const allPoints = new Set<string>()
    for (const task of output.tasks) {
      for (const point of task.technicalDefinition.integrationPoints) {
        allPoints.add(point)
      }
    }
    if (allPoints.size === 0) return []
    const content = [...allPoints].map((p, i) => `${i + 1}. ${p}`).join("\n")
    return [{
      type: "architecture",
      summary: `Integration points for ${ctx.epicKey}`.slice(0, 100),
      content: content.slice(0, 2000),
      tags: [...baseTags(ctx), "integration-points"],
      confidence: "medium" as const,
    }]
  },
}

const impactSummaryRule: ExtractionRule = {
  name: "impactSummary",
  priority: 5,
  extract: (output, ctx) => {
    if (!output.impactSummary) return []
    const s = output.impactSummary
    const lines = [
      `Files analyzed: ${s.filesAnalyzed}`,
      `Direct invariants: ${s.directInvariants}`,
      `Related invariants: ${s.relatedInvariants}`,
    ]
    if (s.datastoreConstraints !== undefined) lines.push(`Datastore constraints: ${s.datastoreConstraints}`)
    if (s.datastoreProvider) lines.push(`Provider: ${s.datastoreProvider}`)
    if (s.datastoreTargets) lines.push(`Targets: ${s.datastoreTargets.join(", ")}`)
    return [{
      type: "domain-fact",
      summary: `Impact analysis for ${ctx.epicKey}`.slice(0, 100),
      content: lines.join("\n"),
      tags: [...baseTags(ctx), "impact-analysis"],
      confidence: "medium" as const,
    }]
  },
}

const diffFromPreviousRule: ExtractionRule = {
  name: "diffFromPrevious",
  priority: 6,
  extract: (output, ctx) => {
    if (!output.diffFromPrevious) return []
    return [{
      type: "lesson-learned",
      summary: `Analysis diff for ${ctx.epicKey}`.slice(0, 100),
      content: output.diffFromPrevious.slice(0, 2000),
      tags: [...baseTags(ctx), "analysis-diff"],
      confidence: "low" as const,
    }]
  },
}

const forensicsRule: ExtractionRule = {
  name: "forensics",
  priority: 7,
  extract: (output, ctx) => {
    if (!output.forensicsSummary) return []
    const fs = output.forensicsSummary
    if (fs.bugIntroductions.length === 0) return []
    const lines = [`Total commits analyzed: ${fs.totalCommitsAnalyzed}`, `Hotspots: ${fs.hotspotCount}`, ""]
    for (const bug of fs.bugIntroductions.slice(0, 10)) {
      let line = `- ${bug.filePath}: ${bug.bugFixCount} bug fixes`
      if (bug.jiraTickets.length > 0) {
        const ticketDetails = bug.jiraTickets.map(key => {
          const ticket = ctx.enrichedTickets?.get(key)
          return ticket ? `${key} (${ticket.summary})` : key
        })
        line += ` [${ticketDetails.join(", ")}]`
      }
      lines.push(line)
    }

    return [{
      type: "lesson-learned",
      summary: `Forensics: ${fs.bugIntroductions.length} bug-prone files in ${ctx.epicKey}`.slice(0, 100),
      content: lines.join("\n").slice(0, 2000),
      tags: [...baseTags(ctx), "forensics"],
      confidence: "medium" as const,
    }]
  },
}

const ticketCommentsRule: ExtractionRule = {
  name: "ticketComments",
  priority: 8,
  extract: (_output, ctx) => {
    if (!ctx.enrichedTickets || ctx.enrichedTickets.size === 0) return []
    const entries: ExtractEntry[] = []
    for (const [key, ticket] of ctx.enrichedTickets) {
      const comments = ticket.comments ?? []
      if (comments.length === 0) continue
      const commentLines = comments
        .slice(0, 20)
        .map(c => `- ${c.author ?? "unknown"} (${c.created.split("T")[0]}): ${c.body.slice(0, 300)}`)
      entries.push({
        type: "domain-fact",
        summary: `Ticket comments: ${key} — ${ticket.summary}`.slice(0, 100),
        content: commentLines.join("\n").slice(0, 2000),
        tags: [...baseTags(ctx), "ticket-comments", key.toLowerCase()],
        confidence: "medium" as const,
      })
    }
    return entries
  },
}

const ALL_RULES: ReadonlyArray<ExtractionRule> = [
  notesRule,
  contextSummaryRule,
  acceptanceCriteriaRule,
  communicationFlowRule,
  integrationPointsRule,
  impactSummaryRule,
  diffFromPreviousRule,
  forensicsRule,
  ticketCommentsRule,
]

function structuredNotesToEntries(
  output: SazedAnalyzeOutput,
  ctx: ExtractionCtx,
): ExtractEntry[] {
  const allEntries = ALL_RULES
    .toSorted((a, b) => a.priority - b.priority)
    .flatMap(rule => rule.extract(output, ctx))

  if (allEntries.length <= MAX_NOTES) return allEntries

  allEntries.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return (order[a.confidence] ?? 2) - (order[b.confidence] ?? 2)
  })
  return allEntries.slice(0, MAX_NOTES)
}

// ── Jira ticket cache ─────────────────────────────────────────────
// Persistent file-backed cache at .cache/jira-tickets.json.
// Never expires — use `dalinar cache clear --jira` to invalidate.

const JiraCacheCommentEntry = Schema.Struct({
  id: Schema.String,
  author: Schema.optional(Schema.String),
  body: Schema.String,
  created: Schema.String,
})

const JiraCacheEntry = Schema.Struct({
  key: Schema.String,
  summary: Schema.String,
  status: Schema.String,
  issueType: Schema.String,
  fetchedAt: Schema.String,
  comments: Schema.Array(JiraCacheCommentEntry),
})

const JiraCacheFile = Schema.Struct({
  version: Schema.Literal(2),
  tickets: Schema.Array(JiraCacheEntry),
})

type JiraCacheEntryType = typeof JiraCacheEntry.Type

const CACHE_PATH = ".cache/jira-tickets.json"

const loadJiraCache = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = `${root}/${CACHE_PATH}`
    const raw = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""))
    if (!raw) return new Map<string, JiraCacheEntryType>()
    const decoded = yield* Schema.decodeUnknown(Schema.parseJson(JiraCacheFile))(raw).pipe(
      Effect.orElseSucceed(() => ({ version: 2 as const, tickets: [] })),
    )
    return new Map(decoded.tickets.map(t => [t.key, t]))
  })

const saveJiraCache = (root: string, cache: Map<string, JiraCacheEntryType>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const dir = `${root}/.cache`
    const path = `${root}/${CACHE_PATH}`
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(
      Effect.catchAll((e) => Effect.logDebug(`Jira cache dir creation failed: ${e.message}`)),
    )
    const data = { version: 2 as const, tickets: [...cache.values()] }
    const json = yield* Schema.encode(Schema.parseJson(JiraCacheFile))(data).pipe(
      Effect.orElse(() => Effect.succeed(JSON.stringify(data, null, 2))),
    )
    yield* fs.writeFileString(path, json).pipe(
      Effect.catchAll((e) => Effect.logDebug(`Jira cache write failed: ${e.message}`)),
    )
  })

// ── Jira enrichment ──────────────────────────────────────────────
// Fetches Jira ticket details for the epic, task, and forensics keys.
// Uses persistent cache + rate limiter. Gracefully degrades.

const JIRA_RATE_LIMIT = Math.max(1, Number(process.env.JIRA_RATE_LIMIT ?? 5)) || 5

const taskToCacheEntry = (task: JiraTask): JiraCacheEntryType => ({
  key: task.key,
  summary: task.summary,
  status: task.status,
  issueType: task.issueType,
  fetchedAt: new Date().toISOString(),
  comments: (task.comments ?? []).map(c => ({
    id: c.id,
    author: c.author,
    body: c.body,
    created: c.created,
  })),
})

const cacheEntryToTask = (entry: JiraCacheEntryType): JiraTask =>
  new JiraTask({
    key: entry.key,
    summary: entry.summary,
    status: entry.status,
    issueType: entry.issueType,
    comments: entry.comments.map(c => new JiraComment({
      id: c.id,
      author: c.author,
      body: c.body,
      created: c.created,
    })),
  })

const enrichWithJira = (
  output: SazedAnalyzeOutput,
  root: string,
  epicKey: string,
  taskKey?: string,
) =>
  Effect.gen(function* () {
    const jira = yield* JiraService

    // Collect all keys: epic + task + forensics
    const allKeys = new Set<string>([epicKey])
    if (taskKey) allKeys.add(taskKey)
    if (output.forensicsSummary) {
      for (const b of output.forensicsSummary.bugIntroductions) {
        for (const k of b.jiraTickets) allKeys.add(k)
      }
    }

    // Load persistent cache
    const cache = yield* loadJiraCache(root)
    // Treat entries with no comments as stale (pre-comments-support cache entries)
    const uncachedKeys = [...allKeys].filter(k => {
      const entry = cache.get(k)
      return !entry || entry.comments.length === 0
    })

    yield* Effect.logInfo("Jira enrichment").pipe(
      Effect.annotateLogs({
        totalKeys: String(allKeys.size),
        cached: String(allKeys.size - uncachedKeys.length),
        toFetch: String(uncachedKeys.length),
      }),
    )

    // Fetch uncached tickets with rate limiting
    if (uncachedKeys.length > 0) {
      const limiter = yield* RateLimiter.make({ limit: JIRA_RATE_LIMIT, interval: "1 seconds" })

      const fetched = yield* Effect.forEach(
        uncachedKeys,
        (key) =>
          limiter(
            jira.fetchTask(key).pipe(
              Effect.map(task => [key, task] as const),
              Effect.tapError((e) => Effect.logWarning(`Jira fetchTask failed for ${key}: ${e.message}`)),
              Effect.orElseSucceed(() => [key, null] as const),
            ),
          ),
        { concurrency: JIRA_RATE_LIMIT },
      )

      for (const [key, task] of fetched) {
        if (task) cache.set(key, taskToCacheEntry(task))
      }

      yield* saveJiraCache(root, cache)
    }

    // Convert cache entries to JiraTask map
    const result = new Map<string, JiraTask>()
    for (const key of allKeys) {
      const entry = cache.get(key)
      if (entry) result.set(key, cacheEntryToTask(entry))
    }
    return result
  }).pipe(
    Effect.scoped,
    Effect.catchAll((e) =>
      Effect.logWarning(`Jira enrichment failed, continuing without: ${e}`).pipe(
        Effect.map(() => new Map<string, JiraTask>()),
      ),
    ),
  )

// ── Shared analysis helper ────────────────────────────────────────
// Reusable building block for both analyzeWithContextPipeline and
// deepAnalyzePipeline. Handles: Jasnah search → format context →
// Sazed analysis → extract notes back to Jasnah.

export interface AnalyzeTaskOptions {
  readonly epicKey: string
  readonly taskKey?: string | undefined
  /** Extra context (e.g. sibling retrospectives) appended to Jasnah context */
  readonly extraContext?: string | undefined
  readonly root?: string | undefined
  readonly force?: boolean | undefined
  readonly notes?: boolean | undefined
  readonly noMap?: boolean | undefined
  readonly noCache?: boolean | undefined
  readonly forensics?: boolean | undefined
  readonly datastore?: DatastoreOptions | undefined
}

export interface AnalyzeTaskResult {
  readonly markdown: string
  readonly memoriesUsed: number
  readonly notesExtracted: number
}

/**
 * Search Jasnah → format context → run Sazed → extract notes.
 * Does NOT do vault sync or key resolution — those are pipeline concerns.
 */
export const analyzeTask = (opts: AnalyzeTaskOptions) =>
  Effect.gen(function* () {
    const jasnah = yield* JasnahService
    const sazed = yield* SazedService

    // Step 1: Search Jasnah for prior context
    yield* Effect.logInfo("Searching Jasnah for prior context")
    const memories = yield* jasnah
      .searchContextForEpic(opts.epicKey, opts.root)
      .pipe(Effect.withLogSpan("jasnah-search"))

    // Cap at 10 results
    const capped = [...memories]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)

    yield* Effect.logInfo("Prior context loaded").pipe(
      Effect.annotateLogs({ count: String(capped.length) }),
    )

    // Step 2: Build context block
    let contextBlock: string | undefined
    if (capped.length > 0) {
      contextBlock = yield* jasnah.formatContextForPrompt(capped)
    }

    // Append extra context (e.g. sibling retros)
    if (opts.extraContext) {
      contextBlock = [contextBlock, opts.extraContext].filter(Boolean).join("\n\n")
    }

    // Step 3: Run Sazed analysis (returns structured JSON, errors via error channel)
    if (opts.datastore?.introspect) {
      yield* Effect.logInfo("Datastore introspection enabled").pipe(
        Effect.annotateLogs({
          provider: opts.datastore.provider ?? "relational",
          ...(opts.datastore.env ? { env: opts.datastore.env } : {}),
          ...(opts.datastore.targets ? { targets: opts.datastore.targets } : {}),
          ...(opts.datastore.noCache ? { noDatastoreCache: "true" } : {}),
        }),
      )
    }
    yield* Effect.logInfo("Starting Sazed analysis")
    const result = yield* sazed
      .analyze({
        epicKey: opts.epicKey,
        context: contextBlock,
        force: opts.force,
        notes: opts.notes,
        noMap: opts.noMap,
        noCache: opts.noCache,
        forensics: opts.forensics,
        datastore: opts.datastore,
      })
      .pipe(
        Effect.tapError((e) =>
          Effect.logError("Sazed analysis failed").pipe(
            Effect.annotateLogs({
              memoriesInjected: String(capped.length),
              contextLength: String(contextBlock?.length ?? 0),
              errorCategory: e.category ?? "unknown",
            }),
          ),
        ),
        Effect.withLogSpan("sazed-analyze"),
      )

    // Log impact summary if present
    if (result.impactSummary) {
      const s = result.impactSummary
      yield* Effect.logInfo("Impact analysis included").pipe(
        Effect.annotateLogs({
          filesAnalyzed: String(s.filesAnalyzed),
          directInvariants: String(s.directInvariants),
          relatedInvariants: String(s.relatedInvariants),
          ...(s.datastoreConstraints !== undefined ? { datastoreConstraints: String(s.datastoreConstraints) } : {}),
          ...(s.datastoreProvider ? { datastoreProvider: s.datastoreProvider } : {}),
          ...(s.datastoreTargets ? { datastoreTargets: s.datastoreTargets.join(",") } : {}),
        }),
      )
    }

    // Step 3.5: Fetch and cache Jira tickets (epic + task + forensics keys)
    const root = opts.root ?? process.cwd()
    const enrichedTickets = yield* enrichWithJira(result, root, opts.epicKey, opts.taskKey).pipe(
      Effect.withLogSpan("jira-enrichment"),
    )

    // Step 4: Extract notes back to Jasnah (structured data, no regex parsing)
    yield* Effect.logInfo("Extracting notes to Jasnah")
    const epicKey = opts.epicKey
    const taskKey = opts.taskKey
    const newNotes = structuredNotesToEntries(result, { epicKey, taskKey, enrichedTickets })

    const source = taskKey
      ? `dalinar-analyze-${epicKey}-task-${taskKey}`
      : `dalinar-analyze-${epicKey}`

    let notesExtracted = 0
    if (newNotes.length > 0) {
      const extraction = yield* jasnah
        .extractMemories(newNotes, {
          root: opts.root,
          source,
        })
        .pipe(Effect.withLogSpan("note-extraction"))
      if (extraction.success) {
        notesExtracted = newNotes.length
        yield* Effect.logInfo("Notes extracted").pipe(
          Effect.annotateLogs({ count: String(notesExtracted) }),
        )
      } else {
        yield* Effect.logWarning(`Extraction failed: ${extraction.output}`)
      }
    }

    // Append Jira ticket comments to markdown
    let markdown = result.markdown
    if (enrichedTickets.size > 0) {
      const sections: string[] = []
      for (const [key, ticket] of enrichedTickets) {
        const comments = ticket.comments ?? []
        if (comments.length === 0) continue
        const lines = comments.slice(0, 20).map(c =>
          `- **${c.author ?? "unknown"}** (${c.created.split("T")[0]}): ${c.body.slice(0, 500)}`
        )
        sections.push(`### ${key}: ${ticket.summary}\n\n${lines.join("\n")}`)
      }
      if (sections.length > 0) {
        markdown += `\n\n## Jira Ticket Comments\n\n${sections.join("\n\n")}`
      }
    }

    return {
      markdown,
      memoriesUsed: capped.length,
      notesExtracted,
    } satisfies AnalyzeTaskResult
  }).pipe(
    Effect.annotateLogs({ epicKey: opts.epicKey }),
    Effect.withLogSpan("analyze-task"),
    Effect.withSpan("analyze-task"),
  )
