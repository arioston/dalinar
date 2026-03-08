/**
 * Sazed export surface validation — detects .d.ts drift from .ts source.
 *
 * The compiled .js/.d.ts files in modules/sazed can drift from the .ts source
 * when someone edits .ts but forgets to recompile. This causes:
 * - findToolCall inlined in .js instead of imported from utils.js
 * - .d.ts missing exports that .ts declares
 * - Runtime mismatches between Bun (reads .ts) and tsc consumers (reads .d.ts)
 *
 * These tests pin the expected export surface so drift is caught before CI goes green.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync, existsSync } from "fs"
import { resolve } from "path"
import { resolveDalinarRoot } from "./paths.js"

const SAZED_ROOT = resolve(resolveDalinarRoot(), "modules/sazed")

// ── utils.ts export surface ─────────────────────────────────────

describe("Sazed utils.ts export surface", () => {
  const utilsTs = resolve(SAZED_ROOT, "packages/adapters/src/llm/utils.ts")
  const utilsDts = resolve(SAZED_ROOT, "packages/adapters/src/llm/utils.d.ts")

  test("utils.ts exports extractText, extractJson, and findToolCall", () => {
    const source = readFileSync(utilsTs, "utf-8")
    expect(source).toContain("export const extractText")
    expect(source).toContain("export const extractJson")
    expect(source).toContain("export const findToolCall")
  })

  test.skipIf(!existsSync(utilsDts))(
    "utils.d.ts declares all exports from utils.ts (no drift)",
    () => {
      const dts = readFileSync(utilsDts, "utf-8")
      const source = readFileSync(utilsTs, "utf-8")

      // Extract exported names from .ts source
      const sourceExports = [...source.matchAll(/export\s+const\s+(\w+)/g)].map(m => m[1])
      expect(sourceExports.length).toBeGreaterThan(0)

      for (const name of sourceExports) {
        expect(
          dts.includes(name),
          `utils.d.ts is missing export "${name}" — recompile modules/sazed or delete stale .d.ts`,
        ).toBe(true)
      }
    },
  )
})

// ── LLMServiceLive.js import hygiene ─────────────────────────────

describe("Sazed LLMServiceLive.js import hygiene", () => {
  const jsFile = resolve(SAZED_ROOT, "packages/adapters/src/llm/LLMServiceLive.js")

  test.skipIf(!existsSync(jsFile))(
    "LLMServiceLive.js imports findToolCall from utils.js (not inlined)",
    () => {
      const js = readFileSync(jsFile, "utf-8")

      // The .js should import findToolCall, not define it locally.
      // An inlined `const findToolCall = (content, toolName) =>` is the drift signal.
      const hasInlinedFindToolCall = /^const findToolCall\s*=/m.test(js)

      if (hasInlinedFindToolCall) {
        // If findToolCall is inlined, the .js is stale — fail with remediation
        expect(
          false,
          "LLMServiceLive.js has inlined findToolCall instead of importing from utils.js. " +
          "Recompile modules/sazed or delete stale .js files: " +
          "cd modules/sazed && bun run build",
        ).toBe(true)
      }
    },
  )
})

// ── DistillationServiceLive.js import hygiene ────────────────────

describe("Sazed DistillationServiceLive.js import hygiene", () => {
  const jsFile = resolve(SAZED_ROOT, "packages/adapters/src/distillation/DistillationServiceLive.js")

  test.skipIf(!existsSync(jsFile))(
    "DistillationServiceLive.js imports findToolCall from utils (not inlined)",
    () => {
      const js = readFileSync(jsFile, "utf-8")

      // findToolCall and extractJson should be imported, not inlined.
      // Note: extractText is legitimately local here (joins with "\n" vs "" in utils).
      const hasInlinedFindToolCall = /^const findToolCall\s*=/m.test(js)

      if (hasInlinedFindToolCall) {
        expect(
          false,
          "DistillationServiceLive.js has inlined findToolCall instead of importing from ../llm/utils.js. " +
          "Recompile modules/sazed or delete stale .js files.",
        ).toBe(true)
      }
    },
  )
})

// ── @sazed/cli package.json basics ───────────────────────────────

describe("Sazed CLI package metadata", () => {
  const cliPkg = resolve(SAZED_ROOT, "packages/cli/package.json")

  test("@sazed/cli declares ESM type", () => {
    const pkg = JSON.parse(readFileSync(cliPkg, "utf-8"))
    expect(pkg.type).toBe("module")
  })

  test("@sazed/cli bin points to .ts (not .js)", () => {
    const pkg = JSON.parse(readFileSync(cliPkg, "utf-8"))
    const binEntry = pkg.bin?.sazed ?? pkg.bin
    expect(typeof binEntry).toBe("string")
    expect(binEntry).toEndWith(".ts")
  })

  test("@sazed/cli depends on @dalinar/protocol", () => {
    const pkg = JSON.parse(readFileSync(cliPkg, "utf-8"))
    const allDeps = { ...pkg.dependencies, ...pkg.optionalDependencies }
    expect(allDeps["@dalinar/protocol"]).toBeDefined()
  })
})
