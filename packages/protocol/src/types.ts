/**
 * Core type definitions for the Dalinar protocol.
 *
 * Shared between Jasnah (memory) and Sazed (planning).
 * Neither submodule imports the other — both import from here.
 */

export const NoteType = {
  DomainFact: "domain-fact",
  Architecture: "architecture",
  ApiContract: "api-contract",
  Glossary: "glossary",
  LessonLearned: "lesson-learned",
} as const;

export type NoteType = (typeof NoteType)[keyof typeof NoteType];

/** All valid note type values. */
export const NOTE_TYPES: ReadonlyArray<NoteType> = Object.values(NoteType);

/** Lightweight note reference for two-step search (headers first, then content on demand). */
export interface NoteHeader {
  slug: string;
  title: string;
  type: NoteType;
  tags: string[];
  retentionScore: number;
  createdAt: Date;
}

/** Full note entry with content and retention metadata. */
export interface NoteEntry extends NoteHeader {
  id: string;
  content: string;
  summary: string;
  source: string;
  confidence: "high" | "medium" | "low";
  accessCount: number;
  lastAccessedAt: Date;
  stability: number;
  tombstonedAt?: Date;
}

/** Retention-specific metadata subset. */
export interface RetentionMetadata {
  accessCount: number;
  lastAccessedAt: Date;
  stability: number;
  retentionScore: number;
}

/** Secret detection result. */
export interface SecretDetection {
  readonly rule: string;
  readonly position: number;
  readonly snippet: string;
}
