import { Clock, Effect, Match } from "effect"
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

const illegalTransition = (
  state: TicketState,
  action: TicketAction,
): Effect.Effect<never, TicketStateError> =>
  Effect.fail(
    new TicketStateError({
      message: `Cannot apply ${action._tag} to ticket in ${state._tag} state`,
      ticketKey: state.ticketKey,
      fromState: state._tag,
      toState: action._tag.replace("Action", ""),
    }),
  )

const currentTimestamp = Clock.currentTimeMillis.pipe(
  Effect.map((ms) => new Date(ms).toISOString()),
)

export const transition = (
  state: TicketState,
  action: TicketAction,
): Effect.Effect<TicketState, TicketStateError> =>
  Effect.gen(function* () {
    const timestamp = yield* currentTimestamp

    return yield* Match.value(action).pipe(
      Match.tag("ClaimAction", (a) =>
        Match.value(state).pipe(
          Match.tag("Unclaimed", (s) =>
            Effect.succeed(
              Claimed({
                ticketKey: s.ticketKey,
                claimedBy: a.claimedBy,
                claimedAt: timestamp,
              }),
            ),
          ),
          Match.orElse((s) => illegalTransition(s, a)),
        ),
      ),
      Match.tag("StartProgressAction", (a) =>
        Match.value(state).pipe(
          Match.tag("Claimed", (s) =>
            Effect.succeed(
              InProgress({
                ticketKey: s.ticketKey,
                claimedBy: s.claimedBy,
                claimedAt: s.claimedAt,
                startedAt: timestamp,
              }),
            ),
          ),
          Match.orElse((s) => illegalTransition(s, a)),
        ),
      ),
      Match.tag("CompleteAction", (a) =>
        Match.value(state).pipe(
          Match.tag("InProgress", (s) =>
            Effect.succeed(
              Done({
                ticketKey: s.ticketKey,
                claimedBy: s.claimedBy,
                completedAt: timestamp,
              }),
            ),
          ),
          Match.orElse((s) => illegalTransition(s, a)),
        ),
      ),
      Match.tag("BlockAction", (a) =>
        Match.value(state).pipe(
          Match.tag("InProgress", (s) =>
            Effect.succeed(
              Blocked({
                ticketKey: s.ticketKey,
                claimedBy: s.claimedBy,
                blockedAt: timestamp,
                reason: a.reason,
              }),
            ),
          ),
          Match.orElse((s) => illegalTransition(s, a)),
        ),
      ),
      Match.tag("UnblockAction", (a) =>
        Match.value(state).pipe(
          Match.tag("Blocked", (s) =>
            Effect.succeed(
              InProgress({
                ticketKey: s.ticketKey,
                claimedBy: s.claimedBy,
                claimedAt: s.blockedAt, // reuse blockedAt as approximate claimedAt
                startedAt: timestamp,
              }),
            ),
          ),
          Match.orElse((s) => illegalTransition(s, a)),
        ),
      ),
      Match.tag("ReleaseAction", (a) =>
        Match.value(state).pipe(
          Match.tag("Claimed", (s) =>
            Effect.succeed(Unclaimed({ ticketKey: s.ticketKey })),
          ),
          Match.tag("Blocked", (s) =>
            Effect.succeed(Unclaimed({ ticketKey: s.ticketKey })),
          ),
          Match.orElse((s) => illegalTransition(s, a)),
        ),
      ),
      Match.exhaustive,
    )
  })
