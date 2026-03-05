# Effect.ts Migration Guide — Dalinar Orchestrator

## Overview

The orchestrator migrates from imperative async/await with manual error handling to Effect.ts typed pipelines. Original functions remain as backward-compatible wrappers; CLI entrypoints try the Effect pipeline first with a fallback to the original.

## Architecture

```
src/effect/
  errors.ts         — TaggedError types (SubprocessError, JasnahError, etc.)
  subprocess.ts     — SubprocessService wrapping Bun's $ in Effect
  services.ts       — JasnahService, SazedService, HoidService
  runtime.ts        — OrchestratorLive layer + runCli helper
  index.ts          — Barrel exports
  pipelines/
    reflect.ts      — Reflect pipeline (worked example)
    vault-sync.ts   — Vault sync pipeline
    dialectic.ts    — Dialectic pipeline
    implement.ts    — Implement-ticket pipeline
    audit.ts        — Audit pipeline
    analyze.ts      — Analyze-with-context pipeline (flagship)
    pipelines.test.ts — Pipeline tests with test layers
  ticket/
    state.ts        — Data.tagged discriminated unions (Unclaimed, Claimed, etc.)
    actions.ts      — Action types (ClaimAction, StartProgressAction, etc.)
    transitions.ts  — Match.value exhaustive state machine
    persistence.ts  — Schema codecs for disk I/O (decode-at-edge)
    store.ts        — TicketStore service (file-based)
    ticket.test.ts  — State machine + persistence tests
  context/
    schema.ts       — Schema.Class types (BacklogItem, MiseSnapshot, etc.)
    hashing.ts      — Deterministic SHA-256 content hash
    snapshot-service.ts — SnapshotService with Ref-based caching
    context.test.ts — Schema + hashing + snapshot tests
  wal/
    schema.ts       — Order and OrderLog Schema.Class types
    append.ts       — Idempotent WAL append (dedup by order.id)
    promotion.ts    — acquireRelease crash-safe promotion
    service.ts      — WALService Context.Tag
    wal.test.ts     — Append + promotion tests
```

## Migration Status

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 | Done | Shared infrastructure (errors, services, runtime, layers) |
| Phase 1 | Done | All 6 pipelines migrated to Effect.gen chains |
| Phase 2 | Done | Ticket state machine protocol |
| Phase 3 | Done | Mise context snapshots with hash-based caching |
| Phase 4 | Done | Write-ahead log with atomic promotion |

### Not yet integrated (code exists, no consumer)

- **TicketStore + WAL** — Ready to wire into implement-ticket when a consumer (dashboard, CLI command) needs order history
- **SnapshotService** — Ready to enrich analyze pipeline when a data source feeds it
- **Semaphore** — Not needed; CLI scripts are single-writer (exit after one run)

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

## Pattern: Ticket State Machine (Phase 2)

Internal state uses `Data.tagged` discriminated unions — zero codec cost. Schema codecs are confined to `persistence.ts` for disk I/O only (decode-at-edge).

```typescript
// State (plain interface + Data.tagged constructor)
export interface Claimed {
  readonly _tag: "Claimed"
  readonly ticketKey: string
  readonly claimedBy: string
  readonly claimedAt: string
}
export const Claimed = Data.tagged<Claimed>("Claimed")

// Transitions via Match.value (exhaustive)
export function transition(state: TicketState, action: TicketAction): TicketState | TicketStateError {
  return Match.value(action).pipe(
    Match.tag("ClaimAction", (a) => Match.value(state).pipe(
      Match.tag("Unclaimed", () => Claimed({ ... })),
      Match.orElse((s) => illegalTransition(s, a)),
    )),
    Match.exhaustive,
  )
}
```

## Pattern: WAL Promotion (Phase 4)

Crash-safe `orders-next.json → orders.json` using `Effect.acquireRelease`:

```typescript
Effect.acquireRelease(
  // Acquire: backup orders.json → orders.json.bak
  backupEffect,
  // Release: remove backup on success
  cleanupEffect,
).pipe(
  Effect.andThen((backupPath) =>
    // Use: load WAL, merge, dedup, write target, truncate WAL
    mergeEffect,
  ),
  Effect.scoped,
)
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
  // ...
  const extractResult = await extractMemories(entries, { ... })
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
    const jasnah = yield* JasnahService
    yield* Effect.log(`Processing retrospective for ${reflection.sprint}...`)
    const entries = reflectionToMemories(reflection)
    if (entries.length === 0) {
      yield* Effect.log("No actionable entries from reflection.")
      return { entries } satisfies ReflectResult
    }
    // ...
    const extractResult = yield* jasnah.extractMemories(entries, { ... })
    return { entries, extractResult } satisfies ReflectResult
  }).pipe(Effect.withSpan("reflect"))
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

Pipelines use Effect's built-in tracing via `.pipe(Effect.withSpan("pipeline-name"))` at the end of each pipeline definition.

## Effect.gen Convention

Pipeline bodies should be "single-screen" — stage calls only, no inline business logic. Pure functions like `reflectionToMemories` stay outside the generator. For simple operations (single yield + transform), prefer `Effect.map`/`Effect.flatMap` over `Effect.gen`.

## Testing with Layers

```typescript
import { Effect, Layer } from "effect"
import { JasnahService, SazedService } from "../services.js"
import { reflectPipeline } from "./reflect.js"

const TestJasnah = Layer.succeed(JasnahService, {
  searchMemories: () => Effect.succeed([]),
  searchContextForEpic: () => Effect.succeed([]),
  extractMemories: () => Effect.succeed({ success: true, output: "test" }),
  formatContextForPrompt: () => Effect.succeed(""),
})

const TestSazed = Layer.succeed(SazedService, {
  analyze: () => Effect.succeed({ success: true, markdown: "# Test" }),
  syncToJira: () => Effect.succeed({ success: true, output: "ok" }),
  checkStatus: () => Effect.succeed("ok"),
  listNotes: () => Effect.succeed(""),
  searchNotes: () => Effect.succeed(""),
})

// Compose and provide:
const TestLayer = Layer.mergeAll(TestJasnah, TestSazed)
const result = await Effect.runPromise(
  analyzeWithContextPipeline({ epicKey: "EPIC-1" }).pipe(
    Effect.provide(TestLayer),
  ),
)
```

## Test Coverage

| Module | Tests | Coverage |
|--------|-------|----------|
| Pipelines (reflect, dialectic, analyze, implement, audit) | 20 | Happy path, error path, dry run, constraint generation, pure functions |
| Ticket state machine | Transitions, illegal transitions, persistence roundtrip | All legal + illegal transitions |
| Context snapshots | Schema validation, content hashing, snapshot service | Cache invalidation on hash change |
| WAL | Append, dedup, promotion, rollback, idempotency | Normal + edge cases |
