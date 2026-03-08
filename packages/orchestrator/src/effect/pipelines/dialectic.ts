import { Effect } from "effect"
import { JasnahService } from "../services.js"
import {
  buildPositionPrompt,
  buildSynthesisPrompt,
  generateConstraints,
  type DialecticInput,
} from "../types/dialectic.js"

export interface DialecticPipelineResult {
  constraints: { constraintA: string; constraintB: string }
  prompts: { positionA: string; positionB: string; synthesis: string }
  priorContext: string
}

// ── Effect pipeline ────────────────────────────────────────────────

export const dialecticPipeline = (input: DialecticInput, root?: string) =>
  Effect.gen(function* () {
    const jasnah = yield* JasnahService

    // Stage 1: Search for prior context
    yield* Effect.log(`Dialectic analysis: "${input.question}"`)
    yield* Effect.log("Searching for prior context...")

    const memories = yield* jasnah.searchContextForEpic(
      input.question,
      root,
    )

    let priorContext = ""
    if (memories.length > 0) {
      yield* Effect.log(`  Found ${memories.length} relevant memories`)
      priorContext = memories
        .map((m) => `[${m.type}] ${m.summary}: ${m.content}`)
        .join("\n\n")
    }

    // Stage 2: Generate constraints
    const constraints = generateConstraints(input)
    yield* Effect.log(`Agent A: ${constraints.constraintA}`)
    yield* Effect.log(`Agent B: ${constraints.constraintB}`)

    // Stage 3: Build prompts
    const promptA = buildPositionPrompt(
      input.question,
      constraints.constraintA,
      priorContext,
      "A",
    )
    const promptB = buildPositionPrompt(
      input.question,
      constraints.constraintB,
      priorContext,
      "B",
    )
    const synthPrompt = buildSynthesisPrompt(
      input.question,
      "[Agent A's output will be inserted here]",
      "[Agent B's output will be inserted here]",
    )

    return {
      constraints,
      prompts: {
        positionA: promptA,
        positionB: promptB,
        synthesis: synthPrompt,
      },
      priorContext,
    } satisfies DialecticPipelineResult
  }).pipe(Effect.withSpan("dialectic"))
