import { describe, expect, test } from "bun:test"
import { extractNotesFromAnalysis } from "./extract-notes.js"

const SAMPLE_MARKDOWN = `# EPIC-1: Test Epic

## Context Summary

This is a detailed context summary describing the architecture of the test system. It covers the main components and how they interact with each other in the production environment.

## Tasks

### Task 1: Add widget

- **ID**: TASK-1
- **Complexity**: S

**Description**:
Add a new widget to the dashboard.

**Technical Definition**:

**Integration points**:
- src/dashboard/registry.ts:42 — register new widget
- src/dashboard/render.ts:10 — render widget

**Acceptance Criteria**:

- Given I am on the dashboard, when I click Add Widget, then the widget appears
- Given a widget exists, when I remove it, then it disappears

### Task 2: Add notifications

- **ID**: TASK-2
- **Complexity**: M

**Description**:
Add notification system.

**Integration points**:
- src/notifications/service.ts:1 — notification service
- src/notifications/queue.ts:5 — message queue

**Acceptance Criteria**:

- Given an event occurs, when a notification rule matches, then a notification is sent

## Communication Flow

\`\`\`mermaid
sequenceDiagram
    Dashboard->>Registry: registerWidget()
    Registry->>Renderer: render()
\`\`\`

This describes the communication flow between dashboard components and the registry service for widget management.

## Domain Notes

*Extracted during analysis.*

### All widgets are registered in the dashboard registry

- **Type**: architecture
- **Tags**: dashboard, widgets

The widget registry at src/dashboard/registry.ts manages all available widgets. Each widget must implement the WidgetInterface and be registered before it can be rendered.

### Notification queue uses FIFO ordering

- **Type**: domain-fact
- **Tags**: notifications, queue

The notification queue processes messages in strict FIFO order to ensure temporal consistency of user-facing notifications.
`

describe("extractNotesFromAnalysis", () => {
  test("extracts domain notes with correct types and tags", () => {
    const entries = extractNotesFromAnalysis(SAMPLE_MARKDOWN, {
      epicKey: "EPIC-1",
    })

    const domainNotes = entries.filter((e) => e.confidence === "high")
    expect(domainNotes.length).toBe(2)

    const archNote = domainNotes.find((e) => e.type === "architecture")!
    expect(archNote).toBeTruthy()
    expect(archNote.summary).toContain("widgets are registered")
    expect(archNote.tags).toContain("epic-1")
    expect(archNote.tags).toContain("dashboard")
    expect(archNote.tags).toContain("widgets")

    const factNote = domainNotes.find((e) => e.type === "domain-fact")!
    expect(factNote).toBeTruthy()
    expect(factNote.summary).toContain("FIFO")
    expect(factNote.tags).toContain("notifications")
  })

  test("extracts context summary as architecture note", () => {
    const entries = extractNotesFromAnalysis(SAMPLE_MARKDOWN, {
      epicKey: "EPIC-1",
    })

    const contextNote = entries.find(
      (e) =>
        e.type === "architecture" &&
        e.summary.includes("Architecture context"),
    )
    expect(contextNote).toBeTruthy()
    expect(contextNote!.content).toContain("detailed context summary")
    expect(contextNote!.confidence).toBe("medium")
  })

  test("extracts communication flow as api-contract", () => {
    const entries = extractNotesFromAnalysis(SAMPLE_MARKDOWN, {
      epicKey: "EPIC-1",
    })

    const commNote = entries.find((e) => e.type === "api-contract")
    expect(commNote).toBeTruthy()
    expect(commNote!.content).toContain("mermaid")
    expect(commNote!.tags).toContain("integration")
  })

  test("extracts acceptance criteria as domain-fact", () => {
    const entries = extractNotesFromAnalysis(SAMPLE_MARKDOWN, {
      epicKey: "EPIC-1",
    })

    const acNotes = entries.filter(
      (e) =>
        e.type === "domain-fact" &&
        e.summary.includes("Acceptance criteria"),
    )
    expect(acNotes.length).toBe(2)
    expect(acNotes[0].content).toContain("Given")
    expect(acNotes[0].tags).toContain("acceptance-criteria")
  })

  test("consolidates integration points", () => {
    const entries = extractNotesFromAnalysis(SAMPLE_MARKDOWN, {
      epicKey: "EPIC-1",
    })

    const ipNote = entries.find(
      (e) =>
        e.type === "architecture" &&
        e.summary.includes("Integration points") &&
        e.summary.includes("tasks"),
    )
    expect(ipNote).toBeTruthy()
    expect(ipNote!.content).toContain("registry.ts")
    expect(ipNote!.content).toContain("notification")
    expect(ipNote!.tags).toContain("integration-points")
  })

  test("includes taskKey in tags when provided", () => {
    const entries = extractNotesFromAnalysis(SAMPLE_MARKDOWN, {
      epicKey: "EPIC-1",
      taskKey: "PROJ-456",
    })

    for (const entry of entries) {
      expect(entry.tags).toContain("proj-456")
      expect(entry.tags).toContain("epic-1")
    }
  })

  test("returns empty array for minimal markdown", () => {
    const entries = extractNotesFromAnalysis("# Just a title\n\nShort.", {
      epicKey: "EPIC-1",
    })
    expect(entries).toEqual([])
  })

  test("skips short content below threshold", () => {
    const md = `## Context Summary

Short.

## Tasks
`
    const entries = extractNotesFromAnalysis(md, { epicKey: "EPIC-1" })
    // "Short." is < 50 chars, should be skipped
    const contextNote = entries.find((e) => e.summary.includes("Architecture"))
    expect(contextNote).toBeUndefined()
  })

  test("caps total notes at 8", () => {
    // Build markdown with many domain notes
    let md = "## Domain Notes\n\n"
    for (let i = 0; i < 12; i++) {
      md += `### Note ${i} about something important\n\n`
      md += `- **Type**: domain-fact\n`
      md += `- **Tags**: tag${i}\n\n`
      md += `${"This is content for note number " + i + ". ".repeat(5)}\n\n`
    }

    const entries = extractNotesFromAnalysis(md, { epicKey: "EPIC-1" })
    expect(entries.length).toBeLessThanOrEqual(8)
  })

  test("truncates long content at boundary", () => {
    const longContent = "Line one of content.\n".repeat(200) // ~4200 chars
    const md = `## Context Summary

${longContent}

## Tasks
`
    const entries = extractNotesFromAnalysis(md, { epicKey: "EPIC-1" })
    const note = entries.find((e) => e.summary.includes("Architecture"))
    expect(note).toBeTruthy()
    expect(note!.content.length).toBeLessThanOrEqual(2000)
    // Should end at a newline boundary, not mid-line
    expect(note!.content.endsWith("\n") || note!.content.endsWith(".")).toBe(
      true,
    )
  })

  test("handles communication flow as terminal section (fixed \\Z bug)", () => {
    const md = `## Context Summary

Some context that is long enough to be extracted as a meaningful architecture note for the system.

## Communication Flow

This is the communication flow section which is the last section in the markdown and should still be captured.
`
    const entries = extractNotesFromAnalysis(md, { epicKey: "EPIC-1" })
    const commNote = entries.find((e) => e.type === "api-contract")
    expect(commNote).toBeTruthy()
    expect(commNote!.content).toContain("communication flow section")
  })

  test("handles domain notes without Related line", () => {
    const md = `## Domain Notes

### Simple note without related

- **Type**: glossary
- **Tags**: term

This is a glossary entry that has no Related line but should still be captured correctly.
`
    const entries = extractNotesFromAnalysis(md, { epicKey: "EPIC-1" })
    expect(entries.length).toBe(1)
    expect(entries[0].type).toBe("glossary")
    expect(entries[0].content).toContain("glossary entry")
  })

  test("handles domain notes with Related line", () => {
    const md = `## Domain Notes

### Note with related

- **Type**: architecture
- **Tags**: system
- **Related**: [[other-note]], [[another]]

This note has a Related line and content should still be captured.
`
    const entries = extractNotesFromAnalysis(md, { epicKey: "EPIC-1" })
    expect(entries.length).toBe(1)
    expect(entries[0].type).toBe("architecture")
    expect(entries[0].content).toContain("Related line and content")
  })
})
