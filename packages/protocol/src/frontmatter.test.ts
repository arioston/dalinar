import { describe, expect, it } from "bun:test";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses basic frontmatter", () => {
    const raw = `---
type: domain-fact
source: src/auth.ts
tags: [auth, session]
---
# Title

Content here.`;

    const result = parseFrontmatter(raw);

    expect(result.frontmatter.type).toBe("domain-fact");
    expect(result.frontmatter.source).toBe("src/auth.ts");
    expect(result.frontmatter.tags).toEqual(["auth", "session"]);
    expect(result.content).toBe("# Title\n\nContent here.");
  });

  it("returns raw content when no frontmatter present", () => {
    const raw = "Just plain content";
    const result = parseFrontmatter(raw);

    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe("Just plain content");
  });

  it("handles empty values", () => {
    const raw = `---
key:
---
Content`;

    const result = parseFrontmatter(raw);
    expect(result.frontmatter.key).toBe("");
  });

  it("handles quoted values", () => {
    const raw = `---
title: "Hello World"
---
Body`;

    const result = parseFrontmatter(raw);
    expect(result.frontmatter.title).toBe("Hello World");
  });
});

describe("serializeFrontmatter", () => {
  it("serializes basic metadata", () => {
    const result = serializeFrontmatter(
      { type: "domain-fact", tags: ["auth", "session"] },
      "# Title\n\nContent",
    );

    expect(result).toContain("---");
    expect(result).toContain("type: domain-fact");
    expect(result).toContain("tags: [auth, session]");
    expect(result).toContain("# Title\n\nContent");
  });

  it("skips undefined values", () => {
    const result = serializeFrontmatter(
      { type: "glossary", tombstonedAt: undefined },
      "Content",
    );

    expect(result).toContain("type: glossary");
    expect(result).not.toContain("tombstonedAt");
  });
});

describe("numeric values", () => {
  it("parses integers", () => {
    const raw = `---\naccessCount: 5\n---\nContent`;
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.accessCount).toBe(5);
    expect(typeof result.frontmatter.accessCount).toBe("number");
  });

  it("parses floats", () => {
    const raw = `---\nstability: 2.79\n---\nContent`;
    const result = parseFrontmatter(raw);
    expect(result.frontmatter.stability).toBe(2.79);
    expect(typeof result.frontmatter.stability).toBe("number");
  });

  it("does not parse ISO dates as numbers", () => {
    const raw = `---\ncreated: 2024-01-01T00:00:00.000Z\n---\nContent`;
    const result = parseFrontmatter(raw);
    expect(typeof result.frontmatter.created).toBe("string");
  });

  it("does not parse text as numbers", () => {
    const raw = `---\ntype: domain-fact\n---\nContent`;
    const result = parseFrontmatter(raw);
    expect(typeof result.frontmatter.type).toBe("string");
  });
});

describe("roundtrip", () => {
  it("parse -> serialize -> parse produces same data", () => {
    const original = `---
type: architecture
source: src/db.ts
tags: [db, orm]
---
# Database Layer

Uses Prisma ORM.`;

    const { frontmatter, content } = parseFrontmatter(original);
    const serialized = serializeFrontmatter(frontmatter, content);
    const { frontmatter: fm2, content: c2 } = parseFrontmatter(serialized);

    expect(fm2.type).toBe(frontmatter.type);
    expect(fm2.source).toBe(frontmatter.source);
    expect(fm2.tags).toEqual(frontmatter.tags);
    expect(c2).toBe(content);
  });

  it("handles full NoteFrontmatter schema", () => {
    const meta = {
      id: "a7f3b2c1-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
      title: "Use Postgres for analytics pipeline",
      type: "architecture",
      summary: "Chose Postgres over ClickHouse for analytics due to team familiarity",
      tags: ["database", "analytics", "architecture"],
      confidence: "high",
      source: "sazed:EPIC-456",
      createdAt: "2026-02-15T10:30:00Z",
      lastAccessedAt: "2026-02-28T14:00:00Z",
      accessCount: 3,
      stability: 2.10,
      retentionScore: 0.85,
    };

    const serialized = serializeFrontmatter(meta, "## Decision\n\nPostgres was chosen.");
    const { frontmatter, content } = parseFrontmatter(serialized);

    expect(frontmatter.id).toBe(meta.id);
    expect(frontmatter.type).toBe(meta.type);
    expect(frontmatter.accessCount).toBe(3);
    expect(frontmatter.stability).toBe(2.10);
    expect(frontmatter.tags).toEqual(meta.tags);
    expect(content).toBe("## Decision\n\nPostgres was chosen.");
  });
});
