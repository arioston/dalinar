import { Data } from "effect"

export type TicketAction =
  | ClaimAction
  | StartProgressAction
  | CompleteAction
  | BlockAction
  | UnblockAction
  | ReleaseAction

export interface ClaimAction {
  readonly _tag: "ClaimAction"
  readonly claimedBy: string
}

export interface StartProgressAction {
  readonly _tag: "StartProgressAction"
}

export interface CompleteAction {
  readonly _tag: "CompleteAction"
}

export interface BlockAction {
  readonly _tag: "BlockAction"
  readonly reason: string
}

export interface UnblockAction {
  readonly _tag: "UnblockAction"
}

export interface ReleaseAction {
  readonly _tag: "ReleaseAction"
}

export const ClaimAction = Data.tagged<ClaimAction>("ClaimAction")
export const StartProgressAction = Data.tagged<StartProgressAction>("StartProgressAction")
export const CompleteAction = Data.tagged<CompleteAction>("CompleteAction")
export const BlockAction = Data.tagged<BlockAction>("BlockAction")
export const UnblockAction = Data.tagged<UnblockAction>("UnblockAction")
export const ReleaseAction = Data.tagged<ReleaseAction>("ReleaseAction")
