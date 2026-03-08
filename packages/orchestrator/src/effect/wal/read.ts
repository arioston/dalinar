import { FileSystem } from "@effect/platform"
import { Effect, Schema } from "effect"
import { join } from "path"
import { FileOperationError } from "../errors.js"
import { Order, OrderLog, OrderLogJson } from "./schema.js"

const decodeOrderLog = Schema.decodeUnknown(OrderLogJson)

/**
 * Read and merge orders from both `orders.json` (promoted) and
 * `orders-next.json` (unpromoted WAL) in the given directory.
 * Missing files are treated as empty — no error is raised.
 * Orders are deduplicated by `id` and `ticketKey` is normalised to lowercase.
 */
export const readOrders = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    const targetPath = join(dir, "orders.json")
    const walPath = join(dir, "orders-next.json")

    const loadOrders = (filePath: string) =>
      Effect.gen(function* () {
        const raw = yield* fs.readFileString(filePath).pipe(
          Effect.catchTag("SystemError", (e) =>
            e.reason === "NotFound" ? Effect.succeed("") : Effect.fail(e),
          ),
          Effect.mapError(
            (e) =>
              new FileOperationError({
                message: "Failed to read orders file",
                filePath,
                cause: e,
              }),
          ),
          Effect.catchAll(() => Effect.succeed("")),
        )

        if (!raw) return [] as Order[]

        const log = yield* decodeOrderLog(raw).pipe(
          Effect.catchAll(() => Effect.succeed(new OrderLog({ orders: [] }))),
        )

        return [...log.orders]
      })

    const promoted = yield* loadOrders(targetPath)
    const unpromoted = yield* loadOrders(walPath)

    // Merge and deduplicate by order.id
    const seen = new Set<string>()
    const merged: Order[] = []

    for (const order of [...promoted, ...unpromoted]) {
      if (!seen.has(order.id)) {
        seen.add(order.id)
        merged.push(
          new Order({
            ...order,
            ticketKey: order.ticketKey.toLowerCase(),
          }),
        )
      }
    }

    return merged
  }).pipe(Effect.withSpan("wal-read"))
