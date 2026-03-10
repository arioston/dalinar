import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { mkdtemp, rm, readFile, mkdir } from "fs/promises"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { NodeFileSystem } from "@effect/platform-node"
import { Unclaimed, Claimed, InProgress, Done, Blocked } from "./state.js"
import { transition } from "./transitions.js"
import { encodeTicketState, decodeTicketState } from "./persistence.js"
import { TicketStateError } from "../errors.js"
import { makeTicketStore } from "./store.js"
import { acquireLock, releaseLock } from "./lock.js"
import { WALService, type WALServiceShape } from "../wal/service.js"
import { OrderLog } from "../wal/schema.js"

/** No-op WAL service for ticket store tests — appends are best-effort anyway */
const TestWALService = Layer.succeed(WALService, {
  append: () => Effect.succeed(new OrderLog({ orders: [] })),
  promote: () => Effect.succeed({ promoted: 0, total: 0 }),
} satisfies WALServiceShape)

const testLayer = Layer.merge(NodeFileSystem.layer, TestWALService)

const runWithFs = <A, E>(effect: Effect.Effect<A, E, import("@effect/platform").FileSystem.FileSystem | WALService>) =>
  Effect.runPromise(Effect.provide(effect, testLayer))

// -- State transitions ──────────────────────────────────────────────

describe("ticket transitions", () => {
  const key = "PROJ-123"

  test("Unclaimed -> Claimed via ClaimAction", async () => {
    const result = await Effect.runPromise(
      transition(Unclaimed({ ticketKey: key }), { _tag: "ClaimAction", claimedBy: "alice" }),
    )
    expect(result).toMatchObject({ _tag: "Claimed", ticketKey: key, claimedBy: "alice" })
  })

  test("Claimed -> InProgress via StartProgressAction", async () => {
    const state = Claimed({ ticketKey: key, claimedBy: "alice", claimedAt: "2026-01-01" })
    const result = await Effect.runPromise(transition(state, { _tag: "StartProgressAction" }))
    expect(result).toMatchObject({ _tag: "InProgress", ticketKey: key, claimedBy: "alice" })
  })

  test("InProgress -> Done via CompleteAction", async () => {
    const state = InProgress({ ticketKey: key, claimedBy: "alice", claimedAt: "2026-01-01", startedAt: "2026-01-02" })
    const result = await Effect.runPromise(transition(state, { _tag: "CompleteAction" }))
    expect(result).toMatchObject({ _tag: "Done", ticketKey: key, claimedBy: "alice" })
  })

  test("InProgress -> Blocked via BlockAction", async () => {
    const state = InProgress({ ticketKey: key, claimedBy: "alice", claimedAt: "2026-01-01", startedAt: "2026-01-02" })
    const result = await Effect.runPromise(transition(state, { _tag: "BlockAction", reason: "Waiting on API" }))
    expect(result).toMatchObject({ _tag: "Blocked", ticketKey: key, reason: "Waiting on API" })
  })

  test("Blocked -> InProgress via UnblockAction", async () => {
    const state = Blocked({ ticketKey: key, claimedBy: "alice", blockedAt: "2026-01-03", reason: "deps" })
    const result = await Effect.runPromise(transition(state, { _tag: "UnblockAction" }))
    expect(result).toMatchObject({ _tag: "InProgress", ticketKey: key, claimedBy: "alice" })
  })

  test("Claimed -> Unclaimed via ReleaseAction", async () => {
    const state = Claimed({ ticketKey: key, claimedBy: "alice", claimedAt: "2026-01-01" })
    const result = await Effect.runPromise(transition(state, { _tag: "ReleaseAction" }))
    expect(result).toMatchObject({ _tag: "Unclaimed", ticketKey: key })
  })

  test("Blocked -> Unclaimed via ReleaseAction", async () => {
    const state = Blocked({ ticketKey: key, claimedBy: "alice", blockedAt: "2026-01-03", reason: "deps" })
    const result = await Effect.runPromise(transition(state, { _tag: "ReleaseAction" }))
    expect(result).toMatchObject({ _tag: "Unclaimed", ticketKey: key })
  })
})

describe("illegal transitions", () => {
  const key = "PROJ-456"

  test("Unclaimed cannot StartProgress", async () => {
    const state = Unclaimed({ ticketKey: key })
    const exit = await Effect.runPromiseExit(transition(state, { _tag: "StartProgressAction" }))
    expect(exit._tag).toBe("Failure")
    if (Exit.isFailure(exit)) {
      const error = exit.cause
      // Extract the TicketStateError from the cause
      expect(error._tag).toBe("Fail")
    }
  })

  test("Unclaimed cannot Complete", async () => {
    const state = Unclaimed({ ticketKey: key })
    const exit = await Effect.runPromiseExit(transition(state, { _tag: "CompleteAction" }))
    expect(exit._tag).toBe("Failure")
  })

  test("Done cannot be Claimed", async () => {
    const state = Done({ ticketKey: key, claimedBy: "alice", completedAt: "2026-01-05" })
    const exit = await Effect.runPromiseExit(transition(state, { _tag: "ClaimAction", claimedBy: "bob" }))
    expect(exit._tag).toBe("Failure")
  })

  test("Done cannot be Released", async () => {
    const state = Done({ ticketKey: key, claimedBy: "alice", completedAt: "2026-01-05" })
    const exit = await Effect.runPromiseExit(transition(state, { _tag: "ReleaseAction" }))
    expect(exit._tag).toBe("Failure")
  })

  test("Claimed cannot Complete directly", async () => {
    const state = Claimed({ ticketKey: key, claimedBy: "alice", claimedAt: "2026-01-01" })
    const exit = await Effect.runPromiseExit(transition(state, { _tag: "CompleteAction" }))
    expect(exit._tag).toBe("Failure")
  })

  test("InProgress cannot be Claimed", async () => {
    const state = InProgress({ ticketKey: key, claimedBy: "alice", claimedAt: "2026-01-01", startedAt: "2026-01-02" })
    const exit = await Effect.runPromiseExit(transition(state, { _tag: "ClaimAction", claimedBy: "bob" }))
    expect(exit._tag).toBe("Failure")
  })
})

// -- Persistence roundtrip ──────────────────────────────────────────

describe("ticket persistence", () => {
  const states = [
    Unclaimed({ ticketKey: "T-1" }),
    Claimed({ ticketKey: "T-2", claimedBy: "alice", claimedAt: "2026-01-01" }),
    InProgress({ ticketKey: "T-3", claimedBy: "bob", claimedAt: "2026-01-01", startedAt: "2026-01-02" }),
    Done({ ticketKey: "T-4", claimedBy: "carol", completedAt: "2026-01-05" }),
    Blocked({ ticketKey: "T-5", claimedBy: "dave", blockedAt: "2026-01-03", reason: "API down" }),
  ]

  for (const state of states) {
    test(`roundtrip: ${state._tag}`, async () => {
      const json = encodeTicketState(state)
      const decoded = await Effect.runPromise(decodeTicketState(json))
      expect(decoded._tag).toBe(state._tag)
      expect(decoded.ticketKey).toBe(state.ticketKey)
    })
  }
})

// -- TicketStore (disk persistence + locking) ──────────────────────

describe("TicketStore", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ticket-store-test-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test("apply creates new ticket and saves to disk", async () => {
    const store = await runWithFs(makeTicketStore(tempDir))

    const result = await Effect.runPromise(
      store.apply("PROJ-1", { _tag: "ClaimAction", claimedBy: "alice" }),
    )

    expect(result._tag).toBe("Claimed")
    expect(result.ticketKey).toBe("PROJ-1")

    // Verify persisted to disk
    const loaded = await Effect.runPromise(store.load("PROJ-1"))
    expect(loaded).not.toBeNull()
    expect(loaded!._tag).toBe("Claimed")
  })

  test("sequential applies transition correctly", async () => {
    const store = await runWithFs(makeTicketStore(tempDir))

    await Effect.runPromise(
      store.apply("PROJ-2", { _tag: "ClaimAction", claimedBy: "bob" }),
    )
    const result = await Effect.runPromise(
      store.apply("PROJ-2", { _tag: "StartProgressAction" }),
    )

    expect(result._tag).toBe("InProgress")
  })

  test("illegal transition fails with TicketStateError", async () => {
    const store = await runWithFs(makeTicketStore(tempDir))

    await Effect.runPromise(
      store.apply("PROJ-3", { _tag: "ClaimAction", claimedBy: "carol" }),
    )

    const exit = await Effect.runPromiseExit(
      store.apply("PROJ-3", { _tag: "CompleteAction" }), // Can't complete from Claimed
    )

    expect(exit._tag).toBe("Failure")
  })

  test("concurrent applies on same ticket serialize correctly", async () => {
    const store = await runWithFs(makeTicketStore(tempDir))

    // Claim first
    await Effect.runPromise(
      store.apply("PROJ-4", { _tag: "ClaimAction", claimedBy: "dave" }),
    )

    // Two concurrent transitions — only one valid sequence
    const results = await Promise.allSettled([
      Effect.runPromise(store.apply("PROJ-4", { _tag: "StartProgressAction" })),
      Effect.runPromise(store.apply("PROJ-4", { _tag: "ReleaseAction" })),
    ])

    // Both should complete (one succeeds, other operates on the resulting state)
    const successes = results.filter((r) => r.status === "fulfilled")
    expect(successes.length).toBeGreaterThanOrEqual(1)

    // Final state should be consistent
    const final = await Effect.runPromise(store.load("PROJ-4"))
    expect(final).not.toBeNull()
    expect(["InProgress", "Unclaimed"]).toContain(final!._tag)
  })

  test("load returns null for nonexistent ticket", async () => {
    const store = await runWithFs(makeTicketStore(tempDir))
    const result = await Effect.runPromise(store.load("NONEXISTENT"))
    expect(result).toBeNull()
  })
})

// -- Lock behavior ───────────────────────────────────────────────────

describe("acquireLock", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lock-test-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const runLock = <A, E>(effect: Effect.Effect<A, E, import("@effect/platform").FileSystem.FileSystem>) =>
    Effect.runPromise(Effect.provide(effect, NodeFileSystem.layer))

  test("acquires and releases lock", async () => {
    const lockPath = join(tempDir, "test.lock")
    await runLock(acquireLock(lockPath))
    await runLock(releaseLock(lockPath))
  })

  test("empty PID file is treated as held (not stale)", async () => {
    const lockPath = join(tempDir, "test.lock")
    // Simulate the PID write gap: create dir but write empty PID
    await mkdir(lockPath)
    const { writeFile } = await import("fs/promises")
    await writeFile(join(lockPath, "pid"), "")

    // Should time out (not steal the lock) — use a very short timeout
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        acquireLock(lockPath, { timeout: "200 millis", retryInterval: "50 millis" }),
        NodeFileSystem.layer,
      ),
    )
    expect(exit._tag).toBe("Failure")
  })

  test("stale PID lock is reclaimed", async () => {
    const lockPath = join(tempDir, "test.lock")
    // Write a PID that definitely doesn't exist (very high number)
    await mkdir(lockPath)
    const { writeFile } = await import("fs/promises")
    await writeFile(join(lockPath, "pid"), "9999999")

    // Should successfully acquire (stale lock cleaned up)
    await runLock(acquireLock(lockPath, { timeout: "2 seconds" }))
    await runLock(releaseLock(lockPath))
  })
})
