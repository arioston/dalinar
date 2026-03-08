import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { JasnahService, SazedService, type JasnahServiceShape, type SazedServiceShape } from "../services.js"
import { SubprocessService } from "../subprocess.js"
import { SazedError } from "../errors.js"
import { SazedAnalyzeOutput, SazedSyncOutput, SazedStatusOutput, SazedNotesListOutput } from "@dalinar/protocol"
import { reflectPipeline, reflectionToMemories } from "./reflect.js"
import { dialecticPipeline } from "./dialectic.js"
import { analyzeWithContextPipeline } from "./analyze.js"
import { implementTicketPipeline } from "./implement.js"
import { auditPipeline, formatReport, type AuditReport } from "./audit.js"
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

const TestLayer = Layer.mergeAll(TestJasnah, TestSazed, TestSubprocess)
const FailLayer = Layer.mergeAll(TestJasnah, FailingSazed, TestSubprocess)

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
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result.markdown).toContain("Test Analysis")
    expect(result.memoriesUsed).toBe(0)
  })

  test("failed analysis returns SazedError", async () => {
    const result = await Effect.runPromiseExit(
      analyzeWithContextPipeline({
        epicKey: "EPIC-1",
        root: "/tmp/test",
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
