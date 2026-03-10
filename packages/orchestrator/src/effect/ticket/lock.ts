import { Effect, Schedule, Duration } from "effect"
import { FileSystem } from "@effect/platform"
import { FileOperationError } from "../errors.js"

function isStale(lockContent: string): boolean {
  try {
    const pid = parseInt(lockContent.trim(), 10)
    if (isNaN(pid)) return true
    process.kill(pid, 0)
    return false
  } catch {
    return true
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
      Effect.catchAll(() => Effect.succeed(false)),
    )

    if (acquired) {
      yield* fs.writeFileString(pidPath, pid).pipe(
        Effect.mapError(
          () => new FileOperationError({ message: "Failed to acquire lock", filePath: lockPath }),
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
    yield* fs.remove(lockPath, { recursive: true }).pipe(Effect.ignore)
  })
