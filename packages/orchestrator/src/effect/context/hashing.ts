import { createHash } from "crypto"

function sortObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(sortObject)
  if (typeof obj === "object") {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortObject((obj as Record<string, unknown>)[key])
    }
    return sorted
  }
  return obj
}

export function contentHash(payload: unknown): string {
  const sorted = sortObject(payload)
  const json = JSON.stringify(sorted)
  return createHash("sha256").update(json).digest("hex")
}
