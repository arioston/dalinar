import { Effect } from "effect"
import { readFile, writeFile, mkdir } from "fs/promises"
import { dirname } from "path"
import { FileOperationError } from "../errors.js"
import { Order, OrderLog } from "./schema.js"

export const appendOrder = (walPath: string, order: Order) =>
  Effect.gen(function* () {
    // Ensure directory exists
    yield* Effect.tryPromise({
      try: () => mkdir(dirname(walPath), { recursive: true }),
      catch: (error) =>
        new FileOperationError({
          message: "Failed to create WAL directory",
          filePath: walPath,
          cause: error,
        }),
    })

    // Load existing WAL
    const existing = yield* Effect.tryPromise({
      try: async () => {
        try {
          const raw = await readFile(walPath, "utf-8")
          const parsed = JSON.parse(raw)
          return new OrderLog({
            orders: (parsed.orders ?? []).map(
              (o: unknown) => new Order(o as any),
            ),
            lastPromotedAt: parsed.lastPromotedAt,
          })
        } catch {
          return new OrderLog({ orders: [] })
        }
      },
      catch: (error) =>
        new FileOperationError({
          message: "Failed to read WAL",
          filePath: walPath,
          cause: error,
        }),
    })

    // Dedup by order.id
    if (existing.orders.some((o) => o.id === order.id)) {
      return existing // Already present, idempotent
    }

    const updated = new OrderLog({
      orders: [...existing.orders, order],
      lastPromotedAt: existing.lastPromotedAt,
    })

    yield* Effect.tryPromise({
      try: () => writeFile(walPath, JSON.stringify(updated, null, 2), "utf-8"),
      catch: (error) =>
        new FileOperationError({
          message: "Failed to write WAL",
          filePath: walPath,
          cause: error,
        }),
    })

    return updated
  }).pipe(Effect.withSpan("wal-append"))
