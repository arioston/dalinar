import { FileSystem } from "@effect/platform"
import { Effect, Schema } from "effect"
import { dirname } from "path"
import { FileOperationError } from "../errors.js"
import { Order, OrderLog, OrderLogJson } from "./schema.js"

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

    // Load existing WAL
    const existing = yield* fs.readFileString(walPath).pipe(
      Effect.catchTag("SystemError", (e) =>
        e.reason === "NotFound" ? Effect.succeed("") : Effect.fail(e),
      ),
      Effect.flatMap((raw) =>
        raw ? Schema.decode(OrderLogJson)(raw) : Effect.succeed(new OrderLog({ orders: [] })),
      ),
      // Any failure (corrupt JSON, schema mismatch) → empty WAL
      Effect.catchAll(() => Effect.succeed(new OrderLog({ orders: [] }))),
    )

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
