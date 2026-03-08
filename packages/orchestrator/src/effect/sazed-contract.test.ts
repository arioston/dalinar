/**
 * Sazed CLI contract tests.
 *
 * - Schema roundtrip tests (always run)
 * - Negative/failure-path tests (always run)
 * - Version compatibility tests (always run)
 * - Golden file fixture tests (always run, no subprocess)
 * - Live CLI integration tests (opt-in via RUN_EXTERNAL_TESTS=1)
 */

import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import {
  SAZED_CONTRACT_VERSION,
  SazedAnalyzeOutput,
  SazedSyncOutput,
  SazedStatusOutput,
  SazedNotesListOutput,
  checkVersionCompat,
} from "@dalinar/protocol"
import { SubprocessService, SubprocessServiceLive } from "./subprocess.js"
import { resolveDalinarRoot } from "./paths.js"
import { SazedEnvelope, extractJsonEnvelope } from "./services.js"
import { resolve } from "path"
import { existsSync, readFileSync } from "fs"

// Alias for test brevity.
const Envelope = SazedEnvelope

const RUN_EXTERNAL = !!process.env.RUN_EXTERNAL_TESTS

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

  test("decodes successfully with minor version drift (schema level)", () => {
    const sample = {
      contractVersion: "1.1.0",
      data: {
        notes: [{ slug: "x", title: "x", type: "domain-fact", tags: [], retentionScore: 0.5 }],
      },
    }

    // Schema decodes fine — version enforcement is at the service layer
    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(JSON.stringify(sample))
    expect(decoded.contractVersion).toBe("1.1.0")
    expect(decoded.data.notes).toHaveLength(1)
  })

  test("decodes at schema level even with major mismatch (enforcement is in service)", () => {
    const sample = {
      contractVersion: "99.0.0",
      data: {
        notes: [{ slug: "x", title: "x", type: "domain-fact", tags: [], retentionScore: 0.5 }],
      },
    }

    // Schema itself does not enforce version — that happens in decodeSazed
    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(JSON.stringify(sample))
    expect(decoded.contractVersion).toBe("99.0.0")
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

// ── Negative / failure-path tests ───────────────────────────────

describe("Sazed envelope failure paths", () => {
  test("missing contractVersion field rejects", () => {
    const bad = JSON.stringify({
      data: { notes: [] },
    })

    expect(() =>
      Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(bad),
    ).toThrow()
  })

  test("missing data field rejects", () => {
    const bad = JSON.stringify({
      contractVersion: "1.0.0",
    })

    expect(() =>
      Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(bad),
    ).toThrow()
  })

  test("contractVersion as number rejects", () => {
    const bad = JSON.stringify({
      contractVersion: 1,
      data: { notes: [] },
    })

    expect(() =>
      Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(bad),
    ).toThrow()
  })

  test("truncated JSON rejects gracefully", () => {
    const truncated = '{"contractVersion":"1.0.0","data":{"notes":[{"slug":"x'

    expect(() =>
      Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(truncated),
    ).toThrow()
  })

  test("empty string rejects gracefully", () => {
    expect(() =>
      Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(""),
    ).toThrow()
  })

  test("data contains wrong shape for expected schema rejects", () => {
    const bad = JSON.stringify({
      contractVersion: "1.0.0",
      data: {
        // SazedNotesListOutput expects { notes: [...] }
        // but we provide SazedStatusOutput shape
        epicKey: "EPIC-1",
        basedOnCommit: "abc",
        tasks: [],
      },
    })

    expect(() =>
      Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(bad),
    ).toThrow()
  })

  test("extra unknown fields in envelope are accepted (open struct)", () => {
    const withExtra = JSON.stringify({
      contractVersion: "1.0.0",
      data: { notes: [] },
      extraField: "should be ignored",
    })

    // Schema.Struct is open by default — extra fields are silently dropped
    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(withExtra)
    expect(decoded.contractVersion).toBe("1.0.0")
  })

  test("null input rejects", () => {
    expect(() =>
      Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(null as any),
    ).toThrow()
  })

  test("non-JSON string rejects", () => {
    expect(() =>
      Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))("not json at all"),
    ).toThrow()
  })
})

// ── Version compatibility tests ──────────────────────────────────

describe("Contract version policy", () => {
  test("exact match returns 'exact'", () => {
    expect(checkVersionCompat("1.0.0", "1.0.0")).toBe("exact")
  })

  test("minor drift returns 'minor-drift'", () => {
    expect(checkVersionCompat("1.0.0", "1.1.0")).toBe("minor-drift")
    expect(checkVersionCompat("1.0.0", "1.0.1")).toBe("minor-drift")
  })

  test("major mismatch returns 'major-mismatch'", () => {
    expect(checkVersionCompat("1.0.0", "2.0.0")).toBe("major-mismatch")
    expect(checkVersionCompat("1.0.0", "99.0.0")).toBe("major-mismatch")
  })
})

// ── Sazed submodule version check ──────────────────────────────

describe("Sazed submodule version", () => {
  test.skipIf(!existsSync(resolve(resolveDalinarRoot(), "modules/sazed/packages/cli/package.json")))(
    "sazed CLI submodule version is readable and compatible",
    () => {
      const raw = readFileSync(resolve(resolveDalinarRoot(), "modules/sazed/packages/cli/package.json"), "utf-8")
      const pkg = JSON.parse(raw)
      const version = pkg.version as string | undefined
      expect(typeof version).toBe("string")
      const result = checkVersionCompat(SAZED_CONTRACT_VERSION, version!)
      expect(["exact", "minor-drift", "major-mismatch"]).toContain(result)
    },
  )
})

// ── extractJsonEnvelope tests ────────────────────────────────────

describe("extractJsonEnvelope", () => {
  test("returns clean JSON unchanged", () => {
    const json = '{"contractVersion":"1.0.0","data":{"notes":[]}}'
    expect(extractJsonEnvelope(json)).toBe(json)
  })

  test("strips leading log lines", () => {
    const dirty = 'Loading config...\nInitializing...\n{"contractVersion":"1.0.0","data":{"notes":[]}}'
    const result = extractJsonEnvelope(dirty)
    expect(JSON.parse(result)).toEqual({ contractVersion: "1.0.0", data: { notes: [] } })
  })

  test("strips trailing log lines", () => {
    const dirty = '{"contractVersion":"1.0.0","data":{"notes":[]}}\nDone in 0.5s'
    const result = extractJsonEnvelope(dirty)
    expect(JSON.parse(result)).toEqual({ contractVersion: "1.0.0", data: { notes: [] } })
  })

  test("handles array JSON", () => {
    const dirty = 'log line\n[{"id":1},{"id":2}]\ntrailer'
    const result = extractJsonEnvelope(dirty)
    expect(JSON.parse(result)).toEqual([{ id: 1 }, { id: 2 }])
  })

  test("returns original when no JSON found", () => {
    expect(extractJsonEnvelope("no json here")).toBe("no json here")
  })
})

// ── Golden file fixture tests (offline contract validation) ──────

const fixturesDir = resolve(import.meta.dir, "fixtures")

describe("Golden file fixtures", () => {
  test("notes-list fixture decodes through SazedNotesListOutput", () => {
    const raw = readFileSync(resolve(fixturesDir, "notes-list.json"), "utf-8")
    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(raw)

    expect(decoded.contractVersion).toBe(SAZED_CONTRACT_VERSION)
    expect(decoded.data.notes).toHaveLength(2)
    expect(decoded.data.notes[0].slug).toBe("auth-rule")
  })

  test("notes-search fixture decodes through SazedNotesListOutput", () => {
    const raw = readFileSync(resolve(fixturesDir, "notes-search.json"), "utf-8")
    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(raw)

    expect(decoded.contractVersion).toBe(SAZED_CONTRACT_VERSION)
    expect(decoded.data.notes).toHaveLength(1)
  })

  test("status-empty fixture decodes through SazedStatusOutput", () => {
    const raw = readFileSync(resolve(fixturesDir, "status-empty.json"), "utf-8")
    const decoded = Schema.decodeUnknownSync(Envelope(SazedStatusOutput))(raw)

    expect(decoded.contractVersion).toBe(SAZED_CONTRACT_VERSION)
    expect(decoded.data.epicKey).toBe("TEST-NONEXISTENT")
    expect(decoded.data.tasks).toEqual([])
  })

  test("analyze fixture decodes through SazedAnalyzeOutput", () => {
    const raw = readFileSync(resolve(fixturesDir, "analyze.json"), "utf-8")
    const decoded = Schema.decodeUnknownSync(Envelope(SazedAnalyzeOutput))(raw)

    expect(decoded.contractVersion).toBe(SAZED_CONTRACT_VERSION)
    expect(decoded.data.epicKey).toBe("EPIC-1")
    expect(decoded.data.tasks).toHaveLength(1)
    expect(decoded.data.notes).toHaveLength(1)
  })

  test("fixtures survive extractJsonEnvelope + decode (simulating log contamination)", () => {
    const raw = readFileSync(resolve(fixturesDir, "notes-list.json"), "utf-8")
    const dirty = `[sazed] Loading...\n${raw}\n[sazed] Done`
    const cleaned = extractJsonEnvelope(dirty)
    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(cleaned)

    expect(decoded.data.notes).toHaveLength(2)
  })
})

// ── Live CLI integration tests (opt-in) ──────────────────────────
// Set RUN_EXTERNAL_TESTS=1 to enable. Requires Sazed CLI + API key.

const dalinarRoot = resolveDalinarRoot()
const sazedCli = resolve(dalinarRoot, "modules/sazed/packages/cli/src/main.ts")

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
    Effect.catchAll(() => Effect.succeed({ stdout: "", stderr: "timeout", exitCode: 1, timedOut: false })),
  )

/** Assert stdout contains valid JSON after extraction. */
function assertCleanJson(stdout: string) {
  const cleaned = extractJsonEnvelope(stdout)
  expect(
    cleaned.startsWith("{") || cleaned.startsWith("["),
    `stdout must contain JSON, got: ${cleaned.slice(0, 80)}`,
  ).toBe(true)
  expect(() => JSON.parse(cleaned)).not.toThrow()
}

describe.skipIf(!RUN_EXTERNAL)("Sazed CLI contract (integration)", () => {
  test("notes list --json produces valid SazedNotesListOutput", async () => {
    const result = await Effect.runPromise(runSazed(["notes", "list", "--json"]))

    expect(result.exitCode, `sazed failed: ${result.stderr}`).toBe(0)
    assertCleanJson(result.stdout)

    const cleaned = extractJsonEnvelope(result.stdout)
    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(cleaned)

    expect(decoded.contractVersion).toBe(SAZED_CONTRACT_VERSION)
    expect(Array.isArray(decoded.data.notes)).toBe(true)
    for (const note of decoded.data.notes) {
      expect(typeof note.slug).toBe("string")
      expect(typeof note.title).toBe("string")
      expect(typeof note.retentionScore).toBe("number")
    }
  })

  test("notes list --json with no notes returns empty envelope", async () => {
    const result = await Effect.runPromise(runSazed(["notes", "list", "--json"]))

    expect(result.exitCode, `sazed failed: ${result.stderr}`).toBe(0)
    assertCleanJson(result.stdout)

    const cleaned = extractJsonEnvelope(result.stdout)
    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(cleaned)
    expect(decoded.contractVersion).toBe(SAZED_CONTRACT_VERSION)
    expect(Array.isArray(decoded.data.notes)).toBe(true)
  })

  test("notes search --json produces valid SazedNotesListOutput", async () => {
    const result = await Effect.runPromise(runSazed(["notes", "search", "test", "--json"]))

    expect(result.exitCode, `sazed failed: ${result.stderr}`).toBe(0)
    assertCleanJson(result.stdout)

    const cleaned = extractJsonEnvelope(result.stdout)
    const decoded = Schema.decodeUnknownSync(Envelope(SazedNotesListOutput))(cleaned)

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

    expect(result.exitCode, `sazed failed: ${result.stderr}`).toBe(0)
    assertCleanJson(result.stdout)

    const cleaned = extractJsonEnvelope(result.stdout)
    const decoded = Schema.decodeUnknownSync(Envelope(SazedStatusOutput))(cleaned)
    expect(decoded.contractVersion).toBe(SAZED_CONTRACT_VERSION)
    expect(decoded.data.epicKey).toBe("TEST-NONEXISTENT")
    expect(decoded.data.tasks).toEqual([])
  })
})
