import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { discoverSkills, validateDependencies } from "./skills.js";

const SKILLS_DIR = join(import.meta.dir, "../../../skills");

describe("discoverSkills", () => {
  test("discovers existing skills from skills/ directory", async () => {
    const registry = await discoverSkills(SKILLS_DIR);

    expect(registry.skills.size).toBeGreaterThanOrEqual(5);
    expect(registry.skills.has("jira")).toBe(true);
    expect(registry.skills.has("dialectic")).toBe(true);
    expect(registry.skills.has("using-git-worktrees")).toBe(true);
    expect(registry.skills.has("jasnah-search-memory")).toBe(true);
  });

  test("parses depends-on from dialectic skill", async () => {
    const registry = await discoverSkills(SKILLS_DIR);
    const dialectic = registry.skills.get("dialectic");

    expect(dialectic).toBeDefined();
    expect(dialectic!.dependsOn).toEqual(["jasnah-search-memory"]);
  });

  test("handles missing depends-on as empty array", async () => {
    const registry = await discoverSkills(SKILLS_DIR);
    const worktrees = registry.skills.get("using-git-worktrees");

    expect(worktrees).toBeDefined();
    expect(worktrees!.dependsOn).toEqual([]);
  });

  test("handles nonexistent directory gracefully", async () => {
    const registry = await discoverSkills("/tmp/nonexistent-skills-dir-xyz");

    expect(registry.skills.size).toBe(0);
    expect(registry.errors.length).toBe(1);
    expect(registry.errors[0].message).toContain("Cannot read skills directory");
  });
});

describe("validateDependencies", () => {
  test("passes when all dependencies are present", async () => {
    const registry = await discoverSkills(SKILLS_DIR);
    const errors = validateDependencies(registry);

    expect(errors).toEqual([]);
  });

  test("reports missing dependencies", () => {
    const registry = {
      skills: new Map([
        ["my-skill", {
          name: "my-skill",
          description: "test",
          dependsOn: ["nonexistent-dep"],
          path: "/tmp/my-skill",
        }],
      ]),
      errors: [],
    };

    const errors = validateDependencies(registry);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("nonexistent-dep");
    expect(errors[0]).toContain("my-skill");
  });
});
