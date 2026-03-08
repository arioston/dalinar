/**
 * Compatibility matrix: orchestrator version × Sazed CLI version × providers × models.
 *
 * Machine-readable mapping that the doctor service uses to validate that the
 * current configuration is within a known-good window.
 */

import { parseSemver, type SemverParts } from "./version.js"
import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS, type SupportedProvider } from "./model-config.js"

export interface CompatibilityEntry {
  readonly orchestratorVersion: string
  readonly sazedContractVersion: string
  readonly sazedCliMinVersion: string
  readonly supportedProviders: readonly SupportedProvider[]
  readonly supportedModels: Record<string, readonly string[]>
}

export const COMPATIBILITY_MATRIX: readonly CompatibilityEntry[] = [
  {
    orchestratorVersion: "0.1.0",
    sazedContractVersion: "1.0.0",
    sazedCliMinVersion: "0.1.0",
    supportedProviders: [...SUPPORTED_PROVIDERS],
    supportedModels: { ...SUPPORTED_MODELS },
  },
]

function semverSatisfiesMin(actual: SemverParts, min: SemverParts): boolean {
  if (actual.major !== min.major) return actual.major > min.major
  if (actual.minor !== min.minor) return actual.minor > min.minor
  return actual.patch >= min.patch
}

export interface CompatibilityCheckResult {
  readonly compatible: boolean
  readonly entry: CompatibilityEntry | null
  readonly issues: readonly string[]
}

export function checkCompatibility(opts: {
  orchestratorVersion: string
  sazedCliVersion?: string | undefined
  provider?: string | undefined
  model?: string | undefined
}): CompatibilityCheckResult {
  const orchParts = parseSemver(opts.orchestratorVersion)
  const entry = COMPATIBILITY_MATRIX.find((e) => {
    const ep = parseSemver(e.orchestratorVersion)
    return ep.major === orchParts.major && ep.minor === orchParts.minor
  })

  if (!entry) {
    return {
      compatible: false,
      entry: null,
      issues: [`No compatibility entry for orchestrator ${opts.orchestratorVersion}`],
    }
  }

  const issues: string[] = []

  if (opts.sazedCliVersion) {
    const cliParts = parseSemver(opts.sazedCliVersion)
    const minParts = parseSemver(entry.sazedCliMinVersion)
    if (!semverSatisfiesMin(cliParts, minParts)) {
      issues.push(
        `Sazed CLI ${opts.sazedCliVersion} is below minimum ${entry.sazedCliMinVersion}`,
      )
    }
  }

  if (opts.provider) {
    if (!entry.supportedProviders.includes(opts.provider as SupportedProvider)) {
      issues.push(
        `Provider "${opts.provider}" not in compatibility matrix. Supported: ${entry.supportedProviders.join(", ")}`,
      )
    } else if (opts.model) {
      const models = entry.supportedModels[opts.provider] ?? []
      if (!models.includes(opts.model)) {
        issues.push(
          `Model "${opts.model}" not in compatibility matrix for provider "${opts.provider}". Supported: ${models.join(", ")}`,
        )
      }
    }
  }

  return { compatible: issues.length === 0, entry, issues }
}
