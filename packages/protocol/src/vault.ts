/**
 * Vault integration — opt-in sync of .memory/ to an Obsidian vault's Work Log folder.
 *
 * Activated by setting the WORK_LOG_PATH environment variable to the Work Log
 * folder inside your Obsidian vault (e.g., ~/Vault/60-Work-Log).
 *
 * The Work Log folder coexists with HoldGate's numbered folders (00-Inbox,
 * 20-Areas, 40-Reference, etc.) in the same vault.
 *
 * Structure:
 *   <WORK_LOG_PATH>/
 *   ├── _global/              ← cross-project insights
 *   │   ├── architecture/
 *   │   ├── domain-facts/
 *   │   ├── api-contracts/
 *   │   ├── glossary/
 *   │   └── lessons-learned/
 *   ├── <project-a>/          ← mirrors <project-a>/.memory/
 *   └── <project-b>/          ← mirrors <project-b>/.memory/
 */

import { join } from "path";
import { TypeDirectoryMap } from "./taxonomy.js";
import type { NoteType } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────

export interface VaultConfig {
  /** Absolute path to the Work Log folder (e.g., ~/Vault/60-Work-Log). */
  workLogPath: string;
  /** Project folder name inside the Work Log (defaults to git repo name). */
  projectName: string;
  /** Folders to exclude from sync. */
  excludes: string[];
}

/** Default folders excluded from vault sync. */
export const DEFAULT_VAULT_EXCLUDES = [
  "config.yaml",
  "locks/",
  "raw/",
  ".obsidian*",
  "index.json",
] as const;

// ── Resolution ────────────────────────────────────────────────────

/**
 * Resolve VaultConfig from environment variables.
 * Returns null if WORK_LOG_PATH is not set (opt-in behavior).
 */
export function resolveVaultConfig(overrides?: {
  workLogPath?: string;
  projectName?: string;
  excludes?: string[];
}): VaultConfig | null {
  const workLogPath = overrides?.workLogPath ?? process.env.WORK_LOG_PATH;
  if (!workLogPath) return null;

  const projectName = overrides?.projectName ?? inferProjectName();
  const excludes = overrides?.excludes ?? [...DEFAULT_VAULT_EXCLUDES];

  return { workLogPath, projectName, excludes };
}

/**
 * Infer the project name from the git repo root directory name.
 * Falls back to cwd basename.
 */
function inferProjectName(): string {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"]);
    if (result.exitCode === 0) {
      const toplevel = result.stdout.toString().trim();
      return toplevel.split("/").pop() ?? "unknown";
    }
  } catch {
    // Not in a git repo
  }
  return process.cwd().split("/").pop() ?? "unknown";
}

// ── Path helpers ──────────────────────────────────────────────────

/** Path to a project's mirror folder in the Work Log. */
export function vaultProjectPath(config: VaultConfig): string {
  return join(config.workLogPath, config.projectName);
}

/** Path to a specific note type directory within a project's mirror. */
export function vaultTypePath(config: VaultConfig, type: NoteType): string {
  return join(vaultProjectPath(config), TypeDirectoryMap[type]);
}

/** Path to the _global folder for a specific note type. */
export function vaultGlobalPath(config: VaultConfig, type: NoteType): string {
  return join(config.workLogPath, "_global", TypeDirectoryMap[type]);
}

/** All 5 type directories under _global/. */
export function vaultGlobalDirectories(config: VaultConfig): string[] {
  return (Object.values(TypeDirectoryMap) as string[]).map((dir) =>
    join(config.workLogPath, "_global", dir)
  );
}
