import { Match } from "effect"
import { TicketStateError } from "../errors.js"
import {
  Unclaimed,
  Claimed,
  InProgress,
  Done,
  Blocked,
  type TicketState,
} from "./state.js"
import type { TicketAction } from "./actions.js"

function illegalTransition(
  state: TicketState,
  action: TicketAction,
): TicketStateError {
  return new TicketStateError({
    message: `Cannot apply ${action._tag} to ticket in ${state._tag} state`,
    ticketKey: state.ticketKey,
    fromState: state._tag,
    toState: action._tag.replace("Action", ""),
  })
}

const now = () => new Date().toISOString()

export function transition(
  state: TicketState,
  action: TicketAction,
): TicketState | TicketStateError {
  return Match.value(action).pipe(
    Match.tag("ClaimAction", (a) =>
      Match.value(state).pipe(
        Match.tag("Unclaimed", (s) =>
          Claimed({
            ticketKey: s.ticketKey,
            claimedBy: a.claimedBy,
            claimedAt: now(),
          }),
        ),
        Match.orElse((s) => illegalTransition(s, a)),
      ),
    ),
    Match.tag("StartProgressAction", (a) =>
      Match.value(state).pipe(
        Match.tag("Claimed", (s) =>
          InProgress({
            ticketKey: s.ticketKey,
            claimedBy: s.claimedBy,
            claimedAt: s.claimedAt,
            startedAt: now(),
          }),
        ),
        Match.orElse((s) => illegalTransition(s, a)),
      ),
    ),
    Match.tag("CompleteAction", (a) =>
      Match.value(state).pipe(
        Match.tag("InProgress", (s) =>
          Done({
            ticketKey: s.ticketKey,
            claimedBy: s.claimedBy,
            completedAt: now(),
          }),
        ),
        Match.orElse((s) => illegalTransition(s, a)),
      ),
    ),
    Match.tag("BlockAction", (a) =>
      Match.value(state).pipe(
        Match.tag("InProgress", (s) =>
          Blocked({
            ticketKey: s.ticketKey,
            claimedBy: s.claimedBy,
            blockedAt: now(),
            reason: a.reason,
          }),
        ),
        Match.orElse((s) => illegalTransition(s, a)),
      ),
    ),
    Match.tag("UnblockAction", (a) =>
      Match.value(state).pipe(
        Match.tag("Blocked", (s) =>
          InProgress({
            ticketKey: s.ticketKey,
            claimedBy: s.claimedBy,
            claimedAt: s.blockedAt, // reuse blockedAt as approximate claimedAt
            startedAt: now(),
          }),
        ),
        Match.orElse((s) => illegalTransition(s, a)),
      ),
    ),
    Match.tag("ReleaseAction", (a) =>
      Match.value(state).pipe(
        Match.tag("Claimed", (s) =>
          Unclaimed({ ticketKey: s.ticketKey }),
        ),
        Match.tag("Blocked", (s) =>
          Unclaimed({ ticketKey: s.ticketKey }),
        ),
        Match.orElse((s) => illegalTransition(s, a)),
      ),
    ),
    Match.exhaustive,
  )
}
