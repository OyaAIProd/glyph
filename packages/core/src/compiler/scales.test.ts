import { describe, expect, it } from "vitest";
import {
  bandScale,
  linearScale,
  niceTicks,
  powScale,
  quantileScale,
  roundPx,
  thresholdScale,
} from "./scales.js";

describe("roundPx", () => {
  it("rounds to 8 decimals to stabilize cross-platform output", () => {
    expect(roundPx(1 / 3)).toBe(0.33333333);
  });
});

describe("linearScale", () => {
  it("maps domain endpoints to range endpoints", () => {
    const s = linearScale([0, 100], [0, 200]);
    expect(s.apply(0)).toBe(0);
    expect(s.apply(100)).toBe(200);
    expect(s.apply(50)).toBe(100);
  });

  it("collapses zero-span domain to range start", () => {
    const s = linearScale([5, 5], [10, 20]);
    expect(s.apply(5)).toBe(10);
  });
});

describe("bandScale", () => {
  it("places equal-width bands across the range", () => {
    const s = bandScale(["a", "b", "c"], [0, 300], 0);
    expect(s.bandwidth).toBe(100);
    expect(s.apply("a")).toBe(0);
    expect(s.apply("b")).toBe(100);
    expect(s.apply("c")).toBe(200);
  });

  it("returns NaN for unknown categories", () => {
    const s = bandScale(["a"], [0, 100]);
    expect(Number.isNaN(s.apply("z"))).toBe(true);
  });

  it("applies padding by shrinking bandwidth", () => {
    const s = bandScale(["a", "b"], [0, 200], 0.5);
    expect(s.bandwidth).toBe(50);
  });
});

describe("niceTicks", () => {
  it("returns rounded ticks bracketing the input domain", () => {
    const { domain, ticks } = niceTicks(0, 100, 5);
    expect(domain[0]).toBeLessThanOrEqual(0);
    expect(domain[1]).toBeGreaterThanOrEqual(100);
    expect(ticks.length).toBeGreaterThan(0);
  });

  it("handles a zero-width domain", () => {
    const { ticks } = niceTicks(5, 5);
    expect(ticks).toEqual([5]);
  });
});

describe("powScale (PR65 D3 fix-ups)", () => {
  it("maps domain → range using the exponent", () => {
    const s = powScale([0, 100], [0, 10], 0.5);
    // sqrt: at 25, t = sqrt(25)/sqrt(100) = 5/10 = 0.5; pixel = 5.
    expect(s.apply(25)).toBe(5);
    expect(s.apply(100)).toBe(10);
    expect(s.apply(0)).toBe(0);
  });

  it("preserves sign for negative inputs", () => {
    const s = powScale([-100, 100], [0, 10], 0.5);
    expect(s.apply(-100)).toBe(0);
    expect(s.apply(100)).toBe(10);
    // Symmetric around the midpoint.
    expect(s.apply(0)).toBe(5);
  });

  it("rejects non-positive exponents", () => {
    expect(() => powScale([0, 100], [0, 10], 0)).toThrow();
    expect(() => powScale([0, 100], [0, 10], -1)).toThrow();
  });
});

describe("thresholdScale (PR65 D3 fix-ups)", () => {
  it("buckets numbers by explicit breakpoints", () => {
    const s = thresholdScale<string>([25, 50, 75], ["low", "med", "high", "extreme"]);
    expect(s.apply(10)).toBe("low");
    expect(s.apply(30)).toBe("med");
    expect(s.apply(60)).toBe("high");
    expect(s.apply(90)).toBe("extreme");
  });

  it("rejects mismatched outputs length", () => {
    expect(() => thresholdScale([25, 50], ["a", "b"])).toThrow(/outputs.length/);
  });

  it("places boundary value into the upper bucket", () => {
    const s = thresholdScale<string>([50], ["lo", "hi"]);
    expect(s.apply(50)).toBe("hi");
  });
});

describe("quantileScale (PR65 D3 fix-uups)", () => {
  it("splits sample into N equal-rank buckets", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const s = quantileScale<string>(samples, ["low", "mid", "high"]);
    expect(s.apply(2)).toBe("low");
    expect(s.apply(5)).toBe("mid");
    expect(s.apply(9)).toBe("high");
  });

  it("rejects empty outputs", () => {
    expect(() => quantileScale([], [])).toThrow();
  });

  it("is deterministic — same sample → same thresholds", () => {
    const a = quantileScale([1, 5, 9, 13, 17], ["a", "b"]);
    const b = quantileScale([1, 5, 9, 13, 17], ["a", "b"]);
    expect(a.thresholds).toEqual(b.thresholds);
  });
});
