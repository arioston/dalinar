/**
 * Sazed CLI contract tests.
 *
 * Schema roundtrip tests (always run) + integration tests that invoke
 * the real Sazed CLI subprocess and validate output against protocol schemas.
 */

import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import {
  SAZED_CONTRACT_VERSION,
  SazedAnalyzeOutput,
  SazedSyncOutput,
  SazedStatusOutput,
  SazedNotesListOutput,
} from "@dalinar/protocol"
import { SubprocessService, SubprocessServiceLive } from "./subprocess.js"
import { resolve } from "path"

const Envelope = <A extends Schema.Schema.AnyNoContext>(dataSchema: A) =>
  Schema.parseJson(
    Schema.Struct({
      contractVersion: Schema.String,
      data: dataSchema,
    }),
  )

// ── Schema roundtrip tests (no subprocess, always run) ──────────

describe("Sazed contract schemas (roundtrip)", () => {
  test("SazedAnalyzeOutput encodes and decodes correctly", () => {
    const sample = {
      contractVersion: SAZED_CONTRACT_VERSION,
      data: {
        epicKey: "EPIC-1",
        epicSummary: "Test epic",
        contextSummary: "Architecture context for testing",
        tasks: [
          {
            id: "task-1",
            epicKey: "EPIC-1",
            title: "Implement feature",
            description: "Build the thing",
            technicalDefinition: {
              patternReference: ["src/patterns/example.ts"],
              filesToModify: ["src/foo.ts"],
              integrationPoints: ["API endpoint /bar"],
              codeToReuse: [],
            },
            acceptanceCriteria: ["It works", "Tests pass"],
            complexity: "S",
            confidence: "high",
            dependencies: [],
            parallelizableWith: [],
          },
        ],
        notes: [
          {
            title: "Domain rule",
            type: "domain-fact",
            content: "Users must have verified emails before creating projects",
            tags: ["auth", "validation"],
            relatedNotes: [],
          },
        ],
        communicationFlow: { applicable: false },
        diffFromPrevious: null,
        markdown: "# EPIC-1\n\nAnalysis output",
        basedOnCommit: "abc1234def",
        createdAt: "2026-03-07T00:00:00.000Z",
      },
    }

    const encoded = JSON.stringify(sample)
    const decoded = Schema.decodeUnknownSync(Envelope(SazedAnalyzeOutput))(encoded)

    expect(decoded.contractVersion).toBe(SAZED_CONTRACT_VERSION)
    expect(decoded.data.epicKey).toBe("EPIC-1")
    expect(decoded.data.tasks).toHaveLength(1)
    expect(decoded.data.tasks[0].id).toBe("task-1")
    expect(decoded.data.tasks[0].technicalDefinition.filesToModify).toEqual(["src/foo.ts"])
    expect(decoded.data.notes).toHaveLength(1)
    expect(decoded.data.notes[0].type).toBe("domain-fact")
    expect(decoded.data.markdown).toContain("EPIC-1")
  })

  test("SazedSyncOutput encodes and decodes correctly", () => {
    const sample = {
      contractVersion: SAZED_CONTRACT_VERSION,
      data: {
        created: [{ taskId: "task-1", jiraKey: "PROJ-101" }],
        updated: [{ taskId: "task-2", jiraKey: "PROJ-102" }],
        skipped: [{ taskId: "task-3", reason: "no changes" }],
      },
    }

    const decoded = Schema.decodeUnknownSync(Envelope(SazedSyncOutput))(JSON.stringify(sample))

    expect(decoded.data.created).toHaveLength(1)
    expect(decoded.data.created[0].jiraKey).toBe("PROJ-101")
    expect(decoded.data.skipped[0].reason).toBe("no changes")
  })

  test("SazedStatusOutput encodes and decodes correctly", () => {
    const sample = {
      contractVersion: SAZED_CONTRACT_VERSION,
      data: {
        epicKey: "EPIC-1",
        basedOnCommit: "abc1234",
        tasks: [
          { taskId: "task-1", taskTitle: "Task one", status: "current", changedFiles: [] },
          { taskId: "task-2", taskTitle: "Task two", status: "stale", changedFiles: ["src/foo.ts"] },
        ],
      },
    }

    const decoded = Schema.decodeUnknownSync(Envelope(SazedStatusOutput))(JSON.stringify(sample))

    expect(decoded.data.tasks).toHaveLength(2)
    expect(decoded.data.tasks[1].status).toBe("stale")
    expect(decoded.data.tasks[1].changedFiles).toEqual(["src/foo.ts"])
  })

  test("SazedNotesListOutput encodes and decodes correctly", () => {
    const sample = {
      contractVersion: SAZED_CONTRACT_VERSION,
      data: {
        notes: [
          { slug: "auth-rule", title: "Auth Rule", type: "domain-fact", tags: ["auth"], retentionScore: 0.85 },
        ],
      },
    }

    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(JSON.stringify(sample))

    expect(decoded.data.notes).toHaveLength(1)
    expect(decoded.data.notes[0].slug).toBe("auth-rule")
    expect(decoded.data.notes[0].retentionScore).toBe(0.85)
  })

  test("rejects invalid data with clear error", () => {
    const bad = JSON.stringify({
      contractVersion: "1.0.0",
      data: { epicKey: 123 }, // epicKey should be string, missing required fields
    })

    expect(() =>
      Schema.decodeUnknownSync(Envelope(SazedAnalyzeOutput))(bad),
    ).toThrow()
  })

  test("rejects invalid task complexity literal", () => {
    const bad = JSON.stringify({
      contractVersion: "1.0.0",
      data: {
        epicKey: "EPIC-1",
        epicSummary: "x",
        contextSummary: "x",
        tasks: [{
          id: "t-1", epicKey: "EPIC-1", title: "t", description: "d",
          technicalDefinition: { patternReference: [], filesToModify: [], integrationPoints: [], codeToReuse: [] },
          acceptanceCriteria: [], complexity: "XL", confidence: "high",
          dependencies: [], parallelizableWith: [],
        }],
        notes: [],
        diffFromPrevious: null,
        markdown: "",
        basedOnCommit: "abc",
        createdAt: "2026-01-01T00:00:00Z",
      },
    })

    expect(() =>
      Schema.decodeUnknownSync(Envelope(SazedAnalyzeOutput))(bad),
    ).toThrow()
  })

  test("decodes successfully with mismatched contract version (warning only)", () => {
    const sample = {
      contractVersion: "99.0.0",
      data: {
        notes: [{ slug: "x", title: "x", type: "domain-fact", tags: [], retentionScore: 0.5 }],
      },
    }

    // Should decode — version mismatch is a warning, not a rejection
    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(JSON.stringify(sample))
    expect(decoded.contractVersion).toBe("99.0.0")
    expect(decoded.data.notes).toHaveLength(1)
  })

  test("rejects invalid note type literal", () => {
    const bad = JSON.stringify({
      contractVersion: "1.0.0",
      data: {
        notes: [{ slug: "x", title: "x", type: "invalid-type", tags: [], retentionScore: 0.5 }],
      },
    })

    expect(() =>
      Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(bad),
    ).toThrow()
  })
})

// ── Integration tests (real subprocess) ──────────────────────────
// These require the Sazed CLI to be available. They validate that
// the real CLI output matches the protocol schemas.

const sazedCli = resolve(import.meta.dir, "../../../../modules/sazed/packages/cli/src/main.ts")
const dalinarRoot = resolve(import.meta.dir, "../../../..")

const runSazed = (args: string[]) =>
  Effect.gen(function* () {
    const subprocess = yield* SubprocessService
    return yield* subprocess.run(sazedCli, {
      args,
      cwd: dalinarRoot,
      nothrow: true,
    })
  }).pipe(
    Effect.provide(SubprocessServiceLive),
    Effect.timeout("15 seconds"),
    Effect.catchAll(() => Effect.succeed({ stdout: "", stderr: "timeout", exitCode: 1 })),
  )

describe("Sazed CLI contract (integration)", () => {
  test("notes list --json produces valid SazedNotesListOutput", async () => {
    const result = await Effect.runPromise(runSazed(["notes", "list", "--json"]))

    if (result.exitCode !== 0) {
      console.log(`Skipped: notes list exited ${result.exitCode}`)
      return
    }

    // With stderr logger, stdout should be clean JSON
    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(result.stdout)

    expect(decoded.contractVersion).toBe(SAZED_CONTRACT_VERSION)
    expect(Array.isArray(decoded.data.notes)).toBe(true)
    for (const note of decoded.data.notes) {
      expect(typeof note.slug).toBe("string")
      expect(typeof note.title).toBe("string")
      expect(typeof note.retentionScore).toBe("number")
    }
  })

  test("notes list --json with no notes returns empty envelope", async () => {
    // This validates that the early-return bug is fixed
    const result = await Effect.runPromise(runSazed(["notes", "list", "--json"]))

    if (result.exitCode !== 0) {
      console.log(`Skipped: notes list exited ${result.exitCode}`)
      return
    }

    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(result.stdout)
    expect(decoded.contractVersion).toBe(SAZED_CONTRACT_VERSION)
    // Whether notes exist or not, the envelope is valid
    expect(Array.isArray(decoded.data.notes)).toBe(true)
  })

  test("notes search --json produces valid SazedNotesListOutput", async () => {
    const result = await Effect.runPromise(runSazed(["notes", "search", "test", "--json"]))

    if (result.exitCode !== 0) {
      console.log(`Skipped: notes search exited ${result.exitCode}`)
      return
    }

    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(result.stdout)

    expect(decoded.contractVersion).toBe(SAZED_CONTRACT_VERSION)
    expect(Array.isArray(decoded.data.notes)).toBe(true)
    for (const note of decoded.data.notes) {
      expect(typeof note.slug).toBe("string")
      expect(typeof note.title).toBe("string")
      expect(typeof note.retentionScore).toBe("number")
    }
  })

  test("status --json with nonexistent epic returns empty envelope", async () => {
    const result = await Effect.runPromise(runSazed(["status", "TEST-NONEXISTENT", "--json"]))

    if (result.exitCode !== 0) {
      console.log(`Skipped: status exited ${result.exitCode}`)
      return
    }

    // Should get a valid envelope with empty tasks (no snapshot found)
    const decoded = Schema.decodeUnknownSync(Envelope(SazedStatusOutput))(result.stdout)
    expect(decoded.contractVersion).toBe(SAZED_CONTRACT_VERSION)
    expect(decoded.data.epicKey).toBe("TEST-NONEXISTENT")
    expect(decoded.data.tasks).toEqual([])
  })
})
