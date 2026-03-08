import { Context, Effect, Layer } from "effect"
import { FileSystem } from "@effect/platform"
import { resolve } from "path"
import { FileOperationError, TicketStateError } from "../errors.js"
import type { TicketState } from "./state.js"
import { Unclaimed } from "./state.js"
import { encodeTicketState, decodeTicketState } from "./persistence.js"
import { transition } from "./transitions.js"
import type { TicketAction } from "./actions.js"
import { acquireLock, releaseLock } from "./lock.js"

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

const toFileError = (filePath: string, message: string) => (cause: unknown) =>
  new FileOperationError({ message, filePath, cause })

export const makeTicketStore = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    // Ensure directory exists
    yield* fs.makeDirectory(ticketDir(root), { recursive: true }).pipe(
      Effect.mapError(toFileError(ticketDir(root), "Failed to create ticket directory")),
    )

    const load: TicketStoreShape["load"] = (ticketKey) =>
      Effect.gen(function* () {
        const filePath = ticketPath(root, ticketKey)

        const readResult = yield* fs.readFileString(filePath).pipe(
          Effect.map((raw) => raw as string | null),
          Effect.catchTag("SystemError", (error) =>
            error.reason === "NotFound"
              ? Effect.succeed(null as string | null)
              : Effect.fail(
                  new FileOperationError({
                    message: `Failed to load ticket state for ${ticketKey}`,
                    filePath,
                    cause: error,
                  }),
                ),
          ),
          Effect.catchTag("BadArgument", (error) =>
            Effect.fail(
              new FileOperationError({
                message: `Failed to load ticket state for ${ticketKey}`,
                filePath,
                cause: error,
              }),
            ),
          ),
        )

        if (readResult === null) return null

        return yield* decodeTicketState(readResult).pipe(
          Effect.mapError(
            (parseError) =>
              new FileOperationError({
                message: `Failed to decode ticket state for ${ticketKey}`,
                filePath,
                cause: parseError,
              }),
          ),
        )
      })

    const save: TicketStoreShape["save"] = (state) =>
      fs
        .writeFileString(
          ticketPath(root, state.ticketKey),
          encodeTicketState(state),
        )
        .pipe(
          Effect.mapError(
            toFileError(
              ticketPath(root, state.ticketKey),
              `Failed to save ticket state for ${state.ticketKey}`,
            ),
          ),
        )

    const apply: TicketStoreShape["apply"] = (ticketKey, action) => {
      const lockPath = resolve(ticketDir(root), `${ticketKey.toLowerCase()}.lock`)

      return Effect.scoped(
        Effect.acquireUseRelease(
          acquireLock(lockPath).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
          () =>
            Effect.gen(function* () {
              const current = yield* load(ticketKey)
              const state = current ?? Unclaimed({ ticketKey })

              const result = yield* transition(state, action)

              yield* save(result)
              return result
            }),
          () => releaseLock(lockPath).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
        ),
      )
    }

    return { load, save, apply } satisfies TicketStoreShape
  })

export const TicketStoreLive = (root: string) =>
  Layer.effect(TicketStore, makeTicketStore(root))
