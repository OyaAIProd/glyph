/**
 * Tests for `sampleFunction` — the `data.shape: "function"` sampler
 * (math PR1/6).
 *
 * Determinism: byte-identical output across calls; non-finite values
 * surface as `null` (line interpolator path-break); structural errors
 * (min >= max, samples cap) throw with clear messages.
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
});
