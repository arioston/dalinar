#!/usr/bin/env bun
/**
 * dialectic — Adversarial reasoning for high-stakes decisions.
 *
 * Inspired by the Hegelian Dialectic Skill. For architectural decisions,
 * generates two isolated opposing analyses with different constraints,
 * then synthesizes into a balanced recommendation.
 *
 * The pipeline produces structured output that can be saved as an
 * architecture note with alternatives documented.
 *
 * Usage:
 *   bun run packages/orchestrator/src/dialectic.ts "Should we use event sourcing for orders?"
 *   bun run packages/orchestrator/src/dialectic.ts "Migrate to new DB vs adapt schema?" --extract
 */

import { searchContextForEpic, type ExtractEntry } from "./jasnah.js"

// ── Types ─────────────────────────────────────────────────────────

export interface DialecticInput {
  question: string
  constraintA?: string
  constraintB?: string
}

export interface Position {
  constraint: string
  argument: string
  taskBreakdown: string[]
  risks: string[]
  estimatedEffort: string
}

export interface Synthesis {
  recommendation: string
  tradeoffs: string
  whatAGetsRight: string
  whatBGetsRight: string
  conflicts: string
}

export interface DialecticResult {
  question: string
  positionA: Position
  positionB: Position
  synthesis: Synthesis
  priorContext: string
  timestamp: string
}

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv: string[]): { question: string; extract: boolean; root: string } {
  const args = argv.slice(2)
  const flags = args.filter((a) => a.startsWith("--"))
  const positional = args.filter((a) => !a.startsWith("--"))

  if (positional.length === 0) {
    console.error('Usage: dialectic "<decision question>" [--extract]')
    process.exit(1)
  }

  return {
    question: positional.join(" "),
    extract: flags.includes("--extract"),
    root: process.cwd(),
  }
}

// ── Prompt generation ─────────────────────────────────────────────

/**
 * Generate the two opposing constraint prompts from a decision question.
 * If explicit constraints aren't provided, infers them from the question.
 */
function generateConstraints(input: DialecticInput): { constraintA: string; constraintB: string } {
  if (input.constraintA && input.constraintB) {
    return { constraintA: input.constraintA, constraintB: input.constraintB }
  }

  // Auto-detect "X vs Y" pattern
  const vsMatch = input.question.match(/(.+?)\s+vs\.?\s+(.+?)[\?.]?$/i)
  if (vsMatch) {
    return {
      constraintA: `Assume we proceed with: ${vsMatch[1].trim()}`,
      constraintB: `Assume we proceed with: ${vsMatch[2].trim()}`,
    }
  }

  // Auto-detect "Should we X?" pattern
  const shouldMatch = input.question.match(/should\s+we\s+(.+?)[\?.]?$/i)
  if (shouldMatch) {
    return {
      constraintA: `Assume we DO ${shouldMatch[1].trim()}`,
      constraintB: `Assume we DO NOT ${shouldMatch[1].trim()} and find an alternative approach`,
    }
  }

  // Fallback: for/against
  return {
    constraintA: `Argue IN FAVOR of the proposed change: ${input.question}`,
    constraintB: `Argue AGAINST the proposed change and propose an alternative: ${input.question}`,
  }
}

export function buildPositionPrompt(
  question: string,
  constraint: string,
  priorContext: string,
  label: string,
): string {
  return `You are Agent ${label} in a dialectic analysis. Your role is to take a FULLY COMMITTED position.

## Decision Question
${question}

## Your Constraint
${constraint}

## Important Rules
- You must be fully committed to your position. No hedging, no "it depends."
- Argue as if this is clearly the right approach.
- Be specific about implementation, not abstract.
- Acknowledge risks honestly but explain how to mitigate them.

${priorContext ? `## Prior Context\n${priorContext}\n` : ""}

## Required Output Format
Provide your analysis in this exact structure:

### Argument
[Your core argument for why this approach is correct]

### Task Breakdown
1. [Concrete implementation step]
2. [Next step]
...

### Risks & Mitigations
- [Risk]: [Mitigation]
...

### Estimated Effort
[Time estimate and team size]`
}

export function buildSynthesisPrompt(
  question: string,
  positionA: string,
  positionB: string,
): string {
  return `You are a neutral Synthesizer. Two agents analyzed a decision from opposing perspectives.
Your job is to produce a balanced recommendation through Hegel's determinate negation —
not a compromise, but a higher-level insight that incorporates what each side gets right.

## Decision Question
${question}

## Agent A's Position
${positionA}

## Agent B's Position
${positionB}

## Required Output Format

### Recommendation
[Your synthesized recommendation — not a middle ground, but the best path forward informed by both analyses]

### Trade-off Analysis
[What you gain and what you lose with the recommended approach]

### What Agent A Gets Right
[Specific points where A's analysis is strongest]

### What Agent B Gets Right
[Specific points where B's analysis is strongest]

### Key Conflicts
[Where the positions fundamentally disagree and how your recommendation resolves it]`
}

// ── Output formatting ─────────────────────────────────────────────

export function formatDialecticResult(result: DialecticResult): string {
  const lines: string[] = [
    "# Dialectic Analysis",
    "",
    `**Question:** ${result.question}`,
    `**Date:** ${result.timestamp}`,
    "",
  ]

  if (result.priorContext) {
    lines.push("## Prior Context")
    lines.push("")
    lines.push(result.priorContext)
    lines.push("")
  }

  lines.push("## Position A")
  lines.push(`**Constraint:** ${result.positionA.constraint}`)
  lines.push("")
  lines.push(result.positionA.argument)
  lines.push("")
  if (result.positionA.taskBreakdown.length > 0) {
    lines.push("**Tasks:**")
    for (const task of result.positionA.taskBreakdown) {
      lines.push(`- ${task}`)
    }
    lines.push("")
  }
  if (result.positionA.risks.length > 0) {
    lines.push("**Risks:**")
    for (const risk of result.positionA.risks) {
      lines.push(`- ${risk}`)
    }
    lines.push("")
  }
  lines.push(`**Effort:** ${result.positionA.estimatedEffort}`)
  lines.push("")

  lines.push("---")
  lines.push("")

  lines.push("## Position B")
  lines.push(`**Constraint:** ${result.positionB.constraint}`)
  lines.push("")
  lines.push(result.positionB.argument)
  lines.push("")
  if (result.positionB.taskBreakdown.length > 0) {
    lines.push("**Tasks:**")
    for (const task of result.positionB.taskBreakdown) {
      lines.push(`- ${task}`)
    }
    lines.push("")
  }
  if (result.positionB.risks.length > 0) {
    lines.push("**Risks:**")
    for (const risk of result.positionB.risks) {
      lines.push(`- ${risk}`)
    }
    lines.push("")
  }
  lines.push(`**Effort:** ${result.positionB.estimatedEffort}`)
  lines.push("")

  lines.push("---")
  lines.push("")

  lines.push("## Synthesis")
  lines.push("")
  lines.push("### Recommendation")
  lines.push(result.synthesis.recommendation)
  lines.push("")
  lines.push("### Trade-offs")
  lines.push(result.synthesis.tradeoffs)
  lines.push("")
  lines.push("### What Agent A Gets Right")
  lines.push(result.synthesis.whatAGetsRight)
  lines.push("")
  lines.push("### What Agent B Gets Right")
  lines.push(result.synthesis.whatBGetsRight)
  lines.push("")
  lines.push("### Key Conflicts")
  lines.push(result.synthesis.conflicts)

  return lines.join("\n")
}

export function resultToExtractEntry(result: DialecticResult): ExtractEntry {
  return {
    type: "architecture",
    summary: `Decision: ${result.question}`.slice(0, 100),
    content: `Recommendation: ${result.synthesis.recommendation}\n\nTrade-offs: ${result.synthesis.tradeoffs}`.slice(0, 500),
    tags: ["dialectic", "architecture-decision"],
    confidence: "high",
  }
}

// ── Main pipeline ─────────────────────────────────────────────────

/**
 * Run the dialectic pipeline.
 *
 * NOTE: This pipeline generates the prompts and structure but requires
 * an LLM to fill in the positions and synthesis. When invoked by an AI
 * agent (Claude Code / OpenCode), the agent uses these prompts to
 * generate each position in isolation, then synthesizes.
 *
 * When invoked as a CLI script, it outputs the prompts for manual use
 * or piping to an LLM API.
 */
export async function runDialectic(input: DialecticInput, root?: string): Promise<{
  constraints: { constraintA: string; constraintB: string }
  prompts: { positionA: string; positionB: string; synthesis: string }
  priorContext: string
}> {
  console.log(`\n[dalinar] Dialectic analysis: "${input.question}"\n`)

  // Step 1: Search for prior context
  console.log("[dalinar] Searching for prior context...")
  const memories = await searchContextForEpic(input.question, root)
  let priorContext = ""
  if (memories.length > 0) {
    console.log(`[dalinar]   Found ${memories.length} relevant memories`)
    priorContext = memories
      .map((m) => `[${m.type}] ${m.summary}: ${m.content}`)
      .join("\n\n")
  }

  // Step 2: Generate constraints
  const constraints = generateConstraints(input)
  console.log(`[dalinar] Agent A: ${constraints.constraintA}`)
  console.log(`[dalinar] Agent B: ${constraints.constraintB}`)

  // Step 3: Build prompts
  const promptA = buildPositionPrompt(input.question, constraints.constraintA, priorContext, "A")
  const promptB = buildPositionPrompt(input.question, constraints.constraintB, priorContext, "B")

  // Synthesis prompt uses placeholders — the agent fills these after running A and B
  const synthPrompt = buildSynthesisPrompt(
    input.question,
    "[Agent A's output will be inserted here]",
    "[Agent B's output will be inserted here]",
  )

  return { constraints, prompts: { positionA: promptA, positionB: promptB, synthesis: synthPrompt }, priorContext }
}

// ── Run ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const opts = parseArgs(process.argv)

  const result = await runDialectic({ question: opts.question }, opts.root)

  console.log("\n" + "=".repeat(60))
  console.log("## Agent A Prompt")
  console.log("=".repeat(60))
  console.log(result.prompts.positionA)

  console.log("\n" + "=".repeat(60))
  console.log("## Agent B Prompt")
  console.log("=".repeat(60))
  console.log(result.prompts.positionB)

  console.log("\n" + "=".repeat(60))
  console.log("## Synthesis Prompt")
  console.log("=".repeat(60))
  console.log(result.prompts.synthesis)

  console.log("\n[dalinar] Run each prompt in isolated agent contexts, then combine with the synthesis prompt.")
}
