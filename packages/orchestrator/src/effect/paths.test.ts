import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  assertNotDist,
  resolveDalinarRoot,
  resolveJasnahRoot,
  resolveJasnahScript,
  resolveSazedRoot,
  resolveSazedCli,
  resolveHoidRoot,
  resolveHoidScript,
  resolveJiraScript,
  preflight,
} from "./paths.js"

// ── assertNotDist ────────────────────────────────────────────────

describe("assertNotDist", () => {
  test("rejects path containing /dist/", async () => {
    const exit = await Effect.runPromiseExit(assertNotDist("/foo/dist/main.js"))
    expect(exit._tag).toBe("Failure")
  })

  test("rejects path containing \\dist\\ (Windows)", async () => {
    const exit = await Effect.runPromiseExit(assertNotDist("C:\\foo\\dist\\main.js"))
    expect(exit._tag).toBe("Failure")
  })

  test("accepts normal src path", async () => {
    await Effect.runPromise(assertNotDist("/foo/src/main.ts"))
  })

  test("accepts path with 'dist' in directory name but not as segment", async () => {
    await Effect.runPromise(assertNotDist("/foo/distributed/main.ts"))
  })

  test("accepts path with 'dist' in filename", async () => {
    await Effect.runPromise(assertNotDist("/foo/src/dist-utils.ts"))
  })
})

// ── Path resolvers ──────────────────────────────────────────────

describe("path resolvers", () => {
  test("resolveDalinarRoot returns string", () => {
    expect(typeof resolveDalinarRoot()).toBe("string")
  })

  test("resolveJasnahRoot returns string", () => {
    expect(typeof resolveJasnahRoot()).toBe("string")
  })

  test("resolveJasnahScript appends script name", () => {
    const path = resolveJasnahScript("search-memory.ts")
    expect(path).toContain("search-memory.ts")
    expect(path).toContain("scripts")
  })

  test("resolveSazedRoot is under dalinar root", () => {
    expect(resolveSazedRoot()).toContain("modules/sazed")
  })

  test("resolveSazedCli points to main.ts", () => {
    expect(resolveSazedCli()).toContain("main.ts")
  })

  test("resolveHoidRoot returns string", () => {
    expect(typeof resolveHoidRoot()).toBe("string")
  })

  test("resolveHoidScript appends script name", () => {
    const path = resolveHoidScript("calendar-list")
    expect(path).toContain("calendar-list.ts")
  })

  test("resolveJiraScript with explicit root", () => {
    const path = resolveJiraScript("/my/project")
    expect(path).toBe("/my/project/skills/jira/jira-request.ts")
  })

  test("resolveJiraScript without root uses DALINAR_ROOT or cwd", () => {
    const path = resolveJiraScript()
    expect(path).toContain("jira-request.ts")
  })
})

// ── Preflight ───────────────────────────────────────────────────

describe("preflight", () => {
  test("returns check results for all scripts", async () => {
    const result = await Effect.runPromise(preflight)
    expect(result.checks).toHaveLength(4)
    for (const check of result.checks) {
      expect(check).toHaveProperty("name")
      expect(check).toHaveProperty("path")
      expect(typeof check.ok).toBe("boolean")
    }
  })

  test("returns root path", async () => {
    const result = await Effect.runPromise(preflight)
    expect(typeof result.root).toBe("string")
    expect(result.root.length).toBeGreaterThan(0)
  })
})
