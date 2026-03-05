import { Context, Effect, Layer } from "effect"
import { mkdir, readFile, writeFile } from "fs/promises"
import { resolve } from "path"
import { FileOperationError, TicketStateError } from "../errors.js"
import type { TicketState } from "./state.js"
import { Unclaimed } from "./state.js"
import { encodeTicketState, decodeTicketState } from "./persistence.js"
import { transition } from "./transitions.js"
import type { TicketAction } from "./actions.js"

export interface TicketStoreShape {
  readonly load: (
    ticketKey: string,
  ) => Effect.Effect<TicketState | null, FileOperationError>
  readonly save: (
    state: TicketState,
  ) => Effect.Effect<void, FileOperationError>
  readonly apply: (
    ticketKey: string,
    action: TicketAction,
  ) => Effect.Effect<TicketState, FileOperationError | TicketStateError>
}

export class TicketStore extends Context.Tag("@dalinar/TicketStore")<
  TicketStore,
  TicketStoreShape
>() {}

function ticketDir(root: string): string {
  return resolve(root, ".orders", "tickets")
}

function ticketPath(root: string, ticketKey: string): string {
  return resolve(ticketDir(root), `${ticketKey.toLowerCase()}.json`)
}

export const makeTicketStore = (root: string) =>
  Effect.gen(function* () {
    // Ensure directory exists
    yield* Effect.tryPromise({
      try: () => mkdir(ticketDir(root), { recursive: true }),
      catch: (error) =>
        new FileOperationError({
          message: "Failed to create ticket directory",
          filePath: ticketDir(root),
          cause: error,
        }),
    })

    const load: TicketStoreShape["load"] = (ticketKey) =>
      Effect.tryPromise({
        try: async () => {
          try {
            const raw = await readFile(ticketPath(root, ticketKey), "utf-8")
            return decodeTicketState(raw)
          } catch (e: unknown) {
            if (
              e instanceof Error &&
              "code" in e &&
              (e as NodeJS.ErrnoException).code === "ENOENT"
            ) {
              return null
            }
            throw e
          }
        },
        catch: (error) =>
          new FileOperationError({
            message: `Failed to load ticket state for ${ticketKey}`,
            filePath: ticketPath(root, ticketKey),
            cause: error,
          }),
      })

    const save: TicketStoreShape["save"] = (state) =>
      Effect.tryPromise({
        try: () =>
          writeFile(
            ticketPath(root, state.ticketKey),
            encodeTicketState(state),
            "utf-8",
          ),
        catch: (error) =>
          new FileOperationError({
            message: `Failed to save ticket state for ${state.ticketKey}`,
            filePath: ticketPath(root, state.ticketKey),
            cause: error,
          }),
      })

    const apply: TicketStoreShape["apply"] = (ticketKey, action) =>
      Effect.gen(function* () {
        const current = yield* load(ticketKey)
        const state = current ?? Unclaimed({ ticketKey })

        const result = transition(state, action)
        if (result instanceof TicketStateError) {
          return yield* Effect.fail(result)
        }

        yield* save(result)
        return result
      })

    return { load, save, apply } satisfies TicketStoreShape
  })

export const TicketStoreLive = (root: string) =>
  Layer.effect(TicketStore, makeTicketStore(root))
