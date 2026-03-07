import { resolve } from "path"

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
