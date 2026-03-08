import { Effect, Schema } from "effect"
import type { ParseResult } from "effect"
import {
  type TicketState,
  Unclaimed,
  Claimed,
  InProgress,
  Done,
  Blocked,
} from "./state.js"

// -- Schema codecs for disk I/O (decode-at-edge) ───────────────────
// Each schema decodes raw JSON into a typed struct, then transforms
// it into a Data.tagged value so the output type IS TicketState.

const UnclaimedStruct = Schema.Struct({
  _tag: Schema.Literal("Unclaimed"),
  ticketKey: Schema.String,
})

const ClaimedStruct = Schema.Struct({
  _tag: Schema.Literal("Claimed"),
  ticketKey: Schema.String,
  claimedBy: Schema.String,
  claimedAt: Schema.String,
})

const InProgressStruct = Schema.Struct({
  _tag: Schema.Literal("InProgress"),
  ticketKey: Schema.String,
  claimedBy: Schema.String,
  claimedAt: Schema.String,
  startedAt: Schema.String,
})

const DoneStruct = Schema.Struct({
  _tag: Schema.Literal("Done"),
  ticketKey: Schema.String,
  claimedBy: Schema.String,
  completedAt: Schema.String,
})

const BlockedStruct = Schema.Struct({
  _tag: Schema.Literal("Blocked"),
  ticketKey: Schema.String,
  claimedBy: Schema.String,
  blockedAt: Schema.String,
  reason: Schema.String,
})

const UnclaimedSchema = Schema.transform(
  UnclaimedStruct,
  Schema.typeSchema(UnclaimedStruct),
  {
    strict: true,
    decode: (s) => Unclaimed({ ticketKey: s.ticketKey }),
    encode: (s) => ({ ...s }),
  },
)

const ClaimedSchema = Schema.transform(
  ClaimedStruct,
  Schema.typeSchema(ClaimedStruct),
  {
    strict: true,
    decode: (s) => Claimed({ ticketKey: s.ticketKey, claimedBy: s.claimedBy, claimedAt: s.claimedAt }),
    encode: (s) => ({ ...s }),
  },
)

const InProgressSchema = Schema.transform(
  InProgressStruct,
  Schema.typeSchema(InProgressStruct),
  {
    strict: true,
    decode: (s) => InProgress({ ticketKey: s.ticketKey, claimedBy: s.claimedBy, claimedAt: s.claimedAt, startedAt: s.startedAt }),
    encode: (s) => ({ ...s }),
  },
)

const DoneSchema = Schema.transform(
  DoneStruct,
  Schema.typeSchema(DoneStruct),
  {
    strict: true,
    decode: (s) => Done({ ticketKey: s.ticketKey, claimedBy: s.claimedBy, completedAt: s.completedAt }),
    encode: (s) => ({ ...s }),
  },
)

const BlockedSchema = Schema.transform(
  BlockedStruct,
  Schema.typeSchema(BlockedStruct),
  {
    strict: true,
    decode: (s) => Blocked({ ticketKey: s.ticketKey, claimedBy: s.claimedBy, blockedAt: s.blockedAt, reason: s.reason }),
    encode: (s) => ({ ...s }),
  },
)

export const TicketStateSchema = Schema.Union(
  UnclaimedSchema,
  ClaimedSchema,
  InProgressSchema,
  DoneSchema,
  BlockedSchema,
)

const TicketStateJson = Schema.parseJson(TicketStateSchema)

export const decodeTicketState = (json: string): Effect.Effect<TicketState, ParseResult.ParseError> =>
  Schema.decode(TicketStateJson)(json)

export function encodeTicketState(state: TicketState): string {
  return JSON.stringify(state, null, 2)
}
