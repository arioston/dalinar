import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { dirname } from "path"
import { FileOperationError } from "../errors.js"
import { Order, OrderLog, loadOrderLog } from "./schema.js"

export const appendOrder = (walPath: string, order: Order) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    // Ensure directory exists
    yield* fs.makeDirectory(dirname(walPath), { recursive: true }).pipe(
      Effect.mapError(
        (e) =>
          new FileOperationError({
            message: "Failed to create WAL directory",
            filePath: walPath,
            cause: e,
          }),
      ),
    )

    const existing = yield* loadOrderLog(walPath)

    // Dedup by order.id
    if (existing.orders.some((o) => o.id === order.id)) {
      return existing // Already present, idempotent
    }

    const updated = new OrderLog({
      orders: [...existing.orders, order],
      lastPromotedAt: existing.lastPromotedAt,
    })

    yield* fs.writeFileString(walPath, JSON.stringify(updated, null, 2)).pipe(
      Effect.mapError(
        (e) =>
          new FileOperationError({
            message: "Failed to write WAL",
            filePath: walPath,
            cause: e,
          }),
      ),
    )

    return updated
  }).pipe(Effect.withSpan("wal-append"))
