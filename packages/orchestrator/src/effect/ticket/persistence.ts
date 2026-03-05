import { Schema } from "effect"
import type { TicketState } from "./state.js"
import { Unclaimed, Claimed, InProgress, Done, Blocked } from "./state.js"

// ── Schema codecs for disk I/O (decode-at-edge) ───────────────────

const UnclaimedSchema = Schema.Struct({
  _tag: Schema.Literal("Unclaimed"),
  ticketKey: Schema.String,
})

const ClaimedSchema = Schema.Struct({
  _tag: Schema.Literal("Claimed"),
  ticketKey: Schema.String,
  claimedBy: Schema.String,
  claimedAt: Schema.String,
})

const InProgressSchema = Schema.Struct({
  _tag: Schema.Literal("InProgress"),
  ticketKey: Schema.String,
  claimedBy: Schema.String,
  claimedAt: Schema.String,
  startedAt: Schema.String,
})

const DoneSchema = Schema.Struct({
  _tag: Schema.Literal("Done"),
  ticketKey: Schema.String,
  claimedBy: Schema.String,
  completedAt: Schema.String,
})

const BlockedSchema = Schema.Struct({
  _tag: Schema.Literal("Blocked"),
  ticketKey: Schema.String,
  claimedBy: Schema.String,
  blockedAt: Schema.String,
  reason: Schema.String,
})

export const TicketStateSchema = Schema.Union(
  UnclaimedSchema,
  ClaimedSchema,
  InProgressSchema,
  DoneSchema,
  BlockedSchema,
)

export const TicketStateJson = Schema.parseJson(TicketStateSchema)

export function encodeTicketState(state: TicketState): string {
  return JSON.stringify(state, null, 2)
}

export function decodeTicketState(
  json: string,
): TicketState {
  const raw = JSON.parse(json)
  switch (raw._tag) {
    case "Unclaimed":
      return Unclaimed({ ticketKey: raw.ticketKey })
    case "Claimed":
      return Claimed({
        ticketKey: raw.ticketKey,
        claimedBy: raw.claimedBy,
        claimedAt: raw.claimedAt,
      })
    case "InProgress":
      return InProgress({
        ticketKey: raw.ticketKey,
        claimedBy: raw.claimedBy,
        claimedAt: raw.claimedAt,
        startedAt: raw.startedAt,
      })
    case "Done":
      return Done({
        ticketKey: raw.ticketKey,
        claimedBy: raw.claimedBy,
        completedAt: raw.completedAt,
      })
    case "Blocked":
      return Blocked({
        ticketKey: raw.ticketKey,
        claimedBy: raw.claimedBy,
        blockedAt: raw.blockedAt,
        reason: raw.reason,
      })
    default:
      throw new Error(`Unknown ticket state: ${raw._tag}`)
  }
}
