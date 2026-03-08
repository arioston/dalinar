import { Context, Effect, Layer, Duration, Schedule } from "effect"
import { SubprocessError } from "./errors.js"

export interface SubprocessResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly timedOut: boolean
}

export interface SubprocessRunOptions {
  readonly args: readonly string[]
  readonly cwd?: string | undefined
  readonly env?: Record<string, string | undefined> | undefined
  readonly nothrow?: boolean | undefined
  readonly stdin?: string | undefined
  readonly timeout?: Duration.DurationInput | undefined
  readonly retryPolicy?: Schedule.Schedule<unknown, unknown> | undefined
}

export type SubprocessErrorCategory =
  | "not-found"
  | "auth"
  | "timeout"
  | "crash"
  | "unknown"

export function classifyError(
  exitCode: number | undefined,
  stderr: string | undefined,
  timedOut: boolean,
): SubprocessErrorCategory {
  if (timedOut) return "timeout"
  if (exitCode === 127 || stderr?.includes("not found") || stderr?.includes("ENOENT")) return "not-found"
  if (stderr?.includes("401") || stderr?.includes("403") || stderr?.includes("auth")) return "auth"
  if (exitCode !== undefined && exitCode > 128) return "crash"
  return "unknown"
}

export interface SubprocessServiceShape {
  readonly run: (
    command: string,
    opts: SubprocessRunOptions,
  ) => Effect.Effect<SubprocessResult, SubprocessError>
}

export class SubprocessService extends Context.Tag("@dalinar/SubprocessService")<
  SubprocessService,
  SubprocessServiceShape
>() {}

const DEFAULT_TIMEOUT = Duration.seconds(30)

export const SubprocessServiceLive = Layer.succeed(SubprocessService, {
  run: (command, opts) => {
    const execute = Effect.tryPromise({
      try: async () => {
        const cmd = ["bun", "run", command, ...(opts.args as string[])]
        const spawnOpts: Parameters<typeof Bun.spawn>[1] = {
          env: opts.env ? { ...process.env, ...opts.env } : process.env,
          stdin: opts.stdin !== undefined ? new Blob([opts.stdin]) : "ignore",
          stdout: "pipe",
          stderr: "pipe",
        }
        if (opts.cwd) spawnOpts.cwd = opts.cwd
        const proc = Bun.spawn(cmd, spawnOpts)

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout as ReadableStream).text(),
          new Response(proc.stderr as ReadableStream).text(),
        ])

        const exitCode = await proc.exited

        return {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode,
          timedOut: false,
        }
      },
      catch: (error) =>
        new SubprocessError({
          message: `Command failed: ${command}`,
          command,
          category: "unknown",
          cause: error,
        }),
    }).pipe(
      Effect.flatMap((result) =>
        !opts.nothrow && result.exitCode !== 0
          ? Effect.fail(
              new SubprocessError({
                message: `Command failed with exit code ${result.exitCode}`,
                command,
                exitCode: result.exitCode,
                stderr: result.stderr,
                category: classifyError(result.exitCode, result.stderr, false),
              }),
            )
          : Effect.succeed(result),
      ),
    )

    // Apply timeout
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT
    const withTimeout = execute.pipe(
      Effect.timeoutFail({
        duration: timeout,
        onTimeout: () =>
          new SubprocessError({
            message: `Command timed out: ${command}`,
            command,
            category: "timeout",
          }),
      }),
    )

    // Apply retry policy if provided
    if (opts.retryPolicy) {
      return withTimeout.pipe(
        Effect.retry(opts.retryPolicy),
      )
    }

    return withTimeout
  },
})
