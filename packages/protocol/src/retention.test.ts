import { describe, expect, it } from "bun:test";
import {
  computeStability,
  computeRetention,
  computeTypedRetention,
  effectiveHalfLife,
  BASE_HALF_LIFE_DAYS,
  TOMBSTONE_THRESHOLD,
  RETENTION_CONTEXT_THRESHOLD,
  msToDays,
} from "./retention.js";

describe("computeStability", () => {
  it("returns 1.0 for zero accesses", () => {
    expect(computeStability(0)).toBeCloseTo(1.0, 5);
  });

  it("grows logarithmically", () => {
    expect(computeStability(1)).toBeCloseTo(1.693, 2);
    expect(computeStability(5)).toBeCloseTo(2.791, 2);
    expect(computeStability(20)).toBeCloseTo(4.044, 2);
  });

  it("has diminishing returns", () => {
    const d1 = computeStability(1) - computeStability(0);
    const d10 = computeStability(11) - computeStability(10);
    expect(d1).toBeGreaterThan(d10);
  });
});

describe("computeRetention", () => {
  it("returns 1.0 at time zero", () => {
    expect(computeRetention(0, 1.0)).toBeCloseTo(1.0, 5);
  });

  it("returns ~0.5 at half-life for stability=1", () => {
    expect(computeRetention(BASE_HALF_LIFE_DAYS, 1.0)).toBeCloseTo(0.5, 2);
  });

  it("decays slower with higher stability", () => {
    const low = computeRetention(60, 1.0);
    const high = computeRetention(60, 3.0);
    expect(high).toBeGreaterThan(low);
  });

  it("eventually drops below tombstone threshold", () => {
    const retention = computeRetention(200, 1.0);
    expect(retention).toBeLessThan(TOMBSTONE_THRESHOLD);
  });

  it("never goes negative", () => {
    expect(computeRetention(10000, 1.0)).toBeGreaterThanOrEqual(0);
  });
});

describe("effectiveHalfLife", () => {
  it("returns 90 days for glossary", () => {
    expect(effectiveHalfLife("glossary")).toBe(90);
  });

  it("returns 60 days for domain-fact", () => {
    expect(effectiveHalfLife("domain-fact")).toBe(60);
  });

  it("returns 45 days for architecture", () => {
    expect(effectiveHalfLife("architecture")).toBe(45);
  });

  it("returns 30 days for api-contract", () => {
    expect(effectiveHalfLife("api-contract")).toBe(30);
  });

  it("returns 15 days for lesson-learned", () => {
    expect(effectiveHalfLife("lesson-learned")).toBe(15);
  });
});

describe("computeTypedRetention", () => {
  it("glossary decays slower than lesson-learned", () => {
    const glossary = computeTypedRetention(30, 0, "glossary");
    const lesson = computeTypedRetention(30, 0, "lesson-learned");
    expect(glossary).toBeGreaterThan(lesson);
  });

  it("matches architecture plan retention table at 30 days, 0 accesses", () => {
    // From architecture plan: glossary ~79%, domain-fact ~71%, architecture ~63%,
    // api-contract ~50%, lesson-learned ~25%
    expect(computeTypedRetention(30, 0, "glossary")).toBeCloseTo(0.79, 1);
    expect(computeTypedRetention(30, 0, "domain-fact")).toBeCloseTo(0.71, 1);
    expect(computeTypedRetention(30, 0, "architecture")).toBeCloseTo(0.63, 1);
    expect(computeTypedRetention(30, 0, "api-contract")).toBeCloseTo(0.50, 1);
    expect(computeTypedRetention(30, 0, "lesson-learned")).toBeCloseTo(0.25, 1);
  });

  it("access count increases retention", () => {
    const noAccess = computeTypedRetention(60, 0, "architecture");
    const accessed = computeTypedRetention(60, 5, "architecture");
    expect(accessed).toBeGreaterThan(noAccess);
  });
});

describe("msToDays", () => {
  it("converts 1 day in ms", () => {
    expect(msToDays(86_400_000)).toBeCloseTo(1.0, 5);
  });
});

describe("thresholds", () => {
  it("RETENTION_CONTEXT_THRESHOLD is 10%", () => {
    expect(RETENTION_CONTEXT_THRESHOLD).toBe(0.10);
  });

  it("TOMBSTONE_THRESHOLD is 1%", () => {
    expect(TOMBSTONE_THRESHOLD).toBe(0.01);
  });
});
