import { Context, Effect, Layer } from "effect"
import { FileSystem } from "@effect/platform"
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
  const fs = yield* FileSystem.FileSystem
  return {
    append: (order: Order) =>
      appendOrder(resolve(root, ".orders", "orders-next.json"), order).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
      ),
    promote: () =>
      promote({
        walPath: resolve(root, ".orders", "orders-next.json"),
        targetPath: resolve(root, ".orders", "orders.json"),
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
      ),
  } satisfies WALServiceShape
})

export const WALServiceLive = Layer.effect(WALService, makeWALService)
