import { describe, expect, test } from "bun:test"
import { $ } from "bun"

describe("CI guards", () => {
  test("no test files exist under dist/", async () => {
    const root = import.meta.dir + "/../../../.."
    const dirs = ["packages", "skills", "modules"]
    const matches: string[] = []
    for (const dir of dirs) {
      const glob = new Bun.Glob(`${dir}/**/dist/**/*.test.{ts,js,tsx,jsx}`)
      for await (const match of glob.scan({ cwd: root })) {
        matches.push(match)
      }
    }
    expect(matches).toEqual([])
  })

  test("no submodule has uncommitted changes", async () => {
    const result = await $`git submodule foreach --quiet 'git status --porcelain'`
      .quiet()
      .nothrow()
      .cwd(import.meta.dir + "/../../../..")
    const output = result.stdout.toString().trim()
    expect(output).toBe("")
  })

  test("no submodule pointer diverges from recorded commit", async () => {
    const result = await $`git submodule status`
      .quiet()
      .nothrow()
      .cwd(import.meta.dir + "/../../../..")
    const stdout = result.stdout.toString()
    const dirty = stdout
      .split("\n")
      .filter((line) => line.startsWith("+"))
      .map((line) => {
        const parts = line.trim().split(/\s+/)
        return parts[1] ?? line
      })
    if (dirty.length > 0) {
      throw new Error(`Diverged submodules: ${dirty.join(", ")}`)
    }
    expect(dirty).toEqual([])
  })
})
