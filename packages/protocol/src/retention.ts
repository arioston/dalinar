/**
 * Ebbinghaus forgetting-curve retention model.
 *
 * stability(n)   = 1.0 + ln(1 + n)               — diminishing returns on access count
 * retention(t,s) = e^(-t / (halfLife × s / ln2))  — exponential decay
 *
 * A never-accessed note has 50% retention at its effective half-life.
 * Frequently-accessed notes decay much slower (log-scaled stability).
 *
 * NEW in Dalinar: type-specific half-life multipliers. Glossary terms persist
 * longer than lessons-learned, reflecting their different natural lifespans.
 */

import type { NoteType } from "./types.js";

/** Base half-life in days for the forgetting curve. */
export const BASE_HALF_LIFE_DAYS = 30;

/** Notes below this retention are excluded from LLM context injection. */
export const RETENTION_CONTEXT_THRESHOLD = 0.10;

/** Notes below this retention are candidates for garbage collection (soft delete). */
export const TOMBSTONE_THRESHOLD = 0.01;

/**
 * Type-specific half-life multipliers.
 *
 * Effective half-life = BASE_HALF_LIFE_DAYS × multiplier.
 *   glossary:       ~90 days  (near-permanent terminology)
 *   domain-fact:    ~60 days  (stable business rules)
 *   architecture:   ~45 days  (design decisions)
 *   api-contract:   ~30 days  (interface agreements, may change)
 *   lesson-learned: ~15 days  (time-sensitive retrospective insights)
 */
const halfLifeMultipliers: Record<NoteType, number> = {
  glossary: 3.0,
  "domain-fact": 2.0,
  architecture: 1.5,
  "api-contract": 1.0,
  "lesson-learned": 0.5,
};

/** Returns the effective half-life in days for a given note type. */
export function effectiveHalfLife(type: NoteType): number {
  return BASE_HALF_LIFE_DAYS * (halfLifeMultipliers[type] ?? 1.0);
}

/**
 * Stability grows logarithmically with access count.
 *   0 → 1.00, 1 → 1.69, 5 → 2.79, 10 → 3.40, 20 → 4.04
 */
export function computeStability(accessCount: number): number {
  return 1.0 + Math.log(1 + accessCount);
}

/**
 * Retention value ∈ (0, 1].
 *
 * Without type multiplier (backward-compatible with Jasnah/Sazed):
 *   Returns 0.5 when daysSinceAccess === BASE_HALF_LIFE_DAYS × stability.
 */
export function computeRetention(
  daysSinceAccess: number,
  stability: number,
): number {
  const lambda = (BASE_HALF_LIFE_DAYS * stability) / Math.LN2;
  return Math.exp(-daysSinceAccess / lambda);
}

/**
 * Retention with type-specific half-life multiplier.
 *
 * Use this for the unified protocol. The base computeRetention() is kept
 * for backward compatibility with existing Jasnah/Sazed code.
 */
export function computeTypedRetention(
  daysSinceAccess: number,
  accessCount: number,
  type: NoteType,
): number {
  const s = computeStability(accessCount);
  const halfLife = effectiveHalfLife(type);
  return Math.exp(-daysSinceAccess / (halfLife * s / Math.LN2));
}

/** Milliseconds → fractional days. */
export function msToDays(ms: number): number {
  return ms / (1000 * 60 * 60 * 24);
}
