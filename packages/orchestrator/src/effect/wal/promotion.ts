import { Effect } from "effect"
import { readFile, writeFile, rename, unlink } from "fs/promises"
import { FileOperationError } from "../errors.js"
import { Order, OrderLog } from "./schema.js"

export interface PromotionPaths {
  readonly walPath: string // orders-next.json
  readonly targetPath: string // orders.json
}

export const promote = (paths: PromotionPaths) =>
  Effect.acquireRelease(
    // Acquire: backup orders.json
    Effect.tryPromise({
      try: async () => {
        const backupPath = `${paths.targetPath}.bak`
        try {
          await rename(paths.targetPath, backupPath)
        } catch (e: unknown) {
          if (
            e instanceof Error &&
            "code" in e &&
            (e as NodeJS.ErrnoException).code === "ENOENT"
          ) {
            // No existing orders.json, nothing to backup
          } else {
            throw e
          }
        }
        return backupPath
      },
      catch: (error) =>
        new FileOperationError({
          message: "Failed to backup orders.json",
          filePath: paths.targetPath,
          cause: error,
        }),
    }),
    // Release: remove backup on success
    (backupPath) =>
      Effect.tryPromise({
        try: async () => {
          try {
            await unlink(backupPath)
          } catch {
            // Backup may not exist if target didn't exist
          }
        },
        catch: () =>
          new FileOperationError({
            message: "Failed to clean up backup",
            filePath: backupPath,
          }),
      }).pipe(Effect.ignore),
  ).pipe(
    Effect.andThen((backupPath) =>
      Effect.tryPromise({
        try: async () => {
          // Load WAL (orders-next.json)
          let walOrders: Order[] = []
          try {
            const walRaw = await readFile(paths.walPath, "utf-8")
            const walLog = JSON.parse(walRaw)
            walOrders = (walLog.orders ?? []).map(
              (o: unknown) => new Order(o as any),
            )
          } catch {
            // Empty WAL — nothing to promote
            return { promoted: 0, total: 0 }
          }

          if (walOrders.length === 0) {
            return { promoted: 0, total: 0 }
          }

          // Load existing target orders
          let existingOrders: Order[] = []
          try {
            const targetRaw = await readFile(backupPath, "utf-8")
            const targetLog = JSON.parse(targetRaw)
            existingOrders = (targetLog.orders ?? []).map(
              (o: unknown) => new Order(o as any),
            )
          } catch {
            // No existing orders
          }

          // Merge with dedup
          const existingIds = new Set(existingOrders.map((o) => o.id))
          const newOrders = walOrders.filter((o) => !existingIds.has(o.id))
          const merged = [...existingOrders, ...newOrders]

          // Write merged to target
          const mergedLog = new OrderLog({
            orders: merged,
            lastPromotedAt: new Date().toISOString(),
          })
          await writeFile(
            paths.targetPath,
            JSON.stringify(mergedLog, null, 2),
            "utf-8",
          )

          // Truncate WAL
          const emptyWal = new OrderLog({
            orders: [],
            lastPromotedAt: new Date().toISOString(),
          })
          await writeFile(
            paths.walPath,
            JSON.stringify(emptyWal, null, 2),
            "utf-8",
          )

          return { promoted: newOrders.length, total: merged.length }
        },
        catch: (error) =>
          new FileOperationError({
            message: "Failed during promotion",
            filePath: paths.targetPath,
            cause: error,
          }),
      }),
    ),
    Effect.scoped,
    Effect.withSpan("wal-promote"),
  )
