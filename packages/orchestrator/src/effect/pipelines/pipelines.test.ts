import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { JasnahService, SazedService, ProjectRoot, type JasnahServiceShape, type SazedServiceShape } from "../services.js"
import { JiraService, JiraServiceLive, type JiraServiceShape } from "../services/jira.js"
import { JiraComment, JiraTask } from "../jira-schemas.js"
import { SubprocessService, type SubprocessServiceShape } from "../subprocess.js"
import { SazedError, JiraError } from "../errors.js"
import { SazedAnalyzeOutput, SazedSyncOutput, SazedStatusOutput, SazedNotesListOutput } from "@dalinar/protocol"
import { reflectPipeline, reflectionToMemories } from "./reflect.js"
import { dialecticPipeline } from "./dialectic.js"
import { analyzeWithContextPipeline } from "./analyze.js"
import { deepAnalyzePipeline, type DeepAnalyzeResult } from "./deep-analyze.js"
import { implementTicketPipeline } from "./implement.js"
import { auditPipeline, formatReport, type AuditReport } from "./audit.js"
import { getCompletedTaskEvidence, formatEvidenceAsContext } from "./retro.js"
import type { SprintReflection } from "../types/reflect.js"

// ── Test Layers ───────────────────────────────────────────────────

const TestJasnah = Layer.succeed(JasnahService, {
  searchMemories: () => Effect.succeed([]),
  searchContextForEpic: () => Effect.succeed([]),
  extractMemories: () => Effect.succeed({ success: true, output: "ok" }),
  formatContextForPrompt: () => Effect.succeed(""),
} satisfies JasnahServiceShape)

const testAnalyzeOutput = new SazedAnalyzeOutput({
  epicKey: "EPIC-1",
  epicSummary: "Test epic",
  contextSummary: "This is test context that is long enough to be extracted as a note.",
  tasks: [],
  notes: [],
  communicationFlow: { applicable: false },
  diffFromPrevious: null,
  markdown: "# Test Analysis\n\n## Context Summary\nThis is test context that is long enough to be extracted as a note.",
  basedOnCommit: "abc1234",
  createdAt: new Date().toISOString(),
})

const TestSazed = Layer.succeed(SazedService, {
  analyze: () => Effect.succeed(testAnalyzeOutput),
  syncToJira: () => Effect.succeed(new SazedSyncOutput({ created: [], updated: [], skipped: [] })),
  checkStatus: () => Effect.succeed(new SazedStatusOutput({ epicKey: "EPIC-1", basedOnCommit: "abc1234", tasks: [] })),
  listNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
  searchNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
} satisfies SazedServiceShape)

const FailingSazed = Layer.succeed(SazedService, {
  analyze: () => Effect.fail(new SazedError({ message: "analysis failed" })),
  syncToJira: () => Effect.fail(new SazedError({ message: "sync failed" })),
  checkStatus: () => Effect.fail(new SazedError({ message: "status failed" })),
  listNotes: () => Effect.fail(new SazedError({ message: "list failed" })),
  searchNotes: () => Effect.fail(new SazedError({ message: "search failed" })),
} satisfies SazedServiceShape)

const TestSubprocess = Layer.succeed(SubprocessService, {
  run: () =>
    Effect.succeed({ stdout: "", stderr: "", exitCode: 0, timedOut: false }),
})

const TestJira = Layer.succeed(JiraService, {
  resolveKey: () => Effect.succeed(null),
  fetchTask: (key) => Effect.succeed(new JiraTask({ key, summary: "", status: "Unknown", issueType: "Unknown" })),
  fetchTasksForEpic: () => Effect.succeed([]),
} satisfies JiraServiceShape)

const TestLayer = Layer.mergeAll(TestJasnah, TestSazed, TestSubprocess, TestJira, NodeFileSystem.layer)
const FailLayer = Layer.mergeAll(TestJasnah, FailingSazed, TestSubprocess, TestJira, NodeFileSystem.layer)

// ── reflect ───────────────────────────────────────────────────────

describe("reflectionToMemories (pure)", () => {
  test("empty reflection produces no entries", () => {
    const reflection: SprintReflection = {
      sprint: "sprint-1",

    }
    expect(reflectionToMemories(reflection)).toEqual([])
  })

  test("estimate corrections produce lesson-learned entries", () => {
    const reflection: SprintReflection = {
      sprint: "sprint-1",

      estimateAccuracy: [
        {
          taskDescription: "Widget refactor",
          estimatedEffort: "2 days",
          actualEffort: "5 days",
          reason: "Underestimated complexity",
        },
      ],
    }
    const entries = reflectionToMemories(reflection)
    expect(entries).toHaveLength(1)
    expect(entries[0].type).toBe("lesson-learned")
    expect(entries[0].tags).toContain("estimation")
  })

  test("anticipated blockers are excluded", () => {
    const reflection: SprintReflection = {
      sprint: "sprint-1",

      blockers: [
        {
          description: "API down",
          impact: "delayed work",
          wasAnticipated: true,
        },
        {
          description: "DB migration issue",
          impact: "blocked 2 days",
          wasAnticipated: false,
        },
      ],
    }
    const entries = reflectionToMemories(reflection)
    expect(entries).toHaveLength(1)
    expect(entries[0].summary).toContain("DB migration")
  })

  test("non-replicable wins are excluded", () => {
    const reflection: SprintReflection = {
      sprint: "sprint-1",

      wins: [
        { description: "Lucky timing", replicable: false },
        { description: "Pair programming", replicable: true },
      ],
    }
    const entries = reflectionToMemories(reflection)
    expect(entries).toHaveLength(1)
    expect(entries[0].tags).toContain("best-practice")
  })

  test("epicKeys are appended to all entry tags", () => {
    const reflection: SprintReflection = {
      sprint: "sprint-1",

      epicKeys: ["EPIC-1"],
      revisions: [
        {
          originalDecision: "Use REST",
          revision: "Use gRPC",
          reason: "Performance",
        },
      ],
    }
    const entries = reflectionToMemories(reflection)
    expect(entries[0].tags).toContain("epic-1")
  })
})

describe("reflectPipeline", () => {
  test("dry run returns entries without extraction", async () => {
    const reflection: SprintReflection = {
      sprint: "sprint-1",

      revisions: [
        {
          originalDecision: "Use REST",
          revision: "Use gRPC",
          reason: "Performance",
        },
      ],
    }

    const result = await Effect.runPromise(
      reflectPipeline(reflection, { dryRun: true }).pipe(
        Effect.provide(TestJasnah),
      ),
    )

    expect(result.entries).toHaveLength(1)
    expect(result.extractResult).toBeUndefined()
  })

  test("full run calls extractMemories", async () => {
    let extractCalled = false
    const TrackingJasnah = Layer.succeed(JasnahService, {
      searchMemories: () => Effect.succeed([]),
      searchContextForEpic: () => Effect.succeed([]),
      extractMemories: () => {
        extractCalled = true
        return Effect.succeed({ success: true, output: "extracted" })
      },
      formatContextForPrompt: () => Effect.succeed(""),
    } satisfies JasnahServiceShape)

    const reflection: SprintReflection = {
      sprint: "sprint-1",

      revisions: [
        {
          originalDecision: "A",
          revision: "B",
          reason: "C",
        },
      ],
    }

    const result = await Effect.runPromise(
      reflectPipeline(reflection, { dryRun: false }).pipe(
        Effect.provide(TrackingJasnah),
      ),
    )

    expect(extractCalled).toBe(true)
    expect(result.extractResult?.success).toBe(true)
  })

  test("empty reflection short-circuits", async () => {
    const reflection: SprintReflection = {
      sprint: "sprint-1",

    }

    const result = await Effect.runPromise(
      reflectPipeline(reflection).pipe(Effect.provide(TestJasnah)),
    )

    expect(result.entries).toHaveLength(0)
    expect(result.extractResult).toBeUndefined()
  })
})

// ── dialectic ─────────────────────────────────────────────────────

describe("dialecticPipeline", () => {
  test("generates constraints from vs-style question", async () => {
    const result = await Effect.runPromise(
      dialecticPipeline(
        { question: "REST vs gRPC for internal services?" },
      ).pipe(Effect.provide(TestJasnah)),
    )

    expect(result.constraints.constraintA).toContain("REST")
    expect(result.constraints.constraintB).toContain("gRPC")
    expect(result.prompts.positionA).toBeTruthy()
    expect(result.prompts.positionB).toBeTruthy()
  })

  test("generates constraints from should-style question", async () => {
    const result = await Effect.runPromise(
      dialecticPipeline(
        { question: "Should we migrate to Effect?" },
      ).pipe(Effect.provide(TestJasnah)),
    )

    expect(result.constraints.constraintA).toContain("DO")
    expect(result.constraints.constraintB).toContain("DO NOT")
  })

  test("uses explicit constraints when provided", async () => {
    const result = await Effect.runPromise(
      dialecticPipeline({
        question: "How to structure services?",
        constraintA: "Use monolith",
        constraintB: "Use microservices",
      }).pipe(Effect.provide(TestJasnah)),
    )

    expect(result.constraints.constraintA).toBe("Use monolith")
    expect(result.constraints.constraintB).toBe("Use microservices")
  })

  test("includes prior context when memories found", async () => {
    const JasnahWithMemories = Layer.succeed(JasnahService, {
      searchMemories: () => Effect.succeed([]),
      searchContextForEpic: () =>
        Effect.succeed([
          {
            memory_id: "m1",
            type: "architecture",
            summary: "Prior decision",
            content: "We chose REST before",
            tags: [],
            confidence: "high",
            score: 0.9,
            retention: 1.0,
          },
        ]),
      extractMemories: () => Effect.succeed({ success: true, output: "ok" }),
      formatContextForPrompt: () => Effect.succeed(""),
    } satisfies JasnahServiceShape)

    const result = await Effect.runPromise(
      dialecticPipeline(
        { question: "REST vs gRPC?" },
      ).pipe(Effect.provide(JasnahWithMemories)),
    )

    expect(result.priorContext).toContain("Prior decision")
  })
})

// ── analyze ───────────────────────────────────────────────────────

describe("analyzeWithContextPipeline", () => {
  test("successful analysis returns markdown", async () => {
    const result = await Effect.runPromise(
      analyzeWithContextPipeline({
        epicKey: "EPIC-1",
        root: "/tmp/test",
        stdout: true,
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result.markdown).toContain("Test Analysis")
    expect(result.memoriesUsed).toBe(0)
  })

  test("analysis includes Jira ticket comments in markdown", async () => {
    const JiraWithComments = Layer.succeed(JiraService, {
      resolveKey: () => Effect.succeed(null),
      fetchTask: (key) => Effect.succeed(new JiraTask({
        key,
        summary: "Test ticket",
        status: "Done",
        issueType: "Story",
        comments: [
          new JiraComment({ id: "1", author: "Alice", body: "Acceptance criteria clarified: must support batch mode", created: "2026-01-15T10:00:00Z" }),
          new JiraComment({ id: "2", author: "Bob", body: "Blocked on API v2 migration", created: "2026-01-16T10:00:00Z" }),
        ],
      })),
      fetchTasksForEpic: () => Effect.succeed([]),
    } satisfies JiraServiceShape)

    const LayerWithComments = Layer.mergeAll(TestJasnah, TestSazed, TestSubprocess, JiraWithComments, NodeFileSystem.layer)

    // Use isolated root to avoid stale cache from other tests
    const isolatedRoot = `/tmp/test-comments-${Date.now()}`
    const result = await Effect.runPromise(
      analyzeWithContextPipeline({
        epicKey: "EPIC-1",
        root: isolatedRoot,
        stdout: true,
      }).pipe(Effect.provide(LayerWithComments)),
    )

    expect(result.markdown).toContain("Jira Ticket Comments")
    expect(result.markdown).toContain("Acceptance criteria clarified")
    expect(result.markdown).toContain("Blocked on API v2 migration")
    expect(result.markdown).toContain("Alice")
  })

  test("passes task hierarchy as context to Sazed when epic has children", async () => {
    const doneTask = new JiraTask({ key: "TRK-101", summary: "Auth module", status: "Done", issueType: "Story", assignee: "Alice" })
    const progressTask = new JiraTask({ key: "TRK-102", summary: "Scheduler v2", status: "In Progress", issueType: "Task", assignee: "Bob", storyPoints: 5 })
    const todoTask = new JiraTask({ key: "TRK-103", summary: "E2E tests", status: "To Do", issueType: "Task" })

    let capturedContext: string | undefined
    const TrackingSazed = Layer.succeed(SazedService, {
      analyze: (opts) => {
        capturedContext = opts.context
        return Effect.succeed(testAnalyzeOutput)
      },
      syncToJira: () => Effect.succeed(new SazedSyncOutput({ created: [], updated: [], skipped: [] })),
      checkStatus: () => Effect.succeed(new SazedStatusOutput({ epicKey: "EPIC-1", basedOnCommit: "abc1234", tasks: [] })),
      listNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
      searchNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
    } satisfies SazedServiceShape)

    const JiraWithHierarchy = Layer.succeed(JiraService, {
      resolveKey: () => Effect.succeed(null),
      fetchTask: (key) => Effect.succeed(new JiraTask({ key, summary: "", status: "Unknown", issueType: "Unknown" })),
      fetchTasksForEpic: () => Effect.succeed([doneTask, progressTask, todoTask]),
    } satisfies JiraServiceShape)

    const layer = Layer.mergeAll(TestJasnah, TrackingSazed, TestSubprocess, JiraWithHierarchy, NodeFileSystem.layer)

    await Effect.runPromise(
      analyzeWithContextPipeline({
        epicKey: "EPIC-1",
        root: `/tmp/test-hierarchy-${Date.now()}`,
        stdout: true,
      }).pipe(Effect.provide(layer)),
    )

    // Sazed must receive the task hierarchy with binding constraints
    expect(capturedContext).toBeDefined()
    expect(capturedContext).toContain("Epic Task Structure")
    // Completed task shown as struck-through
    expect(capturedContext).toContain("~~TRK-101: Auth module~~")
    // Pending tasks listed as required plan skeleton
    expect(capturedContext).toContain("Pending Tasks")
    expect(capturedContext).toContain("TRK-102")
    expect(capturedContext).toContain("Scheduler v2")
    expect(capturedContext).toContain("5pts")
    expect(capturedContext).toContain("TRK-103")
    expect(capturedContext).toContain("E2E tests")
    // Binding constraints with exact task count and keys
    expect(capturedContext).toContain("MUST produce exactly 2 tasks")
    expect(capturedContext).toContain("TRK-102, TRK-103")
    expect(capturedContext).toContain("Do NOT invent new tasks")
  })

  test("forces re-analysis when prior context is provided", async () => {
    let capturedOpts: { force?: boolean; context?: string } | undefined
    const SpySazed = Layer.succeed(SazedService, {
      analyze: (opts) => {
        capturedOpts = opts
        return Effect.succeed(testAnalyzeOutput)
      },
      syncToJira: () => Effect.succeed(new SazedSyncOutput({ created: [], updated: [], skipped: [] })),
      checkStatus: () => Effect.succeed(new SazedStatusOutput({ epicKey: "EPIC-1", basedOnCommit: "abc1234", tasks: [] })),
      listNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
      searchNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
    } satisfies SazedServiceShape)

    const JiraWithTasks = Layer.succeed(JiraService, {
      resolveKey: () => Effect.succeed(null),
      fetchTask: (key) => Effect.succeed(new JiraTask({ key, summary: "", status: "Unknown", issueType: "Unknown" })),
      fetchTasksForEpic: () => Effect.succeed([
        new JiraTask({ key: "T-1", summary: "Task 1", status: "To Do", issueType: "Task" }),
      ]),
    } satisfies JiraServiceShape)

    const layer = Layer.mergeAll(TestJasnah, SpySazed, TestSubprocess, JiraWithTasks, NodeFileSystem.layer)

    await Effect.runPromise(
      analyzeWithContextPipeline({
        epicKey: "EPIC-1",
        root: `/tmp/test-force-${Date.now()}`,
        stdout: true,
      }).pipe(Effect.provide(layer)),
    )

    // When task hierarchy exists, context must be provided to Sazed
    expect(capturedOpts?.context).toBeDefined()
    expect(capturedOpts?.context).toContain("Epic Task Structure")
  })

  test("resolves task key to parent epic and includes both in context", async () => {
    let capturedContext: string | undefined
    const SpySazed = Layer.succeed(SazedService, {
      analyze: (opts) => {
        capturedContext = opts.context
        return Effect.succeed(testAnalyzeOutput)
      },
      syncToJira: () => Effect.succeed(new SazedSyncOutput({ created: [], updated: [], skipped: [] })),
      checkStatus: () => Effect.succeed(new SazedStatusOutput({ epicKey: "EPIC-1", basedOnCommit: "abc1234", tasks: [] })),
      listNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
      searchNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
    } satisfies SazedServiceShape)

    const JiraWithResolution = Layer.succeed(JiraService, {
      resolveKey: (key) => {
        if (key === "TRK-100") {
          return Effect.succeed({ epicKey: "TRK-50", taskKey: "TRK-100", issueType: "Task", taskSummary: "My task" })
        }
        return Effect.succeed(null)
      },
      fetchTask: (key) => Effect.succeed(new JiraTask({ key, summary: "", status: "Unknown", issueType: "Unknown" })),
      fetchTasksForEpic: (epicKey) => {
        if (epicKey === "TRK-50") {
          return Effect.succeed([
            new JiraTask({ key: "TRK-100", summary: "My task", status: "In Progress", issueType: "Task" }),
            new JiraTask({ key: "TRK-101", summary: "Done task", status: "Done", issueType: "Task" }),
          ])
        }
        return Effect.succeed([])
      },
    } satisfies JiraServiceShape)

    const layer = Layer.mergeAll(TestJasnah, SpySazed, TestSubprocess, JiraWithResolution, NodeFileSystem.layer)

    await Effect.runPromise(
      analyzeWithContextPipeline({
        epicKey: "TRK-100",
        root: `/tmp/test-resolve-${Date.now()}`,
        stdout: true,
      }).pipe(Effect.provide(layer)),
    )

    // Context should contain both the done and in-progress tasks
    expect(capturedContext).toBeDefined()
    expect(capturedContext).toContain("TRK-100")
    expect(capturedContext).toContain("My task")
    expect(capturedContext).toContain("TRK-101")
    expect(capturedContext).toContain("Done task")
    expect(capturedContext).toContain("MUST produce exactly 1 tasks")
  })

  test("skips task hierarchy when epic has no children", async () => {
    let capturedContext: string | undefined
    const SpySazed = Layer.succeed(SazedService, {
      analyze: (opts) => {
        capturedContext = opts.context
        return Effect.succeed(testAnalyzeOutput)
      },
      syncToJira: () => Effect.succeed(new SazedSyncOutput({ created: [], updated: [], skipped: [] })),
      checkStatus: () => Effect.succeed(new SazedStatusOutput({ epicKey: "EPIC-1", basedOnCommit: "abc1234", tasks: [] })),
      listNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
      searchNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
    } satisfies SazedServiceShape)

    const JiraEmpty = Layer.succeed(JiraService, {
      resolveKey: () => Effect.succeed(null),
      fetchTask: (key) => Effect.succeed(new JiraTask({ key, summary: "", status: "Unknown", issueType: "Unknown" })),
      fetchTasksForEpic: () => Effect.succeed([]),
    } satisfies JiraServiceShape)

    const layer = Layer.mergeAll(TestJasnah, SpySazed, TestSubprocess, JiraEmpty, NodeFileSystem.layer)

    await Effect.runPromise(
      analyzeWithContextPipeline({
        epicKey: "EPIC-1",
        root: `/tmp/test-no-children-${Date.now()}`,
        stdout: true,
      }).pipe(Effect.provide(layer)),
    )

    // No task hierarchy → context should not contain epic state block
    // (may still contain Jasnah memories, but not task hierarchy)
    if (capturedContext) {
      expect(capturedContext).not.toContain("Epic Task Structure")
    }
  })

  test("gracefully handles fetchTasksForEpic failure", async () => {
    let capturedContext: string | undefined
    const SpySazed = Layer.succeed(SazedService, {
      analyze: (opts) => {
        capturedContext = opts.context
        return Effect.succeed(testAnalyzeOutput)
      },
      syncToJira: () => Effect.succeed(new SazedSyncOutput({ created: [], updated: [], skipped: [] })),
      checkStatus: () => Effect.succeed(new SazedStatusOutput({ epicKey: "EPIC-1", basedOnCommit: "abc1234", tasks: [] })),
      listNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
      searchNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
    } satisfies SazedServiceShape)

    const JiraFailing = Layer.succeed(JiraService, {
      resolveKey: () => Effect.succeed(null),
      fetchTask: (key) => Effect.succeed(new JiraTask({ key, summary: "", status: "Unknown", issueType: "Unknown" })),
      fetchTasksForEpic: () => Effect.fail(new JiraError({
        message: "Jira API unavailable",
        operation: "fetchTasksForEpic",
      })),
    } satisfies JiraServiceShape)

    const layer = Layer.mergeAll(TestJasnah, SpySazed, TestSubprocess, JiraFailing, NodeFileSystem.layer)

    // Should succeed despite Jira failure (graceful degradation)
    const result = await Effect.runPromise(
      analyzeWithContextPipeline({
        epicKey: "EPIC-1",
        root: `/tmp/test-jira-fail-${Date.now()}`,
        stdout: true,
      }).pipe(Effect.provide(layer)),
    )

    expect(result.markdown).toContain("Test Analysis")
    // No task hierarchy in context since Jira failed
    if (capturedContext) {
      expect(capturedContext).not.toContain("Epic Task Structure")
    }
  })

  test("includes git evidence from completed tasks in context", async () => {
    let capturedContext: string | undefined
    const SpySazed = Layer.succeed(SazedService, {
      analyze: (opts) => {
        capturedContext = opts.context
        return Effect.succeed(testAnalyzeOutput)
      },
      syncToJira: () => Effect.succeed(new SazedSyncOutput({ created: [], updated: [], skipped: [] })),
      checkStatus: () => Effect.succeed(new SazedStatusOutput({ epicKey: "EPIC-1", basedOnCommit: "abc1234", tasks: [] })),
      listNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
      searchNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
    } satisfies SazedServiceShape)

    const completedTask = new JiraTask({ key: "TRK-200", summary: "Auth module", status: "Done", issueType: "Story" })
    const pendingTask = new JiraTask({ key: "TRK-201", summary: "Dashboard", status: "To Do", issueType: "Task" })

    // Subprocess mock returns git log output for completed task
    const SubprocessWithGit = Layer.succeed(SubprocessService, {
      run: (_cmd, opts) => {
        const args = opts?.args ?? []
        const argsStr = args.join(" ")
        if (argsStr.includes("--grep=TRK-200")) {
          return Effect.succeed({
            stdout: "abc1234 feat(auth): implement auth module\ndef5678 fix(auth): handle token refresh",
            stderr: "",
            exitCode: 0,
            timedOut: false,
          })
        }
        return Effect.succeed({ stdout: "", stderr: "", exitCode: 0, timedOut: false })
      },
    })

    const JiraWithCompleted = Layer.succeed(JiraService, {
      resolveKey: () => Effect.succeed(null),
      fetchTask: (key) => Effect.succeed(new JiraTask({ key, summary: "", status: "Unknown", issueType: "Unknown" })),
      fetchTasksForEpic: () => Effect.succeed([completedTask, pendingTask]),
    } satisfies JiraServiceShape)

    const layer = Layer.mergeAll(TestJasnah, SpySazed, SubprocessWithGit, JiraWithCompleted, NodeFileSystem.layer)

    await Effect.runPromise(
      analyzeWithContextPipeline({
        epicKey: "EPIC-1",
        root: `/tmp/test-evidence-${Date.now()}`,
        stdout: true,
      }).pipe(Effect.provide(layer)),
    )

    expect(capturedContext).toBeDefined()
    // Should contain completed task evidence
    expect(capturedContext).toContain("TRK-200")
    expect(capturedContext).toContain("Auth module")
    expect(capturedContext).toContain("MUST produce exactly 1 tasks")
    // Should contain git evidence section
    expect(capturedContext).toContain("implement auth module")
  })

  test("failed analysis returns SazedError", async () => {
    const result = await Effect.runPromiseExit(
      analyzeWithContextPipeline({
        epicKey: "EPIC-1",
        root: "/tmp/test",
        stdout: true,
      }).pipe(Effect.provide(FailLayer)),
    )

    // Should fail with SazedError
    expect(result._tag).toBe("Failure")
  })
})

// ── implement ─────────────────────────────────────────────────────

describe("implementTicketPipeline", () => {
  test("basic implementation gathers context", async () => {
    const result = await Effect.runPromise(
      implementTicketPipeline({
        ticketKey: "PROJ-123",
        shouldAnalyze: false,
        useWorktree: false,
        root: "/tmp/test",
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result.ticketKey).toBe("PROJ-123")
    expect(result.priorContext).toBe("")
    expect(result.analysisMarkdown).toBeUndefined()
    expect(result.worktreePath).toBeUndefined()
  })

  test("with analysis runs sazed", async () => {
    const result = await Effect.runPromise(
      implementTicketPipeline({
        ticketKey: "PROJ-123",
        shouldAnalyze: true,
        useWorktree: false,
        root: "/tmp/test",
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result.analysisMarkdown).toContain("Test Analysis")
  })

  test("failed analysis continues without it", async () => {
    const result = await Effect.runPromise(
      implementTicketPipeline({
        ticketKey: "PROJ-123",
        shouldAnalyze: true,
        useWorktree: false,
        root: "/tmp/test",
      }).pipe(Effect.provide(FailLayer)),
    )

    expect(result.ticketKey).toBe("PROJ-123")
    expect(result.analysisMarkdown).toBeUndefined()
  })
})

// ── audit ─────────────────────────────────────────────────────────

describe("auditPipeline", () => {
  test("runs on empty memory root without error", async () => {
    const result = await Effect.runPromise(
      auditPipeline("/tmp/nonexistent-audit-test").pipe(
        Effect.provide(Layer.mergeAll(TestJasnah, NodeFileSystem.layer)),
      ),
    )

    expect(result.memoriesScanned).toBe(0)
    expect(result.findings).toHaveLength(0)
  })
})

describe("formatReport (pure)", () => {
  test("formats empty report", () => {
    const report: AuditReport = {
      timestamp: "2026-01-01T00:00:00Z",
      memoriesScanned: 0,
      findings: [],
      tagFrequency: {},
      typeDistribution: {},
    }

    const output = formatReport(report)
    expect(output).toContain("Dalinar Audit Report")
    expect(output).toContain("0")
    expect(output).toContain("healthy")
  })

  test("formats findings by severity", () => {
    const report: AuditReport = {
      timestamp: "2026-01-01T00:00:00Z",
      memoriesScanned: 10,
      findings: [
        {
          category: "recurring-blocker",
          severity: "high",
          summary: "Test finding",
          details: "Test details",
          evidence: ["e1", "e2"],
        },
      ],
      tagFrequency: { test: 5 },
      typeDistribution: { "lesson-learned": 10 },
    }

    const output = formatReport(report)
    expect(output).toContain("[!]")
    expect(output).toContain("Test finding")
    expect(output).toContain("lesson-learned")
  })
})

// ── git evidence (retro.ts) ──────────────────────────────────────

describe("getCompletedTaskEvidence", () => {
  test("extracts git log for a task key", async () => {
    const GitSubprocess = Layer.succeed(SubprocessService, {
      run: (_cmd, opts) => {
        const args = opts.args as string[]
        // Simulate git log --grep finding commits
        if (args.includes("--grep=PROJ-100")) {
          return Effect.succeed({
            stdout: "abc1234 feat(PROJ-100): add widget\ndef5678 fix(PROJ-100): handle edge case",
            stderr: "",
            exitCode: 0,
            timedOut: false,
          })
        }
        // Branch lookup fails (no such branch)
        return Effect.succeed({ stdout: "", stderr: "", exitCode: 128, timedOut: false })
      },
    } satisfies SubprocessServiceShape)

    const task = new JiraTask({ key: "PROJ-100", summary: "Add widget", status: "Done", issueType: "Story" })

    const result = await Effect.runPromise(
      getCompletedTaskEvidence(task, "/tmp/test").pipe(
        Effect.provide(GitSubprocess),
      ),
    )

    expect(result.taskKey).toBe("PROJ-100")
    expect(result.commitLog).toContain("abc1234")
    expect(result.commitLog).toContain("def5678")
    expect(result.commitLog).toContain("add widget")
  })

  test("returns (no commits found) when git has no matching commits", async () => {
    const EmptyGitSubprocess = Layer.succeed(SubprocessService, {
      run: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0, timedOut: false }),
    } satisfies SubprocessServiceShape)

    const task = new JiraTask({ key: "PROJ-999", summary: "Nothing here", status: "Done", issueType: "Story" })

    const result = await Effect.runPromise(
      getCompletedTaskEvidence(task, "/tmp/test").pipe(
        Effect.provide(EmptyGitSubprocess),
      ),
    )

    expect(result.commitLog).toBe("(no commits found)")
  })
})

describe("formatEvidenceAsContext (pure)", () => {
  test("formats evidence with commits into markdown", () => {
    const evidence = [
      { taskKey: "PROJ-1", summary: "Auth module", commitLog: "abc1234 feat: add auth\ndef5678 fix: token refresh" },
      { taskKey: "PROJ-2", summary: "No commits", commitLog: "(no commits found)" },
    ]

    const context = formatEvidenceAsContext(evidence)
    expect(context).toContain("Completed Task Evidence")
    expect(context).toContain("PROJ-1: Auth module")
    expect(context).toContain("abc1234 feat: add auth")
    // PROJ-2 should be excluded (no commits)
    expect(context).not.toContain("PROJ-2")
  })

  test("returns empty string when no evidence has commits", () => {
    const evidence = [
      { taskKey: "PROJ-1", summary: "A", commitLog: "(no commits found)" },
    ]
    expect(formatEvidenceAsContext(evidence)).toBe("")
  })
})

// ── deep-analyze ─────────────────────────────────────────────────

describe("deepAnalyzePipeline", () => {
  const TestProjectRoot = Layer.succeed(ProjectRoot, { root: "/tmp/test" })

  test("plan mode: no tasks triggers full epic decomposition", async () => {
    // fetchTasksForEpic returns empty → plan mode
    const DeepLayer = Layer.mergeAll(TestJasnah, TestSazed, TestSubprocess, TestJira, TestProjectRoot, NodeFileSystem.layer)

    const result = await Effect.runPromise(
      deepAnalyzePipeline({ key: "EPIC-1" }).pipe(
        Effect.provide(DeepLayer),
      ),
    ) as DeepAnalyzeResult

    expect(result.mode).toBe("plan")
    expect(result.evidence).toHaveLength(0)
    expect(result.analyses).toHaveLength(1)
    expect(result.analyses[0].taskKey).toBe("EPIC-1")
    expect(result.analyses[0].markdown).toContain("Test Analysis")
  })

  test("analyze-pending mode: completed tasks provide git evidence to pending analysis", async () => {
    const completedTask = new JiraTask({ key: "PROJ-1", summary: "Done task", status: "Done", issueType: "Story" })
    const pendingTask = new JiraTask({ key: "PROJ-2", summary: "Pending task", status: "In Progress", issueType: "Story" })

    const JiraWithTasks = Layer.succeed(JiraService, {
      resolveKey: () => Effect.succeed(null),
      fetchTask: (key) => Effect.succeed(new JiraTask({ key, summary: "", status: "Unknown", issueType: "Unknown" })),
      fetchTasksForEpic: () => Effect.succeed([completedTask, pendingTask]),
    } satisfies JiraServiceShape)

    // Track what context is passed to Sazed
    let capturedContext: string | undefined
    const TrackingSazed = Layer.succeed(SazedService, {
      analyze: (opts) => {
        // The context env var will contain the git evidence
        capturedContext = opts.context
        return Effect.succeed(testAnalyzeOutput)
      },
      syncToJira: () => Effect.succeed(new SazedSyncOutput({ created: [], updated: [], skipped: [] })),
      checkStatus: () => Effect.succeed(new SazedStatusOutput({ epicKey: "EPIC-1", basedOnCommit: "abc1234", tasks: [] })),
      listNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
      searchNotes: () => Effect.succeed(new SazedNotesListOutput({ notes: [] })),
    } satisfies SazedServiceShape)

    // Git subprocess returns commit evidence for PROJ-1
    const GitSubprocess = Layer.succeed(SubprocessService, {
      run: (_cmd, opts) => {
        const args = opts.args as string[]
        if (args.includes("--grep=PROJ-1")) {
          return Effect.succeed({
            stdout: "aaa1111 feat(PROJ-1): implement auth module",
            stderr: "",
            exitCode: 0,
            timedOut: false,
          })
        }
        return Effect.succeed({ stdout: "", stderr: "", exitCode: 0, timedOut: false })
      },
    } satisfies SubprocessServiceShape)

    const DeepLayer = Layer.mergeAll(
      TestJasnah, TrackingSazed, GitSubprocess, JiraWithTasks, TestProjectRoot, NodeFileSystem.layer,
    )

    const result = await Effect.runPromise(
      deepAnalyzePipeline({ key: "EPIC-1" }).pipe(
        Effect.provide(DeepLayer),
      ),
    ) as DeepAnalyzeResult

    expect(result.mode).toBe("analyze-pending")
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0].taskKey).toBe("PROJ-1")
    expect(result.evidence[0].commitLog).toContain("implement auth module")
    // Only the pending task should be analyzed
    expect(result.analyses).toHaveLength(1)
    expect(result.analyses[0].taskKey).toBe("PROJ-2")
  })

  test("targeted mode: analyzes only the specified task", async () => {
    const pendingA = new JiraTask({ key: "PROJ-A", summary: "Task A", status: "To Do", issueType: "Story" })
    const pendingB = new JiraTask({ key: "PROJ-B", summary: "Task B", status: "To Do", issueType: "Story" })

    const JiraTargeted = Layer.succeed(JiraService, {
      resolveKey: (key) => Effect.succeed(
        key === "PROJ-A" ? { epicKey: "EPIC-1", taskKey: "PROJ-A", issueType: "Story" } : null,
      ),
      fetchTask: (key) => Effect.succeed(new JiraTask({ key, summary: "", status: "Unknown", issueType: "Unknown" })),
      fetchTasksForEpic: () => Effect.succeed([pendingA, pendingB]),
    } satisfies JiraServiceShape)

    const DeepLayer = Layer.mergeAll(
      TestJasnah, TestSazed, TestSubprocess, JiraTargeted, TestProjectRoot, NodeFileSystem.layer,
    )

    const result = await Effect.runPromise(
      deepAnalyzePipeline({ key: "PROJ-A" }).pipe(
        Effect.provide(DeepLayer),
      ),
    ) as DeepAnalyzeResult

    expect(result.mode).toBe("analyze-pending")
    // Only PROJ-A should be analyzed, not PROJ-B
    expect(result.analyses).toHaveLength(1)
    expect(result.analyses[0].taskKey).toBe("PROJ-A")
  })
})

// ── Jira schema decode (real API payloads) ───────────────────

describe("JiraServiceLive decode (real payloads)", () => {
  // Real Jira API response for a Task with null customfields
  const taskPayload = JSON.stringify({
    fields: {
      customfield_10016: null,
      summary: "Scheduler Settings v2",
      issuetype: { name: "Task", subtask: false },
      parent: { id: "32526", key: "TRK-4475" },
      comment: { comments: [], maxResults: 0, total: 0, startAt: 0 },
      assignee: { displayName: "Arioston Jaerger" },
      customfield_10014: "TRK-4475",
      status: { name: "In Progress", id: "10008" },
      labels: [],
    },
  })

  // Real Jira API response for an Epic with null customfields
  const epicPayload = JSON.stringify({
    fields: {
      customfield_10016: null,
      summary: "Availability, Agent, Scheduler Settings",
      issuetype: { name: "Epic", subtask: false },
      comment: { comments: [], maxResults: 0, total: 0, startAt: 0 },
      assignee: { displayName: "Arioston Jaerger" },
      customfield_10014: null,
      status: { name: "In Progress", id: "10008" },
      labels: [],
    },
  })

  // Payload with comments
  const taskWithCommentsPayload = JSON.stringify({
    fields: {
      customfield_10016: 3,
      summary: "Auth module",
      issuetype: { name: "Story" },
      parent: { key: "TRK-4475" },
      comment: {
        comments: [
          { id: "100", author: { displayName: "Alice" }, body: "AC clarified: must support batch", created: "2026-01-15T10:00:00Z" },
          { id: "101", body: "Deployed to staging", created: "2026-01-16T10:00:00Z" },
        ],
      },
      assignee: null,
      customfield_10014: null,
      status: { name: "Done" },
      labels: ["backend"],
    },
  })

  const makeSubprocess = (response: string) =>
    Layer.succeed(SubprocessService, {
      run: () => Effect.succeed({ stdout: response, stderr: "", exitCode: 0, timedOut: false }),
    } satisfies SubprocessServiceShape)

  test("decodes task with null customfield_10016 and null-free customfield_10014", async () => {
    const layer = JiraServiceLive.pipe(Layer.provide(makeSubprocess(taskPayload)))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const jira = yield* JiraService
        return yield* jira.fetchTask("TRK-4478")
      }).pipe(Effect.provide(layer)),
    )

    expect(result.key).toBe("TRK-4478")
    expect(result.summary).toBe("Scheduler Settings v2")
    expect(result.status).toBe("In Progress")
    expect(result.issueType).toBe("Task")
    expect(result.assignee).toBe("Arioston Jaerger")
    expect(result.storyPoints).toBeUndefined()  // null → undefined
    expect(result.parentKey).toBe("TRK-4475")
    expect(result.labels).toEqual([])
    expect(result.comments).toEqual([])
  })

  test("decodes epic with null customfield_10014 and null customfield_10016", async () => {
    const layer = JiraServiceLive.pipe(Layer.provide(makeSubprocess(epicPayload)))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const jira = yield* JiraService
        return yield* jira.fetchTask("TRK-4475")
      }).pipe(Effect.provide(layer)),
    )

    expect(result.key).toBe("TRK-4475")
    expect(result.summary).toBe("Availability, Agent, Scheduler Settings")
    expect(result.issueType).toBe("Epic")
    expect(result.storyPoints).toBeUndefined()  // null → undefined
    expect(result.parentKey).toBeUndefined()     // null → undefined
    expect(result.comments).toEqual([])
  })

  test("decodes task with comments and story points", async () => {
    const layer = JiraServiceLive.pipe(Layer.provide(makeSubprocess(taskWithCommentsPayload)))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const jira = yield* JiraService
        return yield* jira.fetchTask("TRK-5000")
      }).pipe(Effect.provide(layer)),
    )

    expect(result.summary).toBe("Auth module")
    expect(result.storyPoints).toBe(3)
    expect(result.assignee).toBeUndefined()  // null → undefined
    expect(result.parentKey).toBe("TRK-4475")
    expect(result.labels).toEqual(["backend"])
    expect(result.comments).toHaveLength(2)
    expect(result.comments![0].author).toBe("Alice")
    expect(result.comments![0].body).toBe("AC clarified: must support batch")
    expect(result.comments![1].author).toBeUndefined()  // no author field
  })

  test("resolveKey handles epic with null fields", async () => {
    const layer = JiraServiceLive.pipe(Layer.provide(makeSubprocess(epicPayload)))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const jira = yield* JiraService
        return yield* jira.resolveKey("TRK-4475")
      }).pipe(Effect.provide(layer)),
    )

    expect(result).not.toBeNull()
    expect(result!.epicKey).toBe("TRK-4475")
    expect(result!.taskKey).toBeUndefined()
    expect(result!.issueType).toBe("Epic")
  })

  test("resolveKey handles task with null customfield_10014 but parent.key", async () => {
    // Task where customfield_10014 is set but parent.key also exists
    const payload = JSON.stringify({
      fields: {
        summary: "A task",
        issuetype: { name: "Task" },
        parent: { key: "TRK-4475" },
        customfield_10014: null,
        status: { name: "To Do" },
      },
    })
    const layer = JiraServiceLive.pipe(Layer.provide(makeSubprocess(payload)))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const jira = yield* JiraService
        return yield* jira.resolveKey("TRK-4478")
      }).pipe(Effect.provide(layer)),
    )

    expect(result).not.toBeNull()
    expect(result!.epicKey).toBe("TRK-4475")  // from parent.key
    expect(result!.taskKey).toBe("TRK-4478")
    expect(result!.issueType).toBe("Task")
  })
})
