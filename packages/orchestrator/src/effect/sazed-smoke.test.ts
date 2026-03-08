/**
 * Sazed CLI smoke test — REQUIRED in CI (not gated by RUN_EXTERNAL_TESTS).
 *
 * Verifies the Sazed CLI can boot without crashing. This catches:
 * - ESM import resolution failures (Cannot find module, ERR_MODULE_NOT_FOUND)
 * - Stale .d.ts / .js compiled artifacts diverging from .ts source
 * - Missing dependencies or broken workspace links
 *
 * This test does NOT call Sazed commands that require API keys.
 */

import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { existsSync } from "fs"
import { resolveDalinarRoot, resolveSazedCli } from "./paths.js"

const ROOT = resolveDalinarRoot()
const SAZED_CLI = resolveSazedCli()

/** Assert no module resolution or crash signals in output */
function assertNoCrashSignals(output: string) {
  expect(output).not.toContain("Cannot find module")
  expect(output).not.toContain("ERR_MODULE_NOT_FOUND")
  expect(output).not.toContain("SyntaxError")
  expect(output).not.toContain("ReferenceError")
  expect(output).not.toContain("TypeError: Cannot read properties")
  expect(output).not.toContain("segmentation fault")
  expect(output).not.toContain("SIGABRT")
  expect(output).not.toContain("SIGSEGV")
}

describe("Sazed CLI smoke (required)", () => {
  test("sazed CLI entry point exists on disk", () => {
    expect(existsSync(SAZED_CLI)).toBe(true)
  })

  test("sazed CLI boots without crash", async () => {
    // Run with --help which should exit 0 without needing API keys
    const result = await $`bun run ${SAZED_CLI} --help`
      .quiet()
      .nothrow()
      .env({ ...process.env, SKIP_MAIN: "1" })

    const output = result.stdout.toString() + result.stderr.toString()
    assertNoCrashSignals(output)
    // Exit code < 128 (signals indicate crashes)
    expect(result.exitCode).toBeLessThan(128)
  })

  test("sazed notes list --json boots without crash (no API key needed for empty store)", async () => {
    const result = await $`bun run ${SAZED_CLI} notes list --json`
      .quiet()
      .nothrow()
      .cwd(ROOT)

    const output = result.stdout.toString() + result.stderr.toString()
    assertNoCrashSignals(output)
    // Exit code < 128 (signals indicate crashes)
    expect(result.exitCode).toBeLessThan(128)
  })
})
