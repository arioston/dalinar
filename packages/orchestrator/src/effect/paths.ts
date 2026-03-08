import { Effect } from "effect"
import { FileSystem } from "@effect/platform"
import { resolve } from "path"
import { FileOperationError } from "./errors.js"

/**
 * Resolve the Dalinar monorepo root directory.
 * Uses DALINAR_ROOT env var if set, otherwise computes from this file's location.
 */
export function resolveDalinarRoot(): string {
  return (
    process.env.DALINAR_ROOT ??
    resolve(import.meta.dir, "../../../..")
  )
}

// ── Path resolvers (extracted for preflight + service reuse) ───────

export function resolveJasnahRoot(): string {
  return (
    process.env.JASNAH_ROOT ??
    resolve(
      process.env.XDG_DATA_HOME ?? resolve(process.env.HOME!, ".local/share"),
      "jasnah",
    )
  )
}

export function resolveJasnahScript(name: string): string {
  return resolve(resolveJasnahRoot(), `scripts/${name}`)
}

export function resolveSazedRoot(): string {
  return resolve(resolveDalinarRoot(), "modules/sazed")
}

export function resolveSazedCli(): string {
  return resolve(resolveSazedRoot(), "packages/cli/src/main.ts")
}

export function resolveHoidRoot(): string {
  return process.env.HOID_ROOT ?? resolve(resolveDalinarRoot(), "modules/hoid")
}

export function resolveHoidScript(name: string): string {
  return resolve(resolveHoidRoot(), `packages/cli/src/${name}.ts`)
}

export function resolveJiraScript(root?: string): string {
  return resolve(
    root ?? process.env.DALINAR_ROOT ?? process.cwd(),
    "skills/jira/jira-request.ts",
  )
}

// ── Dist artifact guard ───────────────────────────────────────────

export const assertNotDist = (resolvedPath: string): Effect.Effect<void, FileOperationError> =>
  /[/\\]dist[/\\]/.test(resolvedPath)
    ? Effect.fail(
        new FileOperationError({
          message: `Resolved path references dist artifact: ${resolvedPath}`,
          filePath: resolvedPath,
        }),
      )
    : Effect.void

// ── Preflight check ───────────────────────────────────────────────

export interface PreflightCheck {
  readonly name: string
  readonly path: string
  readonly ok: boolean
}

export const preflight = Effect.gen(function* () {
  const root = resolveDalinarRoot()
  const fs = yield* FileSystem.FileSystem

  const checks = [
    { name: "jasnah-search", path: resolveJasnahScript("search-memory.ts") },
    { name: "jasnah-extract", path: resolveJasnahScript("extract-inline.ts") },
    { name: "sazed-cli", path: resolveSazedCli() },
    { name: "jira-request", path: resolveJiraScript(root) },
  ]

  // Validate no dist artifacts in resolved paths
  yield* Effect.forEach(checks, (check) => assertNotDist(check.path))

  const results = yield* Effect.forEach(checks, (check) =>
    fs.exists(check.path).pipe(
      Effect.map((ok): PreflightCheck => ({ ...check, ok })),
      Effect.catchAll(() =>
        Effect.succeed<PreflightCheck>({ ...check, ok: false }),
      ),
    ),
  )

  const missing = results.filter((r) => !r.ok)
  if (missing.length > 0) {
    yield* Effect.logWarning(
      `Preflight: missing scripts: ${missing.map((m) => `${m.name} (${m.path})`).join(", ")}`,
    )
  }

  return { root, checks: results }
})
