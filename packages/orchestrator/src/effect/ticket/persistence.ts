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
// A single discriminated union schema, with one transform that wraps
// the decoded plain object into a Data.tagged value for structural equality.

const TicketStateRaw = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("Unclaimed"), ticketKey: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("Claimed"), ticketKey: Schema.String, claimedBy: Schema.String, claimedAt: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("InProgress"), ticketKey: Schema.String, claimedBy: Schema.String, claimedAt: Schema.String, startedAt: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("Done"), ticketKey: Schema.String, claimedBy: Schema.String, completedAt: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("Blocked"), ticketKey: Schema.String, claimedBy: Schema.String, blockedAt: Schema.String, reason: Schema.String }),
)

const tagConstructors: Record<string, (raw: any) => TicketState> = {
  Unclaimed, Claimed, InProgress, Done, Blocked,
}

export const TicketStateSchema = Schema.transform(
  TicketStateRaw,
  Schema.typeSchema(TicketStateRaw),
  {
    strict: true,
    decode: (raw) => tagConstructors[raw._tag](raw),
    encode: (s) => ({ ...s }),
  },
)

const TicketStateJson = Schema.parseJson(TicketStateSchema)

export const decodeTicketState = (json: string): Effect.Effect<TicketState, ParseResult.ParseError> =>
  Schema.decode(TicketStateJson)(json)

export function encodeTicketState(state: TicketState): string {
  return JSON.stringify(state, null, 2)
}
