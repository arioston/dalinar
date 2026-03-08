import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { doctor } from "./doctor.js"
import {
  validateModelConfig,
  formatModelRemediationMessage,
  checkCompatibility,
  DEFAULT_PROVIDER,
  DEFAULT_MODEL,
} from "@dalinar/protocol"

const runDoctor = doctor.pipe(Effect.provide(NodeFileSystem.layer))

describe("doctor", () => {
  test("succeeds with current config", async () => {
    const result = await Effect.runPromise(runDoctor)
    // Uses env vars if set, otherwise defaults
    const expectedProvider = process.env.LLM_PROVIDER ?? DEFAULT_PROVIDER
    const expectedModel = process.env.LLM_MODEL ?? DEFAULT_MODEL
    expect(result.provider).toBe(expectedProvider)
    expect(result.model).toBe(expectedModel)
    expect(result.modelValid).toBe(true)
  })

  test("reports compatibility issues as array", async () => {
    const result = await Effect.runPromise(runDoctor)
    expect(Array.isArray(result.compatibilityIssues)).toBe(true)
  })
})

describe("model config validation", () => {
  test("valid anthropic + claude model", () => {
    const result = validateModelConfig("anthropic", "claude-sonnet-4-20250514")
    expect(result.status).toBe("valid")
  })

  test("unknown provider", () => {
    const result = validateModelConfig("gemini", "gemini-pro")
    expect(result.status).toBe("unknown-provider")
    if (result.status === "unknown-provider") {
      expect(result.supported).toContain("anthropic")
    }
  })

  test("unknown model for valid provider", () => {
    const result = validateModelConfig("anthropic", "claude-99-turbo")
    expect(result.status).toBe("unknown-model")
    if (result.status === "unknown-model") {
      expect(result.supported).toContain("claude-sonnet-4-20250514")
    }
  })

  test("remediation message for unknown provider", () => {
    const result = validateModelConfig("gemini", "x")
    const msg = formatModelRemediationMessage(result)
    expect(msg).toContain("gemini")
    expect(msg).toContain("LLM_PROVIDER")
  })

  test("remediation message for unknown model", () => {
    const result = validateModelConfig("anthropic", "bad-model")
    const msg = formatModelRemediationMessage(result)
    expect(msg).toContain("bad-model")
    expect(msg).toContain("LLM_MODEL")
  })

  test("no remediation for valid config", () => {
    const result = validateModelConfig("anthropic", "claude-sonnet-4-20250514")
    expect(formatModelRemediationMessage(result)).toBeNull()
  })
})

describe("compatibility matrix", () => {
  test("orchestrator 0.1.0 is in the matrix", () => {
    const result = checkCompatibility({ orchestratorVersion: "0.1.0" })
    expect(result.compatible).toBe(true)
    expect(result.entry).not.toBeNull()
  })

  test("unknown orchestrator version fails", () => {
    const result = checkCompatibility({ orchestratorVersion: "99.0.0" })
    expect(result.compatible).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  test("valid provider + model passes", () => {
    const result = checkCompatibility({
      orchestratorVersion: "0.1.0",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    })
    expect(result.compatible).toBe(true)
  })

  test("invalid model in matrix reports issue", () => {
    const result = checkCompatibility({
      orchestratorVersion: "0.1.0",
      provider: "anthropic",
      model: "nonexistent-model",
    })
    expect(result.compatible).toBe(false)
    expect(result.issues.some((i: string) => i.includes("nonexistent-model"))).toBe(true)
  })

  test("sazed CLI version below minimum reports issue", () => {
    const result = checkCompatibility({
      orchestratorVersion: "0.1.0",
      sazedCliVersion: "0.0.1",
    })
    // 0.0.1 < 0.1.0 minimum
    expect(result.compatible).toBe(false)
  })
})
