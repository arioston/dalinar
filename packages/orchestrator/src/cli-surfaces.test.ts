import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { resolve } from "path"

const ROOT = resolve(import.meta.dir, "../../..")

const CLI_ENTRY_POINTS = [
  "packages/orchestrator/src/analyze-with-context.ts",
  "packages/orchestrator/src/implement-ticket.ts",
  "packages/orchestrator/src/audit.ts",
  "packages/orchestrator/src/dialectic.ts",
  "packages/orchestrator/src/reflect.ts",
  "packages/orchestrator/src/vault-sync.ts",
]

describe("CLI surfaces", () => {
  for (const entry of CLI_ENTRY_POINTS) {
    test(`${entry} loads without crash`, async () => {
      const result = await $`bun run ${resolve(ROOT, entry)} --help`
        .quiet()
        .nothrow()
        .env({ ...process.env, SKIP_MAIN: "1" })
      const output = result.stdout.toString() + result.stderr.toString()
      expect(output).not.toContain("Cannot find module")
      expect(output).not.toContain("SyntaxError")
      expect(output).not.toContain("ReferenceError")
      expect(output).not.toContain("TypeError")
      expect(output).not.toContain("segmentation fault")
      expect(output).not.toContain("panic:")
      expect(output).not.toContain("SIGABRT")
      expect(output).not.toContain("SIGSEGV")
      // Signals (128+N) indicate crashes, not normal exits
      expect(result.exitCode).toBeLessThan(128)
    })
  }
})
