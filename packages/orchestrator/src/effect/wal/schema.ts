import { Effect, Schema } from "effect"
import { FileSystem } from "@effect/platform"

export class Order extends Schema.Class<Order>("Order")({
  id: Schema.String,
  ticketKey: Schema.String,
  action: Schema.String,
  timestamp: Schema.String,
  payload: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
}) {}

export class OrderLog extends Schema.Class<OrderLog>("OrderLog")({
  orders: Schema.Array(Order),
  lastPromotedAt: Schema.optional(Schema.String),
}) {}

export const OrderLogJson = Schema.parseJson(OrderLog)

/**
 * Load an OrderLog from a file. Missing files return empty.
 * Corrupt files fail loudly — an audit log must never silently drop history.
 */
export const loadOrderLog = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(filePath).pipe(
      Effect.catchTag("SystemError", (e) =>
        e.reason === "NotFound" ? Effect.succeed("") : Effect.fail(e),
      ),
      Effect.flatMap((raw) =>
        raw ? Schema.decode(OrderLogJson)(raw) : Effect.succeed(new OrderLog({ orders: [] })),
      ),
    )
  })
