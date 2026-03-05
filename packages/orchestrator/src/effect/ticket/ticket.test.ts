import { describe, expect, test } from "bun:test"
import { Unclaimed, Claimed, InProgress, Done, Blocked } from "./state.js"
import { transition } from "./transitions.js"
import { encodeTicketState, decodeTicketState } from "./persistence.js"
import { TicketStateError } from "../errors.js"

// ── State transitions ──────────────────────────────────────────────

describe("ticket transitions", () => {
  const key = "PROJ-123"

  test("Unclaimed → Claimed via ClaimAction", () => {
    const state = Unclaimed({ ticketKey: key })
    const result = transition(state, { _tag: "ClaimAction", claimedBy: "alice" })
    expect(result).toMatchObject({ _tag: "Claimed", ticketKey: key, claimedBy: "alice" })
  })

  test("Claimed → InProgress via StartProgressAction", () => {
    const state = Claimed({ ticketKey: key, claimedBy: "alice", claimedAt: "2026-01-01" })
    const result = transition(state, { _tag: "StartProgressAction" })
    expect(result).toMatchObject({ _tag: "InProgress", ticketKey: key, claimedBy: "alice" })
  })

  test("InProgress → Done via CompleteAction", () => {
    const state = InProgress({ ticketKey: key, claimedBy: "alice", claimedAt: "2026-01-01", startedAt: "2026-01-02" })
    const result = transition(state, { _tag: "CompleteAction" })
    expect(result).toMatchObject({ _tag: "Done", ticketKey: key, claimedBy: "alice" })
  })

  test("InProgress → Blocked via BlockAction", () => {
    const state = InProgress({ ticketKey: key, claimedBy: "alice", claimedAt: "2026-01-01", startedAt: "2026-01-02" })
    const result = transition(state, { _tag: "BlockAction", reason: "Waiting on API" })
    expect(result).toMatchObject({ _tag: "Blocked", ticketKey: key, reason: "Waiting on API" })
  })

  test("Blocked → InProgress via UnblockAction", () => {
    const state = Blocked({ ticketKey: key, claimedBy: "alice", blockedAt: "2026-01-03", reason: "deps" })
    const result = transition(state, { _tag: "UnblockAction" })
    expect(result).toMatchObject({ _tag: "InProgress", ticketKey: key, claimedBy: "alice" })
  })

  test("Claimed → Unclaimed via ReleaseAction", () => {
    const state = Claimed({ ticketKey: key, claimedBy: "alice", claimedAt: "2026-01-01" })
    const result = transition(state, { _tag: "ReleaseAction" })
    expect(result).toMatchObject({ _tag: "Unclaimed", ticketKey: key })
  })

  test("Blocked → Unclaimed via ReleaseAction", () => {
    const state = Blocked({ ticketKey: key, claimedBy: "alice", blockedAt: "2026-01-03", reason: "deps" })
    const result = transition(state, { _tag: "ReleaseAction" })
    expect(result).toMatchObject({ _tag: "Unclaimed", ticketKey: key })
  })
})

describe("illegal transitions", () => {
  const key = "PROJ-456"

  test("Unclaimed cannot StartProgress", () => {
    const state = Unclaimed({ ticketKey: key })
    const result = transition(state, { _tag: "StartProgressAction" })
    expect(result).toBeInstanceOf(TicketStateError)
    expect((result as TicketStateError).fromState).toBe("Unclaimed")
  })

  test("Unclaimed cannot Complete", () => {
    const state = Unclaimed({ ticketKey: key })
    const result = transition(state, { _tag: "CompleteAction" })
    expect(result).toBeInstanceOf(TicketStateError)
  })

  test("Done cannot be Claimed", () => {
    const state = Done({ ticketKey: key, claimedBy: "alice", completedAt: "2026-01-05" })
    const result = transition(state, { _tag: "ClaimAction", claimedBy: "bob" })
    expect(result).toBeInstanceOf(TicketStateError)
  })

  test("Done cannot be Released", () => {
    const state = Done({ ticketKey: key, claimedBy: "alice", completedAt: "2026-01-05" })
    const result = transition(state, { _tag: "ReleaseAction" })
    expect(result).toBeInstanceOf(TicketStateError)
  })

  test("Claimed cannot Complete directly", () => {
    const state = Claimed({ ticketKey: key, claimedBy: "alice", claimedAt: "2026-01-01" })
    const result = transition(state, { _tag: "CompleteAction" })
    expect(result).toBeInstanceOf(TicketStateError)
  })

  test("InProgress cannot be Claimed", () => {
    const state = InProgress({ ticketKey: key, claimedBy: "alice", claimedAt: "2026-01-01", startedAt: "2026-01-02" })
    const result = transition(state, { _tag: "ClaimAction", claimedBy: "bob" })
    expect(result).toBeInstanceOf(TicketStateError)
  })
})

// ── Persistence roundtrip ──────────────────────────────────────────

describe("ticket persistence", () => {
  const states = [
    Unclaimed({ ticketKey: "T-1" }),
    Claimed({ ticketKey: "T-2", claimedBy: "alice", claimedAt: "2026-01-01" }),
    InProgress({ ticketKey: "T-3", claimedBy: "bob", claimedAt: "2026-01-01", startedAt: "2026-01-02" }),
    Done({ ticketKey: "T-4", claimedBy: "carol", completedAt: "2026-01-05" }),
    Blocked({ ticketKey: "T-5", claimedBy: "dave", blockedAt: "2026-01-03", reason: "API down" }),
  ]

  for (const state of states) {
    test(`roundtrip: ${state._tag}`, () => {
      const json = encodeTicketState(state)
      const decoded = decodeTicketState(json)
      expect(decoded._tag).toBe(state._tag)
      expect(decoded.ticketKey).toBe(state.ticketKey)
    })
  }
})
