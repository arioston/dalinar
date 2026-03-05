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
