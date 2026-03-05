import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm, readFile, writeFile, mkdir } from "fs/promises"
import { tmpdir } from "os"
import { resolve, join } from "path"
import { Order, OrderLog } from "./schema.js"
import { appendOrder } from "./append.js"
import { promote } from "./promotion.js"

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

    await Effect.runPromise(appendOrder(walPath, order))

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

    await Effect.runPromise(appendOrder(walPath, order))
    await Effect.runPromise(appendOrder(walPath, order))

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
    await Effect.runPromise(appendOrder(walPath, order))

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

    await Effect.runPromise(appendOrder(walPath, order))

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

    await Effect.runPromise(appendOrder(walPath, order))

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

    await Effect.runPromise(appendOrder(walPath, order))

    const raw = await readFile(walPath, "utf-8")
    const log = JSON.parse(raw)
    expect(log.orders).toHaveLength(1)
    expect(log.lastPromotedAt).toBe("2026-01-01T00:00:00Z")
  })

  test("appends multiple distinct orders", async () => {
    const walPath = resolve(tempDir, ".orders", "orders-next.json")

    await Effect.runPromise(
      appendOrder(
        walPath,
        new Order({ id: "o1", ticketKey: "T-1", action: "claim", timestamp: "2026-01-01" }),
      ),
    )
    await Effect.runPromise(
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

    const result = await Effect.runPromise(promote({ walPath, targetPath }))

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

    const result = await Effect.runPromise(promote({ walPath, targetPath }))

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

    const result = await Effect.runPromise(promote({ walPath, targetPath }))

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
    const result = await Effect.runPromise(promote({ walPath, targetPath }))

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
    const result = await Effect.runPromise(promote({ walPath, targetPath }))
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
    const result = await Effect.runPromise(promote({ walPath, targetPath }))
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
    const result = await Effect.runPromise(promote({ walPath, targetPath }))
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

    await Effect.runPromise(promote({ walPath, targetPath }))

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

    await Effect.runPromise(promote({ walPath, targetPath }))

    const targetRaw = await readFile(targetPath, "utf-8")
    const targetLog = JSON.parse(targetRaw)
    expect(targetLog.lastPromotedAt).toBeTruthy()
    expect(typeof targetLog.lastPromotedAt).toBe("string")

    const walRaw = await readFile(walPath, "utf-8")
    const walLog = JSON.parse(walRaw)
    expect(walLog.lastPromotedAt).toBeTruthy()
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

    await Effect.runPromise(promote({ walPath, targetPath }))
    const result2 = await Effect.runPromise(promote({ walPath, targetPath }))

    // Second promotion should be a no-op since WAL was truncated
    expect(result2.promoted).toBe(0)
    expect(result2.total).toBe(0)
  })
})
