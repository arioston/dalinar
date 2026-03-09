import { Data } from "effect"

export type TicketState = Data.TaggedEnum<{
  Unclaimed: { readonly ticketKey: string }
  Claimed: {
    readonly ticketKey: string
    readonly claimedBy: string
    readonly claimedAt: string
  }
  InProgress: {
    readonly ticketKey: string
    readonly claimedBy: string
    readonly claimedAt: string
    readonly startedAt: string
  }
  Done: {
    readonly ticketKey: string
    readonly claimedBy: string
    readonly completedAt: string
  }
  Blocked: {
    readonly ticketKey: string
    readonly claimedBy: string
    readonly blockedAt: string
    readonly reason: string
  }
}>

export const { Unclaimed, Claimed, InProgress, Done, Blocked } = Data.taggedEnum<TicketState>()
