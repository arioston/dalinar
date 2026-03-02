/**
 * Minimal YAML frontmatter parser/serializer.
 *
 * Handles simple key-value pairs, inline arrays, strings, and numeric values.
 * No external dependencies — compatible with both Jasnah and Sazed note formats.
 */

import type { NoteType } from "./types.js";

/** Full frontmatter schema for note markdown files. */
export interface NoteFrontmatter {
  id: string;
  title: string;
  type: NoteType;
  summary: string;
  tags: string[];
  confidence: "high" | "medium" | "low";
  source: string;
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  stability: number;
  retentionScore: number;
  tombstonedAt?: string;
}

/** Parse result from raw markdown with YAML frontmatter. */
export interface ParseResult {
  frontmatter: Record<string, unknown>;
  content: string;
}

/**
 * Parse YAML frontmatter from a markdown string.
 *
 * Handles:
 *   - Inline arrays: `tags: [tag1, tag2]`
 *   - Quoted strings: `title: "Some title"`
 *   - Numeric values: `accessCount: 3`, `stability: 2.10`
 *   - Comments: lines starting with `#`
 */
export function parseFrontmatter(raw: string): ParseResult {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content: raw };

  const yamlBlock = match[1];
  const content = match[2].trim();
  const frontmatter: Record<string, unknown> = {};

  for (const line of yamlBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      // Inline array: [tag1, tag2]
      const inner = rawValue.slice(1, -1);
      frontmatter[key] = inner
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (rawValue === "") {
      frontmatter[key] = "";
    } else {
      // Remove surrounding quotes if present
      const unquoted = rawValue.replace(/^["']|["']$/g, "");
      // Parse numeric values (integers and floats)
      const asNum = Number(unquoted);
      frontmatter[key] = !Number.isNaN(asNum) && unquoted !== "" && /^-?\d+(\.\d+)?$/.test(unquoted)
        ? asNum
        : unquoted;
    }
  }

  return { frontmatter, content };
}

/**
 * Serialize a metadata object and content body into a markdown string with YAML frontmatter.
 */
export function serializeFrontmatter(
  meta: Record<string, unknown>,
  content: string,
): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(", ")}]`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(content);

  return lines.join("\n");
}
