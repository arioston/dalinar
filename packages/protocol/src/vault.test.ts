import { describe, test, expect, afterEach } from "bun:test";
import {
  resolveVaultConfig,
  vaultProjectPath,
  vaultTypePath,
  vaultGlobalPath,
  vaultGlobalDirectories,
  DEFAULT_VAULT_EXCLUDES,
} from "./vault.js";

describe("vault", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("resolveVaultConfig", () => {
    test("returns null when WORK_LOG_PATH is not set", () => {
      delete process.env.WORK_LOG_PATH;
      expect(resolveVaultConfig()).toBeNull();
    });

    test("resolves from WORK_LOG_PATH env var", () => {
      process.env.WORK_LOG_PATH = "/home/user/Vault/60-Work-Log";
      const config = resolveVaultConfig();
      expect(config).not.toBeNull();
      expect(config!.workLogPath).toBe("/home/user/Vault/60-Work-Log");
      expect(config!.excludes).toEqual(expect.arrayContaining(["config.yaml", "locks/"]));
    });

    test("uses overrides when provided", () => {
      const config = resolveVaultConfig({
        workLogPath: "/custom/path",
        projectName: "my-project",
        excludes: ["custom-exclude"],
      });
      expect(config).not.toBeNull();
      expect(config!.workLogPath).toBe("/custom/path");
      expect(config!.projectName).toBe("my-project");
      expect(config!.excludes).toEqual(["custom-exclude"]);
    });

    test("override workLogPath takes precedence over env", () => {
      process.env.WORK_LOG_PATH = "/env/path";
      const config = resolveVaultConfig({ workLogPath: "/override/path" });
      expect(config!.workLogPath).toBe("/override/path");
    });
  });

  describe("path helpers", () => {
    const config = {
      workLogPath: "/home/user/Vault/60-Work-Log",
      projectName: "dalinar",
      excludes: [...DEFAULT_VAULT_EXCLUDES],
    };

    test("vaultProjectPath", () => {
      expect(vaultProjectPath(config)).toBe(
        "/home/user/Vault/60-Work-Log/dalinar"
      );
    });

    test("vaultTypePath for each note type", () => {
      expect(vaultTypePath(config, "architecture")).toBe(
        "/home/user/Vault/60-Work-Log/dalinar/architecture"
      );
      expect(vaultTypePath(config, "domain-fact")).toBe(
        "/home/user/Vault/60-Work-Log/dalinar/domain-facts"
      );
      expect(vaultTypePath(config, "api-contract")).toBe(
        "/home/user/Vault/60-Work-Log/dalinar/api-contracts"
      );
      expect(vaultTypePath(config, "glossary")).toBe(
        "/home/user/Vault/60-Work-Log/dalinar/glossary"
      );
      expect(vaultTypePath(config, "lesson-learned")).toBe(
        "/home/user/Vault/60-Work-Log/dalinar/lessons-learned"
      );
    });

    test("vaultGlobalPath", () => {
      expect(vaultGlobalPath(config, "architecture")).toBe(
        "/home/user/Vault/60-Work-Log/_global/architecture"
      );
      expect(vaultGlobalPath(config, "lesson-learned")).toBe(
        "/home/user/Vault/60-Work-Log/_global/lessons-learned"
      );
    });

    test("vaultGlobalDirectories returns all 5 type dirs", () => {
      const dirs = vaultGlobalDirectories(config);
      expect(dirs).toHaveLength(5);
      expect(dirs).toContain("/home/user/Vault/60-Work-Log/_global/architecture");
      expect(dirs).toContain("/home/user/Vault/60-Work-Log/_global/domain-facts");
      expect(dirs).toContain("/home/user/Vault/60-Work-Log/_global/api-contracts");
      expect(dirs).toContain("/home/user/Vault/60-Work-Log/_global/glossary");
      expect(dirs).toContain("/home/user/Vault/60-Work-Log/_global/lessons-learned");
    });
  });

  describe("DEFAULT_VAULT_EXCLUDES", () => {
    test("contains expected exclusions", () => {
      expect(DEFAULT_VAULT_EXCLUDES).toContain("config.yaml");
      expect(DEFAULT_VAULT_EXCLUDES).toContain("locks/");
      expect(DEFAULT_VAULT_EXCLUDES).toContain("raw/");
      expect(DEFAULT_VAULT_EXCLUDES).toContain(".obsidian*");
      expect(DEFAULT_VAULT_EXCLUDES).toContain("index.json");
    });
  });
});
