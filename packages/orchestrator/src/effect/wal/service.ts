import { Context, Effect, Layer } from "effect"
import { resolve } from "path"
import { FileOperationError } from "../errors.js"
import { Order, type OrderLog } from "./schema.js"
import { appendOrder } from "./append.js"
import { promote } from "./promotion.js"
import { ProjectRoot } from "../services.js"

export interface WALServiceShape {
  readonly append: (
    order: Order,
  ) => Effect.Effect<OrderLog, FileOperationError>
  readonly promote: () => Effect.Effect<
    { promoted: number; total: number },
    FileOperationError
  >
}

export class WALService extends Context.Tag("@dalinar/WALService")<
  WALService,
  WALServiceShape
>() {}

export const makeWALService = Effect.gen(function* () {
  const { root } = yield* ProjectRoot
  return {
    append: (order: Order) =>
      appendOrder(resolve(root, ".orders", "orders-next.json"), order),
    promote: () =>
      promote({
        walPath: resolve(root, ".orders", "orders-next.json"),
        targetPath: resolve(root, ".orders", "orders.json"),
      }),
  } satisfies WALServiceShape
})

export const WALServiceLive = Layer.effect(WALService, makeWALService)
