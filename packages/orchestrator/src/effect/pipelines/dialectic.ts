import { Effect } from "effect"
import { JasnahService } from "../services.js"
import {
  buildPositionPrompt,
  buildSynthesisPrompt,
  type DialecticInput,
} from "../../dialectic.js"

export interface DialecticPipelineResult {
  constraints: { constraintA: string; constraintB: string }
  prompts: { positionA: string; positionB: string; synthesis: string }
  priorContext: string
}

function generateConstraints(input: DialecticInput): {
  constraintA: string
  constraintB: string
} {
  if (input.constraintA && input.constraintB) {
    return { constraintA: input.constraintA, constraintB: input.constraintB }
  }

  const vsMatch = input.question.match(/(.+?)\s+vs\.?\s+(.+?)[\?.]?$/i)
  if (vsMatch) {
    return {
      constraintA: `Assume we proceed with: ${vsMatch[1].trim()}`,
      constraintB: `Assume we proceed with: ${vsMatch[2].trim()}`,
    }
  }

  const shouldMatch = input.question.match(/should\s+we\s+(.+?)[\?.]?$/i)
  if (shouldMatch) {
    return {
      constraintA: `Assume we DO ${shouldMatch[1].trim()}`,
      constraintB: `Assume we DO NOT ${shouldMatch[1].trim()} and find an alternative approach`,
    }
  }

  return {
    constraintA: `Argue IN FAVOR of the proposed change: ${input.question}`,
    constraintB: `Argue AGAINST the proposed change and propose an alternative: ${input.question}`,
  }
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
