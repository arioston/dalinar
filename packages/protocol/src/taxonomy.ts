/**
 * Unified 5-type note taxonomy with legacy alias support.
 *
 * Maps Jasnah's original 3-type system (decision/insight/fact) to the
 * unified 5-type system used by both Jasnah and Sazed.
 */

import { NoteType } from "./types.js";

/** Maps Jasnah's original 3-type system to the unified 5-type system. */
export const LegacyTypeMap: Record<string, NoteType> = {
  decision: NoteType.Architecture,
  insight: NoteType.LessonLearned,
  fact: NoteType.DomainFact,
} as const;

/** Maps unified note types to their storage directory names. */
export const TypeDirectoryMap: Record<NoteType, string> = {
  "domain-fact": "domain-facts",
  architecture: "architecture",
  "api-contract": "api-contracts",
  glossary: "glossary",
  "lesson-learned": "lessons-learned",
} as const;

/** Maps legacy Jasnah directory names to new directory names. */
export const LegacyDirectoryMap: Record<string, string> = {
  decisions: "architecture",
  insights: "lessons-learned",
  facts: "domain-facts",
} as const;

/**
 * Resolve any type string (legacy or current) to a valid NoteType.
 * Throws if the input is not recognized.
 */
export function resolveNoteType(input: string): NoteType {
  if (Object.values(NoteType).includes(input as NoteType)) {
    return input as NoteType;
  }
  if (input in LegacyTypeMap) {
    return LegacyTypeMap[input];
  }
  throw new Error(`Unknown note type: ${input}`);
}

/**
 * Resolve a directory name (legacy or current) to the canonical directory name.
 * Returns the input unchanged if not recognized.
 */
export function resolveDirectory(dirName: string): string {
  if (dirName in LegacyDirectoryMap) {
    return LegacyDirectoryMap[dirName];
  }
  return dirName;
}
