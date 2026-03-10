import { Context, Duration, Effect, Layer } from "effect"
import { FileSystem } from "@effect/platform"
import { resolve } from "path"
import { FileOperationError } from "../errors.js"
import { Order, type OrderLog } from "./schema.js"
import { appendOrder } from "./append.js"
import { promote } from "./promotion.js"
import { ProjectRoot } from "../services.js"
import { acquireLock, releaseLock } from "../ticket/lock.js"

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
  const walPath = resolve(root, ".orders", "orders-next.json")
  const targetPath = resolve(root, ".orders", "orders.json")
  const walLockPath = resolve(root, ".orders", "wal.lock")

  return {
    append: (order: Order) =>
      Effect.scoped(
        Effect.acquireUseRelease(
          acquireLock(walLockPath).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
          () => appendOrder(walPath, order).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
          () => releaseLock(walLockPath).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
        ),
      ),
    promote: () =>
      Effect.scoped(
        Effect.acquireUseRelease(
          acquireLock(walLockPath, { timeout: Duration.seconds(10) }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
          ),
          () =>
            promote({ walPath, targetPath }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
            ),
          () => releaseLock(walLockPath).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
        ),
      ),
  } satisfies WALServiceShape
})

export const WALServiceLive = Layer.effect(WALService, makeWALService)
