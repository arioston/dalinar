import { describe, expect, it } from "bun:test";
import {
  LegacyTypeMap,
  TypeDirectoryMap,
  LegacyDirectoryMap,
  resolveNoteType,
  resolveDirectory,
} from "./taxonomy.js";
import { NoteType } from "./types.js";

describe("LegacyTypeMap", () => {
  it("maps decision to architecture", () => {
    expect(LegacyTypeMap.decision).toBe(NoteType.Architecture);
  });

  it("maps insight to lesson-learned", () => {
    expect(LegacyTypeMap.insight).toBe(NoteType.LessonLearned);
  });

  it("maps fact to domain-fact", () => {
    expect(LegacyTypeMap.fact).toBe(NoteType.DomainFact);
  });
});

describe("resolveNoteType", () => {
  it("passes through current types", () => {
    expect(resolveNoteType("domain-fact")).toBe("domain-fact");
    expect(resolveNoteType("architecture")).toBe("architecture");
    expect(resolveNoteType("api-contract")).toBe("api-contract");
    expect(resolveNoteType("glossary")).toBe("glossary");
    expect(resolveNoteType("lesson-learned")).toBe("lesson-learned");
  });

  it("resolves legacy types", () => {
    expect(resolveNoteType("decision")).toBe("architecture");
    expect(resolveNoteType("insight")).toBe("lesson-learned");
    expect(resolveNoteType("fact")).toBe("domain-fact");
  });

  it("throws on unknown type", () => {
    expect(() => resolveNoteType("invalid")).toThrow("Unknown note type: invalid");
  });
});

describe("TypeDirectoryMap", () => {
  it("maps all 5 types to directories", () => {
    expect(TypeDirectoryMap["domain-fact"]).toBe("domain-facts");
    expect(TypeDirectoryMap["architecture"]).toBe("architecture");
    expect(TypeDirectoryMap["api-contract"]).toBe("api-contracts");
    expect(TypeDirectoryMap["glossary"]).toBe("glossary");
    expect(TypeDirectoryMap["lesson-learned"]).toBe("lessons-learned");
  });
});

describe("resolveDirectory", () => {
  it("maps legacy directories", () => {
    expect(resolveDirectory("decisions")).toBe("architecture");
    expect(resolveDirectory("insights")).toBe("lessons-learned");
    expect(resolveDirectory("facts")).toBe("domain-facts");
  });

  it("passes through current directories unchanged", () => {
    expect(resolveDirectory("architecture")).toBe("architecture");
    expect(resolveDirectory("glossary")).toBe("glossary");
  });
});
