/**
 * Unit tests for `polylineLength` (Math Phase 2 / Track A2).
 *
 * Pins the contract:
 *   - same input → same output (deterministic, rounded to 8 decimals)
 *   - empty / single-M paths return 0 (no segments to measure)
 *   - M/L/Z is fully supported; unsupported commands gracefully return 0
 *   - subpaths via repeated M are summed
 *   - Z closes back to the last subpath origin
 */
import { describe, expect, it } from "vitest";
import { polylineLength } from "./path-length.js";

describe("polylineLength", () => {
  it("returns 0 for an empty string", () => {
    expect(polylineLength("")).toBe(0);
  });

  it("returns 0 for a single M (no segments)", () => {
    expect(polylineLength("M 10 20")).toBe(0);
  });

  it("computes a simple horizontal M-L (Euclidean distance)", () => {
    // (0,0) → (10,0) is exactly 10.
    expect(polylineLength("M 0 0 L 10 0")).toBe(10);
  });

  it("computes a 3-4-5 triangle hypotenuse via M-L", () => {
    // (0,0) → (3,4) is exactly 5.
    expect(polylineLength("M 0 0 L 3 4")).toBe(5);
  });

  it("sums multi-segment polylines", () => {
    // (0,0) → (10,0) → (10,10) → (0,10): three sides of length 10.
    expect(polylineLength("M 0 0 L 10 0 L 10 10 L 0 10")).toBe(30);
  });

  it("closes back to subpath origin on Z", () => {
    // (0,0) → (10,0) → (10,10) → close back to (0,0).
    // Sides: 10 + 10 + sqrt(200) ≈ 34.14213562.
    const len = polylineLength("M 0 0 L 10 0 L 10 10 Z");
    expect(len).toBeCloseTo(20 + Math.sqrt(200), 8);
  });

  it("handles multiple subpaths (each M starts a new one)", () => {
    // Two disjoint segments of length 5 each.
    expect(polylineLength("M 0 0 L 3 4 M 100 100 L 103 104")).toBe(10);
  });

  it("rounds to 8 decimal places (byte-stable across runs)", () => {
    const a = polylineLength("M 0 0 L 1 1");
    const b = polylineLength("M 0 0 L 1 1");
    expect(a).toBe(b);
    // Diagonal of a unit square is sqrt(2); roundPx truncates to 8 decimals
    // for cross-platform byte-identity.
    const expected = Math.round(Math.SQRT2 * 1e8) / 1e8;
    expect(a).toBe(expected);
    // Has exactly 8 decimals — i.e. roundPx ran on the result.
    expect(String(a).split(".")[1]?.length).toBeLessThanOrEqual(8);
  });

  it("returns 0 for paths with unsupported commands (Q/C/A)", () => {
    expect(polylineLength("M 0 0 Q 5 5 10 0")).toBe(0);
    expect(polylineLength("M 0 0 C 1 1 2 2 3 3")).toBe(0);
    expect(polylineLength("M 0 0 A 5 5 0 0 1 10 10")).toBe(0);
  });

  it("returns 0 for malformed input (NaN coordinates)", () => {
    expect(polylineLength("M oops 0 L 10 0")).toBe(0);
    expect(polylineLength("M 0 0 L NaN 0")).toBe(0);
  });

  it("handles comma-separated coordinates", () => {
    // SVG allows commas as separators between numbers.
    expect(polylineLength("M 0,0 L 10,0")).toBe(10);
  });

  it("ignores extraneous whitespace", () => {
    expect(polylineLength("   M   0   0   L   3   4  ")).toBe(5);
  });

  it("supports the exact format that buildLines emits", () => {
    // Real buildLines output: roundPx coordinates joined by " L ".
    const d = "M 12.5 34.25 L 50 34.25 L 50 100 L 12.5 100";
    // 37.5 + 65.75 + 37.5 = 140.75
    expect(polylineLength(d)).toBe(140.75);
  });
});
