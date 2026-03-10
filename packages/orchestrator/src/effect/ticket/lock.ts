import { Effect, Schedule, Duration } from "effect"
import { FileSystem } from "@effect/platform"
import { FileOperationError } from "../errors.js"

function isStale(lockContent: string): boolean {
  try {
    const trimmed = lockContent.trim()
    // Empty or non-numeric PID — treat as stale so a partial acquire
    // (mkdir succeeded, PID write failed) doesn't wedge the lock forever.
    if (!trimmed) return true
    const pid = parseInt(trimmed, 10)
    if (isNaN(pid)) return true
    process.kill(pid, 0)
    return false // process exists — lock is held
  } catch {
    return true // process.kill threw — PID doesn't exist, lock is stale
  }
}

export const acquireLock = (
  lockPath: string,
  opts?: {
    timeout?: Duration.DurationInput | undefined
    retryInterval?: Duration.DurationInput | undefined
  },
): Effect.Effect<void, FileOperationError, FileSystem.FileSystem> => {
  const timeout = opts?.timeout ?? Duration.seconds(5)
  const retryInterval = opts?.retryInterval ?? Duration.millis(100)
  const pid = String(process.pid)
  const pidPath = `${lockPath}/pid`

  const tryOnce: Effect.Effect<void, FileOperationError, FileSystem.FileSystem> = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    // mkdir is atomic: if it succeeds, we exclusively own the lock
    const acquired = yield* fs.makeDirectory(lockPath).pipe(
      Effect.as(true),
      Effect.catchTag("SystemError", (e) =>
        e.reason === "AlreadyExists"
          ? Effect.succeed(false)
          : Effect.fail(
              new FileOperationError({
                message: `Lock directory error: ${e.reason}`,
                filePath: lockPath,
                cause: e,
              }),
            ),
      ),
      Effect.catchTag("BadArgument", (e) =>
        Effect.fail(
          new FileOperationError({
            message: `Lock path invalid: ${e.message}`,
            filePath: lockPath,
            cause: e,
          }),
        ),
      ),
    )

    if (acquired) {
      // If PID write fails, roll back the directory so we don't wedge the lock
      yield* fs.writeFileString(pidPath, pid).pipe(
        Effect.catchAll(() =>
          fs.remove(lockPath, { recursive: true }).pipe(
            Effect.ignore,
            Effect.flatMap(() =>
              Effect.fail(new FileOperationError({ message: "Failed to write PID after acquiring lock", filePath: lockPath })),
            ),
          ),
        ),
      )
      return
    }

    // Directory already exists — check if the holder is still alive
    const content = yield* fs.readFileString(pidPath).pipe(
      Effect.catchAll(() => Effect.succeed("")),
    )

    if (isStale(content)) {
      yield* fs.remove(lockPath, { recursive: true }).pipe(Effect.ignore)
    }

    return yield* Effect.fail(
      new FileOperationError({ message: "Lock held by active process", filePath: lockPath }),
    )
  })

  return tryOnce.pipe(
    Effect.retry(Schedule.spaced(retryInterval)),
    Effect.timeoutFail({
      duration: timeout,
      onTimeout: () =>
        new FileOperationError({
          message: `Lock acquisition timed out after ${Duration.toMillis(timeout)}ms`,
          filePath: lockPath,
        }),
    }),
  )
}

export const releaseLock = (
  lockPath: string,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const pidPath = `${lockPath}/pid`
    // Only release if we own the lock — prevents cross-process lock theft
    const content = yield* fs.readFileString(pidPath).pipe(
      Effect.catchAll(() => Effect.succeed("")),
    )
    if (content.trim() === String(process.pid)) {
      yield* fs.remove(lockPath, { recursive: true }).pipe(Effect.ignore)
    }
  })
