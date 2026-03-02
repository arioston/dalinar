/**
 * Skill composition protocol — discovers skills and validates dependencies.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "@dalinar/protocol";

export interface SkillMetadata {
  name: string;
  description: string;
  dependsOn: string[];
  path: string;
}

export interface SkillLoadError {
  path: string;
  message: string;
}

export interface SkillRegistry {
  skills: Map<string, SkillMetadata>;
  errors: SkillLoadError[];
}

/**
 * Scan a skills directory for SKILL.md files with frontmatter metadata.
 * Follows symlinks. Returns a registry of discovered skills and any load errors.
 */
export async function discoverSkills(skillsDir: string): Promise<SkillRegistry> {
  const skills = new Map<string, SkillMetadata>();
  const errors: SkillLoadError[] = [];

  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch (err) {
    errors.push({
      path: skillsDir,
      message: `Cannot read skills directory: ${(err as Error).message}`,
    });
    return { skills, errors };
  }

  for (const entry of entries) {
    const skillDir = join(skillsDir, entry);
    const skillFile = join(skillDir, "SKILL.md");

    try {
      const st = await stat(skillDir);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }

    let raw: string;
    try {
      raw = await readFile(skillFile, "utf-8");
    } catch {
      errors.push({ path: skillFile, message: "Missing SKILL.md" });
      continue;
    }

    const { frontmatter } = parseFrontmatter(raw);
    const name = (frontmatter.name as string) || entry;
    const description = (frontmatter.description as string) || "";
    const dependsOnRaw = frontmatter["depends-on"];
    const dependsOn = Array.isArray(dependsOnRaw)
      ? (dependsOnRaw as string[])
      : [];

    skills.set(name, { name, description, dependsOn, path: skillDir });
  }

  return { skills, errors };
}

/**
 * Validate that all `dependsOn` references resolve to skills in the registry.
 * Returns an array of error strings (empty if all deps are satisfied).
 */
export function validateDependencies(registry: SkillRegistry): string[] {
  const errors: string[] = [];

  for (const [name, skill] of registry.skills) {
    for (const dep of skill.dependsOn) {
      if (!registry.skills.has(dep)) {
        errors.push(`Skill "${name}" depends on "${dep}" which is not in the registry`);
      }
    }
  }

  return errors;
}
