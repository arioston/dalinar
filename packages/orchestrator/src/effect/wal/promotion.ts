import { FileSystem } from "@effect/platform"
import { Clock, Effect, Schema } from "effect"
import { FileOperationError } from "../errors.js"
import { Order, OrderLog, OrderLogJson } from "./schema.js"

export interface PromotionPaths {
  readonly walPath: string // orders-next.json
  readonly targetPath: string // orders.json
}

export interface PromotionResult {
  readonly promoted: number
  readonly total: number
}

// ── Step 1: Load WAL entries ────────────────────────────────────────

const loadWalEntries = (walPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(walPath).pipe(
      Effect.catchTag("SystemError", (e) =>
        e.reason === "NotFound" ? Effect.succeed("") : Effect.fail(e),
      ),
      Effect.flatMap((raw) =>
        raw ? Schema.decode(OrderLogJson)(raw) : Effect.succeed(new OrderLog({ orders: [] })),
      ),
      Effect.map((log) => [...log.orders]),
      // Any failure (missing file, corrupt JSON, schema mismatch) → empty WAL
      Effect.catchAll(() => Effect.succeed([] as Order[])),
      Effect.withSpan("wal-promote/load-wal"),
    )
  })

// ── Step 2: Load target (orders.json) entries ───────────────────────

const loadTargetEntries = (targetPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(targetPath).pipe(
      Effect.catchTag("SystemError", (e) =>
        e.reason === "NotFound" ? Effect.succeed("") : Effect.fail(e),
      ),
      Effect.flatMap((raw) =>
        raw ? Schema.decode(OrderLogJson)(raw) : Effect.succeed(new OrderLog({ orders: [] })),
      ),
      Effect.map((log) => [...log.orders]),
      // Any failure → no existing orders
      Effect.catchAll(() => Effect.succeed([] as Order[])),
      Effect.withSpan("wal-promote/load-target"),
    )
  })

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

// ── Step 4: Write target (orders.json) ──────────────────────────────

const writeTarget = (targetPath: string, merged: readonly Order[], timestamp: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const mergedLog = new OrderLog({
      orders: [...merged],
      lastPromotedAt: timestamp,
    })
    yield* fs.writeFileString(targetPath, JSON.stringify(mergedLog, null, 2)).pipe(
      Effect.mapError(
        (e) =>
          new FileOperationError({
            message: "Failed to write merged orders to target",
            filePath: targetPath,
            cause: e,
          }),
      ),
    )
  }).pipe(Effect.withSpan("wal-promote/write-target"))

// ── Step 5: Truncate WAL ────────────────────────────────────────────

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

// ── Backup management ───────────────────────────────────────────────

const backupTarget = (targetPath: string) => {
  const backupPath = `${targetPath}.bak`
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.rename(targetPath, backupPath).pipe(
      Effect.catchTag("SystemError", (e) =>
        e.reason === "NotFound"
          ? Effect.void // No existing orders.json, nothing to backup
          : Effect.fail(e),
      ),
      Effect.mapError(
        (e) =>
          new FileOperationError({
            message: "Failed to backup orders.json",
            filePath: targetPath,
            cause: e,
          }),
      ),
    )
    return backupPath
  })
}

const cleanupBackup = (backupPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(backupPath).pipe(
      Effect.catchTag("SystemError", (e) =>
        e.reason === "NotFound" ? Effect.void : Effect.fail(e),
      ),
      Effect.catchAll(() => Effect.void),
    )
  }).pipe(Effect.ignore)

// ── Composed promotion pipeline ─────────────────────────────────────

export const promote = (paths: PromotionPaths) =>
  Effect.acquireRelease(
    backupTarget(paths.targetPath),
    (backupPath) => cleanupBackup(backupPath),
  ).pipe(
    Effect.andThen((backupPath) =>
      Effect.gen(function* () {
        // Step 1: Load WAL entries
        const walOrders = yield* loadWalEntries(paths.walPath)

        if (walOrders.length === 0) {
          return { promoted: 0, total: 0 } satisfies PromotionResult
        }

        // Step 2: Load existing target entries (from backup)
        const existingOrders = yield* loadTargetEntries(backupPath)

        // Step 3: Merge with dedup (pure)
        const { merged, newOrders } = mergeEntries(existingOrders, walOrders)

        // Step 4: Get timestamp and write target
        const timestamp = yield* Clock.currentTimeMillis.pipe(
          Effect.map((ms) => new Date(ms).toISOString()),
        )
        yield* writeTarget(paths.targetPath, merged, timestamp)

        // Step 5: Truncate WAL
        yield* truncateWal(paths.walPath, timestamp)

        return { promoted: newOrders.length, total: merged.length } satisfies PromotionResult
      }),
    ),
    Effect.scoped,
    Effect.withSpan("wal-promote"),
  )
