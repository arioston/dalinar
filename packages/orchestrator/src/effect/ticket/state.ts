import { Data } from "effect"

export type TicketState =
  | Unclaimed
  | Claimed
  | InProgress
  | Done
  | Blocked

export interface Unclaimed {
  readonly _tag: "Unclaimed"
  readonly ticketKey: string
}

export interface Claimed {
  readonly _tag: "Claimed"
  readonly ticketKey: string
  readonly claimedBy: string
  readonly claimedAt: string
}

export interface InProgress {
  readonly _tag: "InProgress"
  readonly ticketKey: string
  readonly claimedBy: string
  readonly claimedAt: string
  readonly startedAt: string
}

export interface Done {
  readonly _tag: "Done"
  readonly ticketKey: string
  readonly claimedBy: string
  readonly completedAt: string
}

export interface Blocked {
  readonly _tag: "Blocked"
  readonly ticketKey: string
  readonly claimedBy: string
  readonly blockedAt: string
  readonly reason: string
}

export const Unclaimed = Data.tagged<Unclaimed>("Unclaimed")
export const Claimed = Data.tagged<Claimed>("Claimed")
export const InProgress = Data.tagged<InProgress>("InProgress")
export const Done = Data.tagged<Done>("Done")
export const Blocked = Data.tagged<Blocked>("Blocked")
