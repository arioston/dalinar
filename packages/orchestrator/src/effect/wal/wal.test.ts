import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect } from "effect"
import { mkdtemp, rm, readFile, writeFile, mkdir } from "fs/promises"
import { tmpdir } from "os"
import { resolve, join } from "path"
import { Order, OrderLog } from "./schema.js"
import { appendOrder } from "./append.js"
import { promote } from "./promotion.js"
import { acquireLock, releaseLock } from "../ticket/lock.js"

const runWithFs = <A, E>(effect: Effect.Effect<A, E, import("@effect/platform").FileSystem.FileSystem>) =>
  Effect.runPromise(Effect.provide(effect, NodeFileSystem.layer))

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "wal-test-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ── Append ─────────────────────────────────────────────────────────

describe("appendOrder", () => {
  test("appends to empty WAL", async () => {
    const walPath = resolve(tempDir, ".orders", "orders-next.json")
    const order = new Order({
      id: "o1",
      ticketKey: "T-1",
      action: "claim",
      timestamp: "2026-01-01",
    })

    await runWithFs(appendOrder(walPath, order))

    const raw = await readFile(walPath, "utf-8")
    const log = JSON.parse(raw)
    expect(log.orders).toHaveLength(1)
    expect(log.orders[0].id).toBe("o1")
  })

  test("deduplicates by order id", async () => {
    const walPath = resolve(tempDir, ".orders", "orders-next.json")
    const order = new Order({
      id: "o1",
      ticketKey: "T-1",
      action: "claim",
      timestamp: "2026-01-01",
    })

    await runWithFs(appendOrder(walPath, order))
    await runWithFs(appendOrder(walPath, order))

    const raw = await readFile(walPath, "utf-8")
    const log = JSON.parse(raw)
    expect(log.orders).toHaveLength(1)
  })

  test("recovers from corrupt JSON in existing WAL", async () => {
    const walPath = resolve(tempDir, ".orders", "orders-next.json")
    await mkdir(resolve(tempDir, ".orders"), { recursive: true })

    // Write corrupt JSON
    await writeFile(walPath, "{ not valid json !!!", "utf-8")

    const order = new Order({
      id: "o1",
      ticketKey: "T-1",
      action: "claim",
      timestamp: "2026-01-01",
    })

    // Should treat corrupt file as empty WAL and write fresh
    await runWithFs(appendOrder(walPath, order))

    const raw = await readFile(walPath, "utf-8")
    const log = JSON.parse(raw)
    expect(log.orders).toHaveLength(1)
    expect(log.orders[0].id).toBe("o1")
  })

  test("handles WAL with missing orders field", async () => {
    const walPath = resolve(tempDir, ".orders", "orders-next.json")
    await mkdir(resolve(tempDir, ".orders"), { recursive: true })

    // Write JSON without orders field
    await writeFile(walPath, JSON.stringify({ version: 1 }), "utf-8")

    const order = new Order({
      id: "o1",
      ticketKey: "T-1",
      action: "claim",
      timestamp: "2026-01-01",
    })

    await runWithFs(appendOrder(walPath, order))

    const raw = await readFile(walPath, "utf-8")
    const log = JSON.parse(raw)
    expect(log.orders).toHaveLength(1)
  })

  test("creates nested directories when needed", async () => {
    // Deep path that doesn't exist
    const walPath = resolve(tempDir, "a", "b", "c", "orders-next.json")
    const order = new Order({
      id: "o1",
      ticketKey: "T-1",
      action: "claim",
      timestamp: "2026-01-01",
    })

    await runWithFs(appendOrder(walPath, order))

    const raw = await readFile(walPath, "utf-8")
    const log = JSON.parse(raw)
    expect(log.orders).toHaveLength(1)
  })

  test("preserves lastPromotedAt from existing WAL", async () => {
    const walPath = resolve(tempDir, ".orders", "orders-next.json")
    await mkdir(resolve(tempDir, ".orders"), { recursive: true })

    const existing = { orders: [], lastPromotedAt: "2026-01-01T00:00:00Z" }
    await writeFile(walPath, JSON.stringify(existing), "utf-8")

    const order = new Order({
      id: "o1",
      ticketKey: "T-1",
      action: "claim",
      timestamp: "2026-01-02",
    })

    await runWithFs(appendOrder(walPath, order))

    const raw = await readFile(walPath, "utf-8")
    const log = JSON.parse(raw)
    expect(log.orders).toHaveLength(1)
    expect(log.lastPromotedAt).toBe("2026-01-01T00:00:00Z")
  })

  test("appends multiple distinct orders", async () => {
    const walPath = resolve(tempDir, ".orders", "orders-next.json")

    await runWithFs(
      appendOrder(
        walPath,
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
      ),
    )
    await runWithFs(
      appendOrder(
        walPath,
        new Order({ id: "o2", ticketKey: "T-1", action: "start", timestamp: "2026-01-02" }),
      ),
    )

    const raw = await readFile(walPath, "utf-8")
    const log = JSON.parse(raw)
    expect(log.orders).toHaveLength(2)
  })
})

// ── Promotion ──────────────────────────────────────────────────────

describe("promote", () => {
  test("promotes WAL to orders.json", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const targetPath = resolve(ordersDir, "orders.json")

    // Write WAL
    const wal = new OrderLog({
      orders: [
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
        new Order({ id: "o2", ticketKey: "T-1", action: "start", timestamp: "2026-01-02" }),
      ],
    })
    await writeFile(walPath, JSON.stringify(wal, null, 2), "utf-8")

    const result = await runWithFs(promote({ walPath, targetPath }))

    expect(result.promoted).toBe(2)
    expect(result.total).toBe(2)

    // Verify target
    const targetRaw = await readFile(targetPath, "utf-8")
    const targetLog = JSON.parse(targetRaw)
    expect(targetLog.orders).toHaveLength(2)

    // Verify WAL was truncated
    const walRaw = await readFile(walPath, "utf-8")
    const walLog = JSON.parse(walRaw)
    expect(walLog.orders).toHaveLength(0)
  })

  test("deduplicates during promotion", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const targetPath = resolve(ordersDir, "orders.json")

    // Write existing target
    const existing = new OrderLog({
      orders: [
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
      ],
    })
    await writeFile(targetPath, JSON.stringify(existing, null, 2), "utf-8")

    // Write WAL with duplicate + new
    const wal = new OrderLog({
      orders: [
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
        new Order({ id: "o2", ticketKey: "T-1", action: "start", timestamp: "2026-01-02" }),
      ],
    })
    await writeFile(walPath, JSON.stringify(wal, null, 2), "utf-8")

    const result = await runWithFs(promote({ walPath, targetPath }))

    expect(result.promoted).toBe(1) // Only o2 is new
    expect(result.total).toBe(2)
  })

  test("no-op when WAL is empty", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const targetPath = resolve(ordersDir, "orders.json")

    // Write empty WAL
    await writeFile(walPath, JSON.stringify({ orders: [] }, null, 2), "utf-8")

    const result = await runWithFs(promote({ walPath, targetPath }))

    expect(result.promoted).toBe(0)
    expect(result.total).toBe(0)
  })

  test("handles missing target gracefully", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const targetPath = resolve(ordersDir, "orders.json")

    const wal = new OrderLog({
      orders: [
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
      ],
    })
    await writeFile(walPath, JSON.stringify(wal, null, 2), "utf-8")

    // No target exists — should create it
    const result = await runWithFs(promote({ walPath, targetPath }))

    expect(result.promoted).toBe(1)
    const targetRaw = await readFile(targetPath, "utf-8")
    const targetLog = JSON.parse(targetRaw)
    expect(targetLog.orders).toHaveLength(1)
  })

  test("recovers from corrupt WAL JSON during promotion", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const targetPath = resolve(ordersDir, "orders.json")

    // Write corrupt WAL
    await writeFile(walPath, "not json at all", "utf-8")

    // Should treat corrupt WAL as empty — no-op
    const result = await runWithFs(promote({ walPath, targetPath }))
    expect(result.promoted).toBe(0)
    expect(result.total).toBe(0)
  })

  test("recovers from corrupt target JSON during promotion", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const targetPath = resolve(ordersDir, "orders.json")

    // Write valid WAL
    const wal = new OrderLog({
      orders: [
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
      ],
    })
    await writeFile(walPath, JSON.stringify(wal, null, 2), "utf-8")

    // Write corrupt target — backup will have corrupt content
    await writeFile(targetPath, "corrupt target", "utf-8")

    // Promotion should still work — treats corrupt target as empty
    const result = await runWithFs(promote({ walPath, targetPath }))
    expect(result.promoted).toBe(1)
    expect(result.total).toBe(1)

    // Verify target is now valid
    const targetRaw = await readFile(targetPath, "utf-8")
    const targetLog = JSON.parse(targetRaw)
    expect(targetLog.orders).toHaveLength(1)
  })

  test("handles missing WAL file during promotion", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const targetPath = resolve(ordersDir, "orders.json")

    // No WAL file exists at all
    const result = await runWithFs(promote({ walPath, targetPath }))
    expect(result.promoted).toBe(0)
    expect(result.total).toBe(0)
  })

  test("cleans up backup after successful promotion", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const targetPath = resolve(ordersDir, "orders.json")
    const backupPath = `${targetPath}.bak`

    // Write existing target (so backup gets created)
    const existing = new OrderLog({
      orders: [
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
      ],
    })
    await writeFile(targetPath, JSON.stringify(existing, null, 2), "utf-8")

    // Write WAL
    const wal = new OrderLog({
      orders: [
        new Order({ id: "o2", ticketKey: "T-1", action: "start", timestamp: "2026-01-02" }),
      ],
    })
    await writeFile(walPath, JSON.stringify(wal, null, 2), "utf-8")

    await runWithFs(promote({ walPath, targetPath }))

    // Backup should be cleaned up
    const backupExists = await readFile(backupPath, "utf-8").then(
      () => true,
      () => false,
    )
    expect(backupExists).toBe(false)
  })

  test("sets lastPromotedAt on target and WAL after promotion", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const targetPath = resolve(ordersDir, "orders.json")

    const wal = new OrderLog({
      orders: [
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
      ],
    })
    await writeFile(walPath, JSON.stringify(wal, null, 2), "utf-8")

    await runWithFs(promote({ walPath, targetPath }))

    const targetRaw = await readFile(targetPath, "utf-8")
    const targetLog = JSON.parse(targetRaw)
    expect(targetLog.lastPromotedAt).toBeTruthy()
    expect(typeof targetLog.lastPromotedAt).toBe("string")

    const walRaw = await readFile(walPath, "utf-8")
    const walLog = JSON.parse(walRaw)
    expect(walLog.lastPromotedAt).toBeTruthy()
  })

  test("preserves target data when WAL has only duplicates", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const targetPath = resolve(ordersDir, "orders.json")

    // Write existing target
    const existing = new OrderLog({
      orders: [
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
        new Order({ id: "o2", ticketKey: "T-1", action: "start", timestamp: "2026-01-02" }),
      ],
    })
    await writeFile(targetPath, JSON.stringify(existing, null, 2), "utf-8")

    // WAL contains only duplicates
    const wal = new OrderLog({
      orders: [
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
      ],
    })
    await writeFile(walPath, JSON.stringify(wal, null, 2), "utf-8")

    const result = await runWithFs(promote({ walPath, targetPath }))

    expect(result.promoted).toBe(0)
    expect(result.total).toBe(2)

    // Verify target still has both orders
    const targetRaw = await readFile(targetPath, "utf-8")
    const targetLog = JSON.parse(targetRaw)
    expect(targetLog.orders).toHaveLength(2)
  })

  test("concurrent promotes do not lose data", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const targetPath = resolve(ordersDir, "orders.json")

    // Write WAL with multiple orders
    const wal = new OrderLog({
      orders: [
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
        new Order({ id: "o2", ticketKey: "T-1", action: "start", timestamp: "2026-01-02" }),
        new Order({ id: "o3", ticketKey: "T-2", action: "claim", timestamp: "2026-01-03" }),
      ],
    })
    await writeFile(walPath, JSON.stringify(wal, null, 2), "utf-8")

    // Run two promotions in parallel — one should succeed, other should handle gracefully
    const results = await Promise.allSettled([
      runWithFs(promote({ walPath, targetPath })),
      runWithFs(promote({ walPath, targetPath })),
    ])

    // At least one should succeed
    const successes = results.filter((r) => r.status === "fulfilled")
    expect(successes.length).toBeGreaterThanOrEqual(1)

    // Target should have all 3 orders (no data loss)
    const targetRaw = await readFile(targetPath, "utf-8")
    const targetLog = JSON.parse(targetRaw)
    expect(targetLog.orders.length).toBeGreaterThanOrEqual(3)
  })

  test("idempotent when promoted twice", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const targetPath = resolve(ordersDir, "orders.json")

    const wal = new OrderLog({
      orders: [
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
      ],
    })
    await writeFile(walPath, JSON.stringify(wal, null, 2), "utf-8")

    await runWithFs(promote({ walPath, targetPath }))
    const result2 = await runWithFs(promote({ walPath, targetPath }))

    // Second promotion should be a no-op since WAL was truncated
    expect(result2.promoted).toBe(0)
    expect(result2.total).toBe(0)
  })
})

// ── WALService (locked append + promote) ──────────────────────────

describe("WAL locking", () => {
  test("concurrent locked appends do not lose data", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const walLockPath = resolve(ordersDir, "wal.lock")

    const lockedAppend = (order: Order) =>
      Effect.scoped(
        Effect.acquireUseRelease(
          acquireLock(walLockPath),
          () => appendOrder(walPath, order),
          () => releaseLock(walLockPath),
        ),
      )

    // Fire 5 concurrent appends
    const orders = Array.from({ length: 5 }, (_, i) =>
      new Order({ id: `o${i}`, ticketKey: `T-${i}`, action: "claim", timestamp: `2026-01-0${i + 1}` }),
    )

    await Promise.all(
      orders.map((order) =>
        Effect.runPromise(Effect.provide(lockedAppend(order), NodeFileSystem.layer)),
      ),
    )

    // All 5 should be present
    const raw = await readFile(walPath, "utf-8")
    const log = JSON.parse(raw)
    expect(log.orders).toHaveLength(5)
  })

  test("append during promotion does not lose data", async () => {
    const ordersDir = resolve(tempDir, ".orders")
    await mkdir(ordersDir, { recursive: true })

    const walPath = resolve(ordersDir, "orders-next.json")
    const targetPath = resolve(ordersDir, "orders.json")
    const walLockPath = resolve(ordersDir, "wal.lock")

    // Seed WAL with 2 orders
    const wal = new OrderLog({
      orders: [
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
        new Order({ id: "o2", ticketKey: "T-2", action: "claim", timestamp: "2026-01-02" }),
      ],
    })
    await writeFile(walPath, JSON.stringify(wal, null, 2), "utf-8")

    const lockedPromote = Effect.scoped(
      Effect.acquireUseRelease(
        acquireLock(walLockPath),
        () => promote({ walPath, targetPath }),
        () => releaseLock(walLockPath),
      ),
    )

    const lockedAppend = (order: Order) =>
      Effect.scoped(
        Effect.acquireUseRelease(
          acquireLock(walLockPath),
          () => appendOrder(walPath, order),
          () => releaseLock(walLockPath),
        ),
      )

    // Race: promote + append a new order concurrently
    const newOrder = new Order({ id: "o3", ticketKey: "T-3", action: "claim", timestamp: "2026-01-03" })

    await Promise.all([
      Effect.runPromise(Effect.provide(lockedPromote, NodeFileSystem.layer)),
      Effect.runPromise(Effect.provide(lockedAppend(newOrder), NodeFileSystem.layer)),
    ])

    // Count all orders across both files — nothing should be lost
    const targetRaw = await readFile(targetPath, "utf-8").catch(() => '{"orders":[]}')
    const walRaw = await readFile(walPath, "utf-8").catch(() => '{"orders":[]}')
    const targetOrders = JSON.parse(targetRaw).orders
    const walOrders = JSON.parse(walRaw).orders

    // Deduplicate by id
    const allIds = new Set([
      ...targetOrders.map((o: { id: string }) => o.id),
      ...walOrders.map((o: { id: string }) => o.id),
    ])

    // All 3 orders should exist somewhere (promoted or still in WAL)
    expect(allIds.size).toBe(3)
    expect(allIds.has("o1")).toBe(true)
    expect(allIds.has("o2")).toBe(true)
    expect(allIds.has("o3")).toBe(true)
  })
})
