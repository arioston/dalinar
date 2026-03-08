import { describe, expect, test } from "bun:test"
import { exitCodeForError } from "./runtime.js"
import {
  SubprocessError,
  JasnahError,
  SazedError,
  VaultSyncError,
  HoidError,
  FileOperationError,
  ParseError,
  JiraError,
  TicketStateError,
  ConfigurationError,
} from "./errors.js"

describe("exitCodeForError", () => {
  test("ParseError → 2", () => {
    expect(exitCodeForError(new ParseError({ message: "bad" }))).toBe(2)
  })

  test("TicketStateError → 3", () => {
    expect(exitCodeForError(new TicketStateError({ message: "bad" }))).toBe(3)
  })

  test("SubprocessError not-found → 126", () => {
    expect(
      exitCodeForError(new SubprocessError({ message: "bad", category: "not-found" })),
    ).toBe(126)
  })

  test("SubprocessError timeout → 124", () => {
    expect(
      exitCodeForError(new SubprocessError({ message: "bad", category: "timeout" })),
    ).toBe(124)
  })

  test("SubprocessError unknown → 1", () => {
    expect(
      exitCodeForError(new SubprocessError({ message: "bad", category: "unknown" })),
    ).toBe(1)
  })

  test("SubprocessError no category → 1", () => {
    expect(
      exitCodeForError(new SubprocessError({ message: "bad" })),
    ).toBe(1)
  })

  test("JasnahError → 1", () => {
    expect(exitCodeForError(new JasnahError({ message: "bad" }))).toBe(1)
  })

  test("SazedError → 1", () => {
    expect(exitCodeForError(new SazedError({ message: "bad" }))).toBe(1)
  })

  test("VaultSyncError → 1", () => {
    expect(exitCodeForError(new VaultSyncError({ message: "bad" }))).toBe(1)
  })

  test("HoidError → 1", () => {
    expect(exitCodeForError(new HoidError({ message: "bad" }))).toBe(1)
  })

  test("FileOperationError → 1", () => {
    expect(exitCodeForError(new FileOperationError({ message: "bad" }))).toBe(1)
  })

  test("JiraError → 1", () => {
    expect(exitCodeForError(new JiraError({ message: "bad" }))).toBe(1)
  })

  test("ConfigurationError → 78", () => {
    expect(exitCodeForError(new ConfigurationError({ message: "bad" }))).toBe(78)
  })
})
