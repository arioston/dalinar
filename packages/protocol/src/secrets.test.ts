import { describe, expect, it } from "bun:test";
import { detectSecrets, detectSecretsInNote, shannonEntropy } from "./secrets.js";

describe("shannonEntropy", () => {
  it("returns 0 for empty string", () => {
    expect(shannonEntropy("")).toBe(0);
  });

  it("returns 0 for single character repeated", () => {
    expect(shannonEntropy("aaaa")).toBe(0);
  });

  it("returns higher entropy for mixed characters", () => {
    expect(shannonEntropy("a1b2c3d4")).toBeGreaterThan(2.0);
  });
});

describe("detectSecrets", () => {
  describe("Layer 1: known prefixes", () => {
    it("detects GitHub PAT", () => {
      const result = detectSecrets("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij");
      expect(result).not.toBeNull();
      expect(result!.rule).toBe("github-pat");
    });

    it("detects AWS access key", () => {
      const result = detectSecrets("key: AKIAIOSFODNN7EXAMPLE");
      expect(result).not.toBeNull();
      expect(result!.rule).toBe("aws-access-key");
    });

    it("detects Anthropic API key", () => {
      const result = detectSecrets("ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrst");
      expect(result).not.toBeNull();
      expect(result!.rule).toBe("anthropic-api-key");
    });

    it("detects JWT", () => {
      const result = detectSecrets("eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3ODkwIn0");
      expect(result).not.toBeNull();
      expect(result!.rule).toBe("jwt");
    });

    it("detects private key header", () => {
      const result = detectSecrets("-----BEGIN RSA PRIVATE KEY-----");
      expect(result).not.toBeNull();
      expect(result!.rule).toBe("private-key");
    });

    it("detects Stripe key pattern", () => {
      // Build test string dynamically to avoid GitHub push protection
      const prefix = ["sk", "live"].join("_");
      const result = detectSecrets(`${prefix}_${"x".repeat(24).replace(/x/g, (_, i) => String.fromCharCode(97 + (i % 26)))}`);
      expect(result).not.toBeNull();
      expect(result!.rule).toBe("stripe-key");
    });
  });

  describe("Layer 2: high-entropy strings", () => {
    it("detects long hex strings", () => {
      const result = detectSecrets("hash: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
      expect(result).not.toBeNull();
      expect(result!.rule).toBe("high-entropy-hex");
    });
  });

  describe("Layer 3: keyword proximity", () => {
    it("detects high-entropy string near 'token' keyword", () => {
      const result = detectSecrets("token = X8kP2mQ9vR3wY7zA");
      expect(result).not.toBeNull();
      expect(result!.rule).toBe("keyword-proximity");
    });

    it("detects high-entropy string near 'password' keyword", () => {
      const result = detectSecrets("password = xK9$mR2vQ7wZ4pL8");
      expect(result).not.toBeNull();
    });
  });

  describe("false positive resistance", () => {
    it("ignores normal prose", () => {
      expect(detectSecrets("The authentication module uses JWT tokens for session management")).toBeNull();
    });

    it("ignores camelCase identifiers", () => {
      expect(detectSecrets("getUserPermissions handles role-based access")).toBeNull();
    });

    it("ignores file paths", () => {
      expect(detectSecrets("located at /src/components/AuthProvider.tsx")).toBeNull();
    });

    it("ignores kebab-case words", () => {
      expect(detectSecrets("install graphql-yoga for the api layer")).toBeNull();
    });

    it("ignores short strings", () => {
      expect(detectSecrets("token: abc")).toBeNull();
    });
  });

  it("returns masked snippet", () => {
    const result = detectSecrets("my key is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij here");
    expect(result).not.toBeNull();
    expect(result!.snippet).toContain("***");
  });
});

describe("detectSecretsInNote", () => {
  it("scans both title and content", () => {
    const detections = detectSecretsInNote(
      "Normal title",
      "secret content with ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
    );
    expect(detections).toHaveLength(1);
    expect(detections[0]!.rule).toBe("github-pat");
  });

  it("flags secrets in title", () => {
    const detections = detectSecretsInNote(
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
      "Normal content",
    );
    expect(detections).toHaveLength(1);
    expect(detections[0]!.rule).toContain("title:");
  });

  it("returns empty for clean notes", () => {
    expect(detectSecretsInNote("Auth Architecture", "Uses JWT tokens for sessions")).toHaveLength(0);
  });
});
