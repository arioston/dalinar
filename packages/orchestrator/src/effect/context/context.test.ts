import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { contentHash } from "./hashing.js"
import { SnapshotService, SnapshotServiceLive, type SnapshotInput } from "./snapshot-service.js"
import { BacklogItem, CapacitySnapshot, HistoryEntry, MiseSnapshot } from "./schema.js"

// ── Hashing ────────────────────────────────────────────────────────

describe("contentHash", () => {
  test("deterministic for same content", () => {
    const a = contentHash({ foo: "bar", baz: 1 })
    const b = contentHash({ foo: "bar", baz: 1 })
    expect(a).toBe(b)
  })

  test("deterministic regardless of key order", () => {
    const a = contentHash({ baz: 1, foo: "bar" })
    const b = contentHash({ foo: "bar", baz: 1 })
    expect(a).toBe(b)
  })

  test("different for different content", () => {
    const a = contentHash({ foo: "bar" })
    const b = contentHash({ foo: "baz" })
    expect(a).not.toBe(b)
  })

  test("handles nested objects", () => {
    const a = contentHash({ a: { b: { c: 1 } } })
    const b = contentHash({ a: { b: { c: 1 } } })
    expect(a).toBe(b)
  })

  test("handles arrays", () => {
    const a = contentHash([1, 2, 3])
    const b = contentHash([1, 2, 3])
    expect(a).toBe(b)
  })

  test("different array order gives different hash", () => {
    const a = contentHash([1, 2, 3])
    const b = contentHash([3, 2, 1])
    expect(a).not.toBe(b)
  })
})

// ── Schema ─────────────────────────────────────────────────────────

describe("MiseSnapshot schema", () => {
  test("creates a valid snapshot", () => {
    const snapshot = new MiseSnapshot({
      timestamp: "2026-01-01T00:00:00Z",
      contentHash: "abc123",
      backlog: [
        new BacklogItem({
          key: "PROJ-1",
          summary: "Test item",
          status: "todo",
        }),
      ],
      capacity: new CapacitySnapshot({
        totalPoints: 20,
        completedPoints: 5,
        inProgressPoints: 8,
        blockedPoints: 2,
      }),
      recentHistory: [
        new HistoryEntry({
          timestamp: "2026-01-01T00:00:00Z",
          action: "created",
        }),
      ],
    })

    expect(snapshot.contentHash).toBe("abc123")
    expect(snapshot.backlog).toHaveLength(1)
    expect(snapshot.capacity.totalPoints).toBe(20)
  })
})

// ── Snapshot Service ───────────────────────────────────────────────

describe("SnapshotService", () => {
  const input: SnapshotInput = {
    backlog: [
      new BacklogItem({ key: "T-1", summary: "Task 1", status: "todo" }),
    ],
    capacity: new CapacitySnapshot({
      totalPoints: 10,
      completedPoints: 3,
      inProgressPoints: 4,
      blockedPoints: 0,
    }),
    recentHistory: [
      new HistoryEntry({ timestamp: "2026-01-01", action: "sprint-start" }),
    ],
  }

  const run = <A>(effect: Effect.Effect<A, never, SnapshotService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(SnapshotServiceLive)))

  test("current returns snapshot with hash", async () => {
    const snapshot = await run(
      Effect.gen(function* () {
        const svc = yield* SnapshotService
        return yield* svc.current(input)
      }),
    )

    expect(snapshot.contentHash).toBeTruthy()
    expect(snapshot.backlog).toHaveLength(1)
    expect(snapshot.timestamp).toBeTruthy()
  })

  test("current returns cached snapshot for same input", async () => {
    const [s1, s2] = await run(
      Effect.gen(function* () {
        const svc = yield* SnapshotService
        const first = yield* svc.current(input)
        const second = yield* svc.current(input)
        return [first, second] as const
      }),
    )

    expect(s1.contentHash).toBe(s2.contentHash)
    // Same object reference (cached)
    expect(s1).toBe(s2)
  })

  test("current returns new snapshot when input changes", async () => {
    const changedInput: SnapshotInput = {
      ...input,
      backlog: [
        new BacklogItem({ key: "T-1", summary: "Task 1 updated", status: "in-progress" }),
      ],
    }

    const [s1, s2] = await run(
      Effect.gen(function* () {
        const svc = yield* SnapshotService
        const first = yield* svc.current(input)
        const second = yield* svc.current(changedInput)
        return [first, second] as const
      }),
    )

    expect(s1.contentHash).not.toBe(s2.contentHash)
  })

  test("hasChanged detects changes", async () => {
    const changedInput: SnapshotInput = {
      ...input,
      capacity: new CapacitySnapshot({
        totalPoints: 10,
        completedPoints: 5, // changed
        inProgressPoints: 4,
        blockedPoints: 0,
      }),
    }

    const [unchanged, changed] = await run(
      Effect.gen(function* () {
        const svc = yield* SnapshotService
        yield* svc.current(input) // prime the cache
        const a = yield* svc.hasChanged(input)
        const b = yield* svc.hasChanged(changedInput)
        return [a, b] as const
      }),
    )

    expect(unchanged).toBe(false)
    expect(changed).toBe(true)
  })
})
