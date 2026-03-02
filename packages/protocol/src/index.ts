// @dalinar/protocol — shared contract between Jasnah and Sazed

export {
  NoteType,
  NOTE_TYPES,
  type NoteHeader,
  type NoteEntry,
  type RetentionMetadata,
  type SecretDetection,
} from "./types.js";

export {
  LegacyTypeMap,
  TypeDirectoryMap,
  LegacyDirectoryMap,
  resolveNoteType,
  resolveDirectory,
} from "./taxonomy.js";

export {
  BASE_HALF_LIFE_DAYS,
  RETENTION_CONTEXT_THRESHOLD,
  TOMBSTONE_THRESHOLD,
  effectiveHalfLife,
  computeStability,
  computeRetention,
  computeTypedRetention,
  msToDays,
} from "./retention.js";

export {
  shannonEntropy,
  detectSecrets,
  detectSecretsInNote,
} from "./secrets.js";

export {
  type NoteFrontmatter,
  type ParseResult,
  parseFrontmatter,
  serializeFrontmatter,
} from "./frontmatter.js";
