/**
 * Semver-aware contract version checking.
 */

export interface SemverParts {
  major: number
  minor: number
  patch: number
}

export type VersionCompat = "exact" | "minor-drift" | "major-mismatch"

export function parseSemver(v: string): SemverParts {
  const [major, minor, patch] = v.split(".").map(Number)
  return { major: major ?? 0, minor: minor ?? 0, patch: patch ?? 0 }
}

export function checkVersionCompat(
  expected: string,
  actual: string,
): VersionCompat {
  const e = parseSemver(expected)
  const a = parseSemver(actual)
  if (e.major !== a.major) return "major-mismatch"
  if (e.minor !== a.minor || e.patch !== a.patch) return "minor-drift"
  return "exact"
}
