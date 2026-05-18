/**
 * Tests for the linear-regression helper (PR65 / D3 fix-ups).
 */
import { describe, expect, it } from "vitest";
import { linearRegression, linearRegressionPairs } from "./regression.js";

describe("linearRegression", () => {
  it("recovers slope=2 intercept=1 from y=2x+1", () => {
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      [0, 1],
      [1, 3],
      [2, 5],
      [3, 7],
      [4, 9],
    ];
    const fit = linearRegression(rows, [{ name: "x" }, { name: "y" }], "x", "y");
    expect(fit.slope).toBeCloseTo(2, 10);
    expect(fit.intercept).toBeCloseTo(1, 10);
    expect(fit.r2).toBeCloseTo(1, 10);
    expect(fit.n).toBe(5);
  });

  it("returns the endpoint pair across the x-range", () => {
    const fit = linearRegressionPairs([0, 5, 10], [0, 10, 20]);
    const line = fit.line();
    expect(line.length).toBe(2);
    expect(line[0]?.x).toBe(0);
    expect(line[1]?.x).toBe(10);
  });

  it("handles a zero-variance x (vertical scatter) gracefully", () => {
    const fit = linearRegressionPairs([1, 1, 1], [0, 5, 10]);
    expect(fit.slope).toBe(0);
    expect(fit.r2).toBe(0);
  });

  it("skips non-finite (NaN / null) rows", () => {
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      [0, 1],
      [1, 3],
      [null, 100],
      [2, 5],
      ["nope", 999],
    ];
    const fit = linearRegression(rows, [{ name: "x" }, { name: "y" }], "x", "y");
    expect(fit.n).toBe(3);
    expect(fit.slope).toBeCloseTo(2, 10);
  });

  it("rejects unknown field names", () => {
    expect(() =>
      linearRegression([[1, 2]], [{ name: "x" }, { name: "y" }], "x", "missing"),
    ).toThrow(/not in schema/);
  });

  it("throws on empty input rather than returning a fake zero-fit", () => {
    expect(() => linearRegressionPairs([], [])).toThrow(/no finite \(x, y\) pairs/);
  });

  it("throws when every row is filtered as non-finite", () => {
    expect(() =>
      linearRegression(
        [
          [null, null],
          ["bad", "data"],
        ],
        [{ name: "x" }, { name: "y" }],
        "x",
        "y",
      ),
    ).toThrow(/no finite \(x, y\) pairs/);
  });

  it("is deterministic — same input → same fit", () => {
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      [1, 2],
      [2, 4.1],
      [3, 5.9],
    ];
    const a = linearRegression(rows, [{ name: "x" }, { name: "y" }], "x", "y");
    const b = linearRegression(rows, [{ name: "x" }, { name: "y" }], "x", "y");
    expect(a.slope).toBe(b.slope);
    expect(a.intercept).toBe(b.intercept);
    expect(a.r2).toBe(b.r2);
  });
});
