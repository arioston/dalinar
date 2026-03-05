import { Context, Effect, Layer } from "effect"
import { $ } from "bun"
import { SubprocessError } from "./errors.js"

export interface SubprocessResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface SubprocessRunOptions {
  readonly args: readonly string[]
  readonly cwd?: string | undefined
  readonly env?: Record<string, string | undefined> | undefined
  readonly nothrow?: boolean | undefined
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

export const SubprocessServiceLive = Layer.succeed(SubprocessService, {
  run: (command, opts) =>
    Effect.tryPromise({
      try: async () => {
        const proc = $`bun run ${command} ${opts.args as string[]}`
          .quiet()
          .nothrow()

        if (opts.cwd) proc.cwd(opts.cwd)
        if (opts.env) proc.env({ ...process.env, ...opts.env })

        const result = await proc
        return {
          stdout: result.stdout.toString().trim(),
          stderr: result.stderr.toString().trim(),
          exitCode: result.exitCode,
        }
      },
      catch: (error) =>
        new SubprocessError({
          message: `Command failed: ${command}`,
          command,
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
              }),
            )
          : Effect.succeed(result),
      ),
    ),
})
