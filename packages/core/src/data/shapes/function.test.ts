/**
 * Tests for `sampleFunction` — the `data.shape: "function"` sampler
 * (math PR1/6 scalar + math PR2/6 parametric).
 *
 * Determinism: byte-identical output across calls; non-finite values
 * surface as `null` (line interpolator path-break); structural errors
 * (min >= max, samples cap) throw with clear messages.
 *
 * Parametric coverage (PR2): circle samples line up with cos/sin at
 * each step within float tolerance, byte-identity across two calls,
 * and the parameter column is present in every row so animations can
 * key off it.
 */
import { describe, expect, it } from "vitest";
import { MAX_SAMPLES, sampleFunction } from "./function.js";

describe("sampleFunction", () => {
  it("samples a simple identity at evenly-spaced points", () => {
    const rows = sampleFunction({
      shape: "function",
      x: { min: 0, max: 10, samples: 11 },
      expr: "x",
    });
    expect(rows).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
      { x: 5, y: 5 },
      { x: 6, y: 6 },
      { x: 7, y: 7 },
      { x: 8, y: 8 },
      { x: 9, y: 9 },
      { x: 10, y: 10 },
    ]);
  });

  it("produces byte-identical output across two calls", () => {
    const a = sampleFunction({
      shape: "function",
      x: { min: -Math.PI, max: Math.PI, samples: 500 },
      expr: "sin(x)",
    });
    const b = sampleFunction({
      shape: "function",
      x: { min: -Math.PI, max: Math.PI, samples: 500 },
      expr: "sin(x)",
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("emits null for points where the expression is non-finite", () => {
    // log(-1) → NaN, log(0) → -Infinity, log(1) → 0. The first two
    // should surface as `null` so the renderer can break the line
    // path; log(1) = 0 stays a real number.
    const rows = sampleFunction({
      shape: "function",
      x: { min: -1, max: 1, samples: 3 },
      expr: "log(x)",
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]?.y).toBeNull(); // log(-1) → NaN
    expect(rows[1]?.y).toBeNull(); // log(0)  → -Infinity
    expect(rows[2]?.y).toBe(0); // log(1)  → 0
  });

  it("caps samples at MAX_SAMPLES with a clear error", () => {
    expect(() =>
      sampleFunction({
        shape: "function",
        x: { min: 0, max: 1, samples: MAX_SAMPLES + 1 },
        expr: "x",
      }),
    ).toThrow(/MAX_SAMPLES/);
  });

  it("rejects min >= max with a clear error", () => {
    expect(() =>
      sampleFunction({
        shape: "function",
        x: { min: 5, max: 5, samples: 10 },
        expr: "x",
      }),
    ).toThrow(/min.*max/);
  });

  // -------------------------------------------------------------------------
  // Math PR2 — parametric form
  // -------------------------------------------------------------------------

  it("samples a parametric circle (cos t, sin t) correctly", () => {
    // 5 samples across [0, 2π] gives t = 0, π/2, π, 3π/2, 2π.
    // (cos, sin) should be (1,0), (0,1), (-1,0), (0,-1), (1,0).
    const rows = sampleFunction({
      shape: "function",
      parameter: { name: "t", min: 0, max: 2 * Math.PI, samples: 5 },
      xExpr: "cos(t)",
      yExpr: "sin(t)",
    });
    expect(rows).toHaveLength(5);
    // Endpoint anchoring guarantees t === 2π exactly at the last row.
    expect(rows[0]?.t).toBe(0);
    expect(rows[4]?.t).toBe(2 * Math.PI);
    // x at the four cardinal points (float tolerance for sin/cos drift).
    expect(rows[0]?.x).toBeCloseTo(1, 10);
    expect(rows[0]?.y).toBeCloseTo(0, 10);
    expect(rows[1]?.x).toBeCloseTo(0, 10);
    expect(rows[1]?.y).toBeCloseTo(1, 10);
    expect(rows[2]?.x).toBeCloseTo(-1, 10);
    expect(rows[2]?.y).toBeCloseTo(0, 10);
    expect(rows[3]?.x).toBeCloseTo(0, 10);
    expect(rows[3]?.y).toBeCloseTo(-1, 10);
    expect(rows[4]?.x).toBeCloseTo(1, 10);
    expect(rows[4]?.y).toBeCloseTo(0, 10);
  });

  it("produces byte-identical parametric output across two calls", () => {
    // Lissajous (3:2) is the canonical parametric shape — same spec
    // must yield byte-identical rows across calls (and platforms).
    const make = () =>
      sampleFunction({
        shape: "function",
        parameter: { name: "t", min: 0, max: 2 * Math.PI, samples: 400 },
        xExpr: "sin(3*t)",
        yExpr: "cos(2*t)",
      });
    const a = make();
    const b = make();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("includes the parameter column on every parametric row (for frame_field)", () => {
    // The animation hook does `schema.findIndex(c => c.name === frame_field)`,
    // so the parameter must be present in every row under its declared
    // name. This is the contract that lets `animation.kind: "scrub"`
    // + `frame_field: "t"` work without compiler changes.
    const rows = sampleFunction({
      shape: "function",
      parameter: { name: "t", min: 0, max: 1, samples: 6 },
      xExpr: "t",
      yExpr: "t * t",
    });
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row).toHaveProperty("t");
      expect(typeof row.t).toBe("number");
    }
    // The parameter column is the actual t value, not a derived field.
    expect(rows[0]?.t).toBe(0);
    expect(rows[5]?.t).toBe(1);
    // And x/y reflect the expressions.
    expect(rows[5]?.x).toBeCloseTo(1, 10);
    expect(rows[5]?.y).toBeCloseTo(1, 10);
  });

  it("supports a custom parameter name (not just 't')", () => {
    // `theta` is a common alternative; the column should appear under
    // that name verbatim.
    const rows = sampleFunction({
      shape: "function",
      parameter: { name: "theta", min: 0, max: Math.PI, samples: 3 },
      xExpr: "cos(theta)",
      yExpr: "sin(theta)",
    });
    expect(rows[0]).toHaveProperty("theta");
    expect(rows[0]?.theta).toBe(0);
    expect(rows[2]?.theta).toBe(Math.PI);
  });

  it("rejects a parameter name that collides with output columns", () => {
    expect(() =>
      sampleFunction({
        shape: "function",
        parameter: { name: "x", min: 0, max: 1, samples: 10 },
        xExpr: "1",
        yExpr: "1",
      }),
    ).toThrow(/collides/);
  });

  it("caps parametric samples at MAX_SAMPLES too", () => {
    expect(() =>
      sampleFunction({
        shape: "function",
        parameter: { name: "t", min: 0, max: 1, samples: MAX_SAMPLES + 1 },
        xExpr: "t",
        yExpr: "t",
      }),
    ).toThrow(/MAX_SAMPLES/);
  });

  it("supports a parametric 3D path (zExpr) without breaking 2D rows", () => {
    // The 2D renderer ignores `z`; here we just verify the sampler
    // emits a z field when requested (Option-B 3D readiness).
    const rows = sampleFunction({
      shape: "function",
      parameter: { name: "t", min: 0, max: 1, samples: 3 },
      xExpr: "t",
      yExpr: "t",
      zExpr: "t * 2",
    });
    expect(rows[0]?.z).toBe(0);
    expect(rows[2]?.z).toBe(2);
  });
});
