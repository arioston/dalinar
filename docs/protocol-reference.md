# Protocol Reference — `@dalinar/protocol`

The shared contract between Jasnah and Sazed. Both submodules declare `@dalinar/protocol` as an optional dependency — when running inside the Dalinar workspace they delegate to the canonical implementation; when standalone they fall back to local copies.

## Note Types

The unified 5-type taxonomy replaces Jasnah's original 3-type system while maintaining full backward compatibility.

| Type | Purpose | Half-Life | Storage Directory |
|------|---------|-----------|-------------------|
| `domain-fact` | Business rules, product constraints, data relationships | 60 days (2x) | `domain-facts/` |
| `architecture` | Design decisions, technology choices, trade-offs | 45 days (1.5x) | `architecture/` |
| `api-contract` | Interface agreements between services, external APIs | 30 days (1x) | `api-contracts/` |
| `glossary` | Project-specific terminology and definitions | 90 days (3x) | `glossary/` |
| `lesson-learned` | Retrospective insights, gotchas, debugging discoveries | 15 days (0.5x) | `lessons-learned/` |

### Legacy Compatibility

| Legacy Type | Legacy Directory | Maps To | New Directory |
|-------------|-----------------|---------|---------------|
| `decision` | `decisions/` | `architecture` | `architecture/` |
| `insight` | `insights/` | `lesson-learned` | `lessons-learned/` |
| `fact` | `facts/` | `domain-fact` | `domain-facts/` |

Both directory structures coexist. The search layer recognizes both. New entries use the 5-type system.

### API

```typescript
import { NoteType, NOTE_TYPES, resolveNoteType, resolveDirectory } from "@dalinar/protocol"

resolveNoteType("decision")   // → "architecture"
resolveNoteType("domain-fact") // → "domain-fact" (pass-through)

resolveDirectory("architecture")  // → "architecture/"
resolveDirectory("decision")      // → "architecture/" (via legacy alias)
```

## Retention Model

Based on the Ebbinghaus forgetting curve with type-specific half-life multipliers.

### Formulas

**Stability** — increases logarithmically with access count:

```
stability(n) = 1.0 + ln(1 + n)
```

**Effective half-life** — base 30 days, multiplied by type:

```
effectiveHalfLife(type) = 30 × typeMultiplier(type)
```

**Retention** — exponential decay:

```
retention(t, s) = e^(-t / (halfLife × s / ln2))
```

Where `t` = days since last access, `s` = stability.

### Retention Table (access_count = 1, stability ≈ 1.69)

| Days | glossary (90d) | domain-fact (60d) | architecture (45d) | api-contract (30d) | lesson-learned (15d) |
|------|----------------|-------------------|--------------------|--------------------|----------------------|
| 7 | 0.97 | 0.95 | 0.93 | 0.90 | 0.81 |
| 30 | 0.87 | 0.80 | 0.74 | 0.65 | 0.42 |
| 90 | 0.66 | 0.51 | 0.40 | 0.27 | 0.07 |

### API

```typescript
import { computeStability, computeRetention, computeTypedRetention, effectiveHalfLife } from "@dalinar/protocol"

computeStability(3)                           // → 2.386
effectiveHalfLife("glossary")                 // → 90
computeRetention(30, computeStability(1))     // → 0.647 (base, no type multiplier)
computeTypedRetention(30, 1, "glossary")      // → 0.871
```

## Secret Detection

Three-layer detection system that scans note content before storage/indexing.

| Layer | What It Catches | Threshold |
|-------|----------------|-----------|
| **1. Known prefixes** | GitHub PATs, AWS keys, Stripe keys, JWTs, SSH keys, etc. (24 patterns) | Exact prefix match |
| **2. High-entropy strings** | Hex strings ≥32 chars, Base64 strings ≥17 chars | Shannon entropy > 3.0 |
| **3. Keyword proximity** | Credential keywords within 50 chars of high-entropy strings | Shannon entropy > 3.2 + keyword match |

### API

```typescript
import { detectSecrets, detectSecretsInNote, shannonEntropy } from "@dalinar/protocol"

detectSecrets("token: ghp_abc123...")
// → { rule: "github-pat", position: 7, snippet: "token: ***..." }

detectSecretsInNote("My API Key", "The key is sk-ant-abc123...")
// → [{ rule: "title:keyword-proximity", ... }, { rule: "anthropic-api-key", ... }]

shannonEntropy("aGVsbG8gd29ybGQ=")  // → 3.18
```

## Frontmatter

YAML frontmatter parser/serializer for note markdown files. No external dependencies.

### Schema

```yaml
---
id: abc-123-def
title: "Use Postgres for analytics"
type: architecture
summary: "Chose Postgres over ClickHouse for analytics queries"
tags: [database, analytics, postgres]
confidence: high
source: session-abc123
createdAt: 2025-01-15T10:30:00Z
lastAccessedAt: 2025-01-20T14:00:00Z
accessCount: 3
stability: 2.10
retentionScore: 0.87
---

Full content of the note...
```

### API

```typescript
import { parseFrontmatter, serializeFrontmatter } from "@dalinar/protocol"

const { frontmatter, content } = parseFrontmatter(rawMarkdown)
// frontmatter: { id: "abc-123", type: "architecture", tags: ["database", "analytics"], ... }
// content: "Full content of the note..."

const markdown = serializeFrontmatter({ type: "architecture", tags: ["db"] }, "Note content")
// "---\ntype: architecture\ntags: [db]\n---\n\nNote content"
```

## Vault Configuration

Opt-in integration for syncing `.memory/` to an Obsidian vault's Work Log folder. Activated by setting `WORK_LOG_PATH`. Designed to coexist with HoldGate folders in the same vault.

### Vault Structure

```
Your Vault/
├── 00-Inbox/              ← HoldGate daily digest
├── 20-Areas/              ← HoldGate concepts, patterns
├── 40-Reference/          ← HoldGate references
├── 70-Jornal/             ← HoldGate decision journals
│
└── 60-Work-Log/           ← Dalinar project knowledge
    ├── _global/
    │   ├── architecture/
    │   ├── domain-facts/
    │   ├── api-contracts/
    │   ├── glossary/
    │   └── lessons-learned/
    ├── project-a/         ← mirrors project-a/.memory/
    └── project-b/         ← mirrors project-b/.memory/
```

### API

```typescript
import { resolveVaultConfig, vaultProjectPath, vaultTypePath, vaultGlobalPath } from "@dalinar/protocol"

// Returns null if WORK_LOG_PATH not set (opt-in)
const config = resolveVaultConfig()
if (config) {
  vaultProjectPath(config)                    // → "/home/user/Vault/60-Work-Log/dalinar"
  vaultTypePath(config, "architecture")       // → "/home/user/Vault/60-Work-Log/dalinar/architecture"
  vaultGlobalPath(config, "lesson-learned")   // → "/home/user/Vault/60-Work-Log/_global/lessons-learned"
}

// Override env var with explicit values
const custom = resolveVaultConfig({
  workLogPath: "/custom/vault/path",
  projectName: "my-project",
})
```

### Environment

| Variable | Description |
|----------|-------------|
| `WORK_LOG_PATH` | Absolute path to Work Log folder in Obsidian vault (e.g., `~/Vault/60-Work-Log`) |

---

## Wiring Pattern

Both Jasnah and Sazed use the same pattern to delegate to protocol:

```typescript
// Top-level await dynamic import with fallback
let _protocol: typeof import("@dalinar/protocol") | null = null
try {
  _protocol = await import("@dalinar/protocol")
} catch {
  // Not in Dalinar workspace — use local implementations
}

// Export functions that delegate to protocol when available
export const computeStability: (accessCount: number) => number =
  _protocol?.computeStability ?? _localComputeStability
```

This ensures both submodules work identically whether standalone or inside the Dalinar workspace.
