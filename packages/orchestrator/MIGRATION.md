# Effect.ts Migration Guide — Dalinar Orchestrator

## Overview

The orchestrator migrates from imperative async/await with manual error handling to Effect.ts typed pipelines. Original functions remain as backward-compatible wrappers; CLI entrypoints try the Effect pipeline first with a fallback to the original.

## Architecture

```
src/effect/
  errors.ts         — TaggedError types (SubprocessError, JasnahError, etc.)
  subprocess.ts     — SubprocessService wrapping Bun's $ in Effect
  services.ts       — JasnahService, SazedService, HoidService
  runtime.ts        — OrchestratorLive layer + CorrelationContext FiberRef
  index.ts          — Barrel exports
  pipelines/
    reflect.ts      — Reflect pipeline (worked example)
    vault-sync.ts   — Vault sync pipeline
    dialectic.ts    — Dialectic pipeline
    implement.ts    — Implement-ticket pipeline
    audit.ts        — Audit pipeline
    analyze.ts      — Analyze-with-context pipeline (flagship)
```

## Pattern: TaggedError

Follows Sazed's pattern from `modules/sazed/packages/core/src/domain/errors.ts`:

```typescript
// Before: ad-hoc error handling
if (result.exitCode !== 0) {
  console.error(`[dalinar] Analysis failed: ${stderr}`)
  return { success: false, markdown: stderr }
}

// After: typed errors
export class SazedError extends Schema.TaggedError<SazedError>()("SazedError", {
  message: Schema.String,
  epicKey: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
}) {}
```

## Pattern: Service / Context.Tag

```typescript
// Interface shape
export interface JasnahServiceShape {
  readonly searchMemories: (opts: SearchOptions) =>
    Effect.Effect<readonly MemorySearchResult[], JasnahError>
}

// Tag
export class JasnahService extends Context.Tag("@dalinar/JasnahService")<
  JasnahService,
  JasnahServiceShape
>() {}

// Implementation
const makeJasnah = Effect.gen(function* () {
  const subprocess = yield* SubprocessService
  // ... return shape
})

export const JasnahServiceLive = Layer.effect(JasnahService, makeJasnah)
```

## Pattern: Layer Composition

```typescript
export const OrchestratorLive = Layer.mergeAll(
  JasnahServiceLive,
  SazedServiceLive,
  HoidServiceLive,
).pipe(Layer.provideMerge(SubprocessServiceLive))
```

## Worked Example: reflect pipeline

### Before (imperative)

```typescript
export async function runReflection(
  reflection: SprintReflection,
  opts: { dryRun?: boolean; root?: string } = {},
): Promise<{ entries: ExtractEntry[]; extractResult?: ... }> {
  console.log(`\n[dalinar] Processing retrospective for ${reflection.sprint}...\n`)

  const entries = reflectionToMemories(reflection)

  if (entries.length === 0) {
    console.log("[dalinar] No actionable entries from reflection.")
    return { entries }
  }

  console.log(`[dalinar] Generated ${entries.length} memory entries:`)
  for (const entry of entries) {
    console.log(`  [${entry.type}] ${entry.summary}`)
  }

  if (opts.dryRun) {
    console.log("\n[dalinar] Dry run — not extracting.")
    return { entries }
  }

  console.log(`\n[dalinar] Extracting ${entries.length} entries to Jasnah...`)
  const extractResult = await extractMemories(entries, {
    root: opts.root,
    source: `sprint-retro:${reflection.sprint}`,
  })

  if (extractResult.success) {
    console.log(`[dalinar] Done. ${entries.length} reflections saved.`)
  } else {
    console.warn(`[dalinar] Extraction failed: ${extractResult.output}`)
  }

  return { entries, extractResult }
}
```

### After (Effect.gen)

```typescript
export const reflectPipeline = (
  reflection: SprintReflection,
  opts: ReflectOptions = {},
) =>
  Effect.gen(function* () {
    yield* withSpan("reflect")
    const jasnah = yield* JasnahService

    // Stage 1: Convert reflection to memory entries
    yield* Effect.log(`Processing retrospective for ${reflection.sprint}...`)
    const entries = reflectionToMemories(reflection)

    if (entries.length === 0) {
      yield* Effect.log("No actionable entries from reflection.")
      return { entries } satisfies ReflectResult
    }

    yield* Effect.log(`Generated ${entries.length} memory entries:`)
    for (const entry of entries) {
      yield* Effect.log(`  [${entry.type}] ${entry.summary}`)
    }

    // Stage 2: Extract to Jasnah (unless dry run)
    if (opts.dryRun) {
      yield* Effect.log("Dry run — not extracting.")
      return { entries } satisfies ReflectResult
    }

    yield* Effect.log(`Extracting ${entries.length} entries to Jasnah...`)
    const extractResult = yield* jasnah.extractMemories(entries, {
      root: opts.root,
      source: `sprint-retro:${reflection.sprint}`,
    })

    if (extractResult.success) {
      yield* Effect.log(`Done. ${entries.length} reflections saved.`)
    } else {
      yield* Effect.logWarning(`Extraction failed: ${extractResult.output}`)
    }

    return { entries, extractResult } satisfies ReflectResult
  })
```

### Key differences

| Aspect | Before | After |
|--------|--------|-------|
| Error type | `console.warn` + return | `JasnahError` propagates to caller |
| Logging | `console.log` | `Effect.log` (structured, interceptable) |
| Dependencies | Import + call directly | `yield* JasnahService` (injectable) |
| Testing | Must mock `extractMemories` globally | Provide test `JasnahService` layer |
| Crash safety | Unhandled promise rejection | Defect handling via Effect runtime |

### CLI entrypoint pattern

```typescript
// Original function stays as-is for backward compatibility.
// CLI tries Effect first, falls back on import failure:
if (import.meta.main) {
  try {
    const { Effect } = await import("effect")
    const { reflectPipeline } = await import("./effect/pipelines/reflect.js")
    const { OrchestratorLive } = await import("./effect/runtime.js")
    await Effect.runPromise(
      reflectPipeline(reflection, opts).pipe(Effect.provide(OrchestratorLive)),
    )
  } catch {
    await runReflection(reflection, opts)
  }
}
```

## Tracing

Pipelines use Effect's built-in tracing via `.pipe(Effect.withSpan("pipeline-name"))` at the end of each pipeline definition. This integrates with Effect's tracer system and properly scopes spans.

## Effect.gen Convention

Pipeline bodies should be "single-screen" — stage calls only, no inline business logic. Pure functions like `reflectionToMemories` stay outside the generator. For simple operations (single yield + transform), prefer `Effect.map`/`Effect.flatMap` over `Effect.gen`.

## Testing with Layers

```typescript
import { Effect, Layer } from "effect"
import { JasnahService } from "../services.js"
import { reflectPipeline } from "./reflect.js"

const TestJasnah = Layer.succeed(JasnahService, {
  searchMemories: () => Effect.succeed([]),
  searchContextForEpic: () => Effect.succeed([]),
  extractMemories: () => Effect.succeed({ success: true, output: "test" }),
  formatContextForPrompt: () => Effect.succeed(""),
})

// Use in test:
const result = await Effect.runPromise(
  reflectPipeline(testReflection, { dryRun: false }).pipe(
    Effect.provide(TestJasnah),
  ),
)
```
