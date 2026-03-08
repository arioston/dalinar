import { Clock, Context, Effect, Layer, Ref } from "effect"
import { contentHash } from "./hashing.js"
import type { MiseSnapshot, BacklogItem, CapacitySnapshot, HistoryEntry } from "./schema.js"
import { MiseSnapshot as MiseSnapshotClass } from "./schema.js"

export interface SnapshotInput {
  readonly backlog: readonly BacklogItem[]
  readonly capacity: CapacitySnapshot
  readonly recentHistory: readonly HistoryEntry[]
  readonly metadata?: Record<string, unknown> | undefined
}

export interface SnapshotServiceShape {
  readonly current: (
    input: SnapshotInput,
  ) => Effect.Effect<MiseSnapshot>
  readonly hasChanged: (
    input: SnapshotInput,
  ) => Effect.Effect<boolean>
}

export class SnapshotService extends Context.Tag("@dalinar/SnapshotService")<
  SnapshotService,
  SnapshotServiceShape
>() {}

const makeSnapshotService = Effect.gen(function* () {
  const lastHashRef = yield* Ref.make("")
  const cacheRef = yield* Ref.make<MiseSnapshot | null>(null)

  const buildSnapshot = (input: SnapshotInput, timestamp: string): MiseSnapshot => {
    const hash = contentHash({
      backlog: input.backlog,
      capacity: input.capacity,
    })
    return new MiseSnapshotClass({
      timestamp,
      contentHash: hash,
      backlog: [...input.backlog],
      capacity: input.capacity,
      recentHistory: [...input.recentHistory],
      metadata: input.metadata,
    })
  }

  const current: SnapshotServiceShape["current"] = (input) =>
    Effect.gen(function* () {
      const hash = contentHash({
        backlog: input.backlog,
        capacity: input.capacity,
      })

      const lastHash = yield* Ref.get(lastHashRef)
      if (hash === lastHash) {
        const cached = yield* Ref.get(cacheRef)
        if (cached !== null) return cached
      }

      const timestamp = yield* Clock.currentTimeMillis.pipe(
        Effect.map((ms) => new Date(ms).toISOString()),
      )
      const snapshot = buildSnapshot(input, timestamp)
      yield* Ref.set(lastHashRef, hash)
      yield* Ref.set(cacheRef, snapshot)
      return snapshot
    })

  const hasChanged: SnapshotServiceShape["hasChanged"] = (input) =>
    Effect.gen(function* () {
      const hash = contentHash({
        backlog: input.backlog,
        capacity: input.capacity,
      })
      const lastHash = yield* Ref.get(lastHashRef)
      return hash !== lastHash
    })

  return { current, hasChanged } satisfies SnapshotServiceShape
})

export const SnapshotServiceLive = Layer.effect(SnapshotService, makeSnapshotService)
