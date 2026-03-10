import { FileSystem } from "@effect/platform"
import { Clock, Effect } from "effect"
import { FileOperationError } from "../errors.js"
import { Order, OrderLog, loadOrderLog } from "./schema.js"

export interface PromotionPaths {
  readonly walPath: string // orders-next.json
  readonly targetPath: string // orders.json
}

export interface PromotionResult {
  readonly promoted: number
  readonly total: number
}

// ── Step 1-2: Load entries via shared helper ────────────────────────

const loadEntries = (filePath: string) =>
  loadOrderLog(filePath).pipe(
    Effect.map((log) => [...log.orders]),
  )

// ── Step 3: Merge entries with dedup ────────────────────────────────

const mergeEntries = (
  existing: readonly Order[],
  wal: readonly Order[],
): { merged: Order[]; newOrders: Order[] } => {
  const existingIds = new Set(existing.map((o) => o.id))
  const newOrders = wal.filter((o) => !existingIds.has(o.id))
  const merged = [...existing, ...newOrders]
  return { merged, newOrders }
}

// ── Step 4: Truncate WAL ────────────────────────────────────────────

const truncateWal = (walPath: string, timestamp: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const emptyWal = new OrderLog({
      orders: [],
      lastPromotedAt: timestamp,
    })
    yield* fs.writeFileString(walPath, JSON.stringify(emptyWal, null, 2)).pipe(
      Effect.mapError(
        (e) =>
          new FileOperationError({
            message: "Failed to truncate WAL",
            filePath: walPath,
            cause: e,
          }),
      ),
    )
  }).pipe(Effect.withSpan("wal-promote/truncate-wal"))

// ── Composed promotion pipeline ─────────────────────────────────────

export const promote = (paths: PromotionPaths) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const walOrders = yield* loadEntries(paths.walPath)
    if (walOrders.length === 0) return { promoted: 0, total: 0 } satisfies PromotionResult

    const existingOrders = yield* loadEntries(paths.targetPath)
    const { merged, newOrders } = mergeEntries(existingOrders, walOrders)
    const timestamp = yield* Clock.currentTimeMillis.pipe(Effect.map((ms) => new Date(ms).toISOString()))

    // Write to temp, then atomic rename
    const tmpPath = `${paths.targetPath}.tmp`
    const mergedLog = new OrderLog({ orders: [...merged], lastPromotedAt: timestamp })
    yield* fs.writeFileString(tmpPath, JSON.stringify(mergedLog, null, 2)).pipe(
      Effect.mapError(
        (e) =>
          new FileOperationError({
            message: "Failed to write merged orders to temp",
            filePath: tmpPath,
            cause: e,
          }),
      ),
    )
    yield* fs.rename(tmpPath, paths.targetPath).pipe(
      Effect.mapError(
        (e) =>
          new FileOperationError({
            message: "Failed to atomic-rename temp to target",
            filePath: paths.targetPath,
            cause: e,
          }),
      ),
    )

    // Truncate WAL (idempotent — dedup handles re-promotion)
    yield* truncateWal(paths.walPath, timestamp)

    return { promoted: newOrders.length, total: merged.length } satisfies PromotionResult
  }).pipe(Effect.withSpan("wal-promote"))
