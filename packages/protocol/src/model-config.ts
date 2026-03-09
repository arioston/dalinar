/**
 * Central model/provider allowlist and validation.
 *
 * The orchestrator validates LLM_PROVIDER and LLM_MODEL against these
 * lists *before* spawning any subprocess, so misconfigurations surface
 * as clear errors instead of opaque subprocess failures.
 */

export const SUPPORTED_PROVIDERS = ["anthropic", "openai", "copilot", "github-copilot"] as const
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number]

export const SUPPORTED_MODELS: Record<SupportedProvider, readonly string[]> = {
  "anthropic": ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022"],
  "openai": ["gpt-4o", "gpt-4o-mini", "gpt-5.2", "gpt-5.4", "gpt-5.1-codex-mini"],
  "github-copilot": ["claude-sonnet-4-20250514", "gpt-4o", "gpt-5.2", "gpt-5.4", "gpt-5.1-mini", "claude-sonnet-4", "claude-sonnet-4.5", "gpt-5", "gpt-5.1", "gemini-2.5-pro"],
  "copilot": ["claude-sonnet-4-20250514", "gpt-4o", "gpt-5.2", "gpt-5.4", "gpt-5.1-mini", "claude-sonnet-4", "claude-sonnet-4.5", "gpt-5", "gpt-5.1", "gemini-2.5-pro"],
} as const

export const DEFAULT_PROVIDER: SupportedProvider = "anthropic"
export const DEFAULT_MODEL = "claude-sonnet-4-20250514" as const

export type ModelValidationResult =
  | { readonly status: "valid"; readonly provider: SupportedProvider; readonly model: string }
  | { readonly status: "unknown-provider"; readonly provider: string; readonly supported: readonly string[] }
  | { readonly status: "unknown-model"; readonly provider: SupportedProvider; readonly model: string; readonly supported: readonly string[] }

export function validateModelConfig(provider: string, model: string): ModelValidationResult {
  if (!SUPPORTED_PROVIDERS.includes(provider as SupportedProvider)) {
    return { status: "unknown-provider", provider, supported: [...SUPPORTED_PROVIDERS] }
  }
  const p = provider as SupportedProvider
  const models = SUPPORTED_MODELS[p]
  if (!models.includes(model)) {
    return { status: "unknown-model", provider: p, model, supported: [...models] }
  }
  return { status: "valid", provider: p, model }
}

export function formatModelRemediationMessage(result: ModelValidationResult): string | null {
  if (result.status === "valid") return null
  if (result.status === "unknown-provider") {
    return [
      `Unknown LLM provider: "${result.provider}"`,
      `Set LLM_PROVIDER to one of: ${result.supported.join(", ")}`,
    ].join("\n")
  }
  return [
    `Unknown model "${result.model}" for provider "${result.provider}"`,
    `Set LLM_MODEL to one of: ${result.supported.join(", ")}`,
  ].join("\n")
}
