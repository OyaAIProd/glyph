/**
 * Moat PR3 — unit tests for the missing-data policy resolver.
 *
 * Locks the contract three downstream consumers depend on:
 *   - "skip"         drops rows; AUDIT-10 fires off the input row count.
 *   - "callout"      keeps rows so the mark compiler can emit markers.
 *   - "interpolate"  bridges interior gaps; leading/trailing pass through.
 */
import { describe, expect, it } from "vitest";
import { applyMissingPolicy, countMissingY } from "./missing-policy.js";

const rowsFromY = (
  ys: ReadonlyArray<number | null | undefined>,
): ReadonlyArray<{ x: unknown; y: unknown }> => ys.map((y, i) => ({ x: i, y }));

describe("applyMissingPolicy — skip", () => {
  it("drops null/undefined/NaN rows entirely", () => {
    const out = applyMissingPolicy(
      [
        { x: "a", y: 1 },
        { x: "b", y: null },
        { x: "c", y: 3 },
        { x: "d", y: undefined },
        { x: "e", y: Number.NaN },
        { x: "f", y: 6 },
      ],
      "skip",
    );
    expect(out.map((p) => [p.x, p.y])).toEqual([
      ["a", 1],
      ["c", 3],
      ["f", 6],
    ]);
    for (const p of out) {
      expect(p.wasMissing).toBe(false);
      expect(p.interpolated).toBeUndefined();
    }
  });

  it("passes through when no rows are missing", () => {
    const out = applyMissingPolicy(rowsFromY([1, 2, 3]), "skip");
    expect(out.map((p) => p.y)).toEqual([1, 2, 3]);
  });

  it("returns [] when every row is missing", () => {
    const out = applyMissingPolicy(rowsFromY([null, undefined, Number.NaN]), "skip");
    expect(out).toEqual([]);
  });

  it("returns [] on an empty input", () => {
    expect(applyMissingPolicy([], "skip")).toEqual([]);
  });
});

describe("applyMissingPolicy — callout", () => {
  it("keeps missing rows with y=undefined and wasMissing=true", () => {
    const out = applyMissingPolicy(
      [
        { x: "a", y: 1 },
        { x: "b", y: null },
        { x: "c", y: 3 },
      ],
      "callout",
    );
    expect(out).toHaveLength(3);
    expect(out[0]?.y).toBe(1);
    expect(out[0]?.wasMissing).toBe(false);
    expect(out[1]?.y).toBeUndefined();
    expect(out[1]?.wasMissing).toBe(true);
    expect(out[1]?.interpolated).toBeUndefined();
    expect(out[2]?.y).toBe(3);
  });

  it("treats NaN as missing for the callout policy", () => {
    const out = applyMissingPolicy([{ x: 0, y: Number.NaN }], "callout");
    expect(out[0]?.y).toBeUndefined();
    expect(out[0]?.wasMissing).toBe(true);
  });

  it("preserves insertion order across mixed valid/missing rows", () => {
    const out = applyMissingPolicy(rowsFromY([1, null, 3, null, 5]), "callout");
    expect(out.map((p) => p.x)).toEqual([0, 1, 2, 3, 4]);
    expect(out.map((p) => p.y)).toEqual([1, undefined, 3, undefined, 5]);
  });
});

describe("applyMissingPolicy — interpolate", () => {
  it("bridges a single-row interior gap linearly", () => {
    const out = applyMissingPolicy(rowsFromY([10, null, 20]), "interpolate");
    expect(out[0]?.y).toBe(10);
    expect(out[1]?.y).toBe(15); // midpoint of 10 and 20
    expect(out[1]?.interpolated).toBe(true);
    expect(out[1]?.wasMissing).toBe(true);
    expect(out[2]?.y).toBe(20);
  });

  it("bridges multi-row gaps proportionally", () => {
    const out = applyMissingPolicy(rowsFromY([0, null, null, null, 4]), "interpolate");
    // (0 -> 4) over span 4 means t=0.25, 0.5, 0.75 -> 1, 2, 3
    expect(out.map((p) => p.y)).toEqual([0, 1, 2, 3, 4]);
    for (let i = 1; i <= 3; i++) {
      expect(out[i]?.interpolated).toBe(true);
      expect(out[i]?.wasMissing).toBe(true);
    }
  });

  it("leaves leading missing values as undefined (no left neighbor)", () => {
    const out = applyMissingPolicy(rowsFromY([null, null, 5, 6]), "interpolate");
    expect(out[0]?.y).toBeUndefined();
    expect(out[0]?.wasMissing).toBe(true);
    expect(out[0]?.interpolated).toBeUndefined();
    expect(out[1]?.y).toBeUndefined();
    expect(out[2]?.y).toBe(5);
    expect(out[3]?.y).toBe(6);
  });

  it("leaves trailing missing values as undefined (no right neighbor)", () => {
    const out = applyMissingPolicy(rowsFromY([5, 6, null, null]), "interpolate");
    expect(out[0]?.y).toBe(5);
    expect(out[1]?.y).toBe(6);
    expect(out[2]?.y).toBeUndefined();
    expect(out[2]?.interpolated).toBeUndefined();
    expect(out[3]?.y).toBeUndefined();
  });

  it("handles all-missing input without crashing", () => {
    const out = applyMissingPolicy(rowsFromY([null, null, null]), "interpolate");
    expect(out.map((p) => p.y)).toEqual([undefined, undefined, undefined]);
    expect(out.every((p) => p.wasMissing)).toBe(true);
  });

  it("does nothing when no rows are missing", () => {
    const out = applyMissingPolicy(rowsFromY([1, 2, 3]), "interpolate");
    expect(out.map((p) => p.y)).toEqual([1, 2, 3]);
    for (const p of out) expect(p.interpolated).toBeUndefined();
  });

  it("treats NaN as a missing slot for interpolation", () => {
    const out = applyMissingPolicy(rowsFromY([10, Number.NaN, 20]), "interpolate");
    expect(out[1]?.y).toBe(15);
    expect(out[1]?.interpolated).toBe(true);
  });

  it("is deterministic across repeated calls", () => {
    const rows = rowsFromY([1, null, null, 4, 5, null, 7]);
    const a = applyMissingPolicy(rows, "interpolate");
    const b = applyMissingPolicy(rows, "interpolate");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("countMissingY", () => {
  it("counts null/undefined/NaN as missing and finite as present", () => {
    const c = countMissingY([
      { y: 1 },
      { y: null },
      { y: undefined },
      { y: Number.NaN },
      { y: 0 },
      { y: -3.14 },
    ]);
    expect(c).toEqual({ total: 6, missing: 3 });
  });

  it("returns total: 0 for empty input", () => {
    expect(countMissingY([])).toEqual({ total: 0, missing: 0 });
  });
});
