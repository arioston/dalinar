import { Effect, Schema } from "effect"
import { readFile } from "fs/promises"
import { join } from "path"
import { FileOperationError } from "../errors.js"
import { Order, OrderLog } from "./schema.js"

const OrderLogJson = Schema.parseJson(OrderLog)
const decodeOrderLog = Schema.decodeUnknown(OrderLogJson)

/**
 * Read and merge orders from both `orders.json` (promoted) and
 * `orders-next.json` (unpromoted WAL) in the given directory.
 * Missing files are treated as empty — no error is raised.
 * Orders are deduplicated by `id` and `ticketKey` is normalised to lowercase.
 */
export const readOrders = (dir: string) =>
  Effect.gen(function* () {
    const targetPath = join(dir, "orders.json")
    const walPath = join(dir, "orders-next.json")

    const loadOrders = (filePath: string) =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () => readFile(filePath, "utf-8"),
          catch: () =>
            new FileOperationError({
              message: "Failed to read orders file",
              filePath,
            }),
        }).pipe(Effect.catchAll(() => Effect.succeed("")))

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
