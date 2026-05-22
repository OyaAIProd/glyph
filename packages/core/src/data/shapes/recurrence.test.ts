/**
 * Tests for `data.shape: "recurrence"` — the iterative function
 * data shape proposed in docs/superpowers/plans/2026-05-22-math-
 * grammar-extensions.md and implemented at data/shapes/recurrence.ts.
 *
 * Coverage is intentionally focused on the contract — schema /
 * validation behavior, value-correctness for two canonical
 * recurrences (curlicue and logistic-map), determinism — rather
 * than every diff-from-trajectory micro-detail. Full snapshot
 * byte-stability lives in the fixture test.
 */
import { describe, expect, it } from "vitest";
import { iterateRecurrence } from "./recurrence.js";

describe("iterateRecurrence — validation", () => {
  it("rejects an empty state array", () => {
    expect(() =>
      iterateRecurrence({
        shape: "recurrence",
        state: [],
        initial: {},
        step: {},
        steps: 10,
      }),
    ).toThrow(/state must be a non-empty array/);
  });

  it("rejects state with the reserved name 'n'", () => {
    expect(() =>
      iterateRecurrence({
        shape: "recurrence",
        state: ["n"],
        initial: { n: 0 },
        step: { n: "n + 1" },
        steps: 5,
      }),
    ).toThrow(/reserved for the step index/);
  });

  it("rejects mismatched initial / step / state keys", () => {
    expect(() =>
      iterateRecurrence({
        shape: "recurrence",
        state: ["x"],
        initial: { x: 0, y: 0 }, // extra y
        step: { x: "x + 1" },
        steps: 5,
      }),
    ).toThrow(/doesn't correspond to any state variable/);
    expect(() =>
      iterateRecurrence({
        shape: "recurrence",
        state: ["x", "y"],
        initial: { x: 0, y: 0 },
        step: { x: "x + 1" }, // missing y
        steps: 5,
      }),
    ).toThrow(/step\.y is missing/);
  });

  it("rejects steps < 2 or > MAX_RECURRENCE_STEPS", () => {
    expect(() =>
      iterateRecurrence({
        shape: "recurrence",
        state: ["x"],
        initial: { x: 0 },
        step: { x: "x + 1" },
        steps: 1,
      }),
    ).toThrow(/steps must be an integer >= 2/);
    expect(() =>
      iterateRecurrence({
        shape: "recurrence",
        state: ["x"],
        initial: { x: 0 },
        step: { x: "x + 1" },
        steps: 200_001,
      }),
    ).toThrow(/exceeds MAX_RECURRENCE_STEPS/);
  });

  it("throws with a useful message when the recurrence diverges or fails to evaluate", () => {
    // The exact failure mode depends on whether the evaluator
    // returns Infinity (caught by our finite check → "became non-
    // finite") or itself throws on the overflow (caught by our
    // EvaluationError wrapper → "step.x failed"). Either is
    // acceptable; both name the step at which the divergence
    // happened so an author can drill in. Pin the contract loose
    // enough to survive an evaluator swap.
    expect(() =>
      iterateRecurrence({
        shape: "recurrence",
        state: ["x"],
        initial: { x: 1 },
        step: { x: "x * 1e308" }, // overflows within ~2 steps
        steps: 5,
      }),
    ).toThrow(/recurrence data:.*at n=/);
  });
});

describe("iterateRecurrence — value correctness", () => {
  it("walks the logistic map x_{n+1} = r·x·(1−x) for known r=3.2 → period-2", () => {
    const rows = iterateRecurrence({
      shape: "recurrence",
      state: ["x"],
      initial: { x: 0.5 },
      step: { x: "r * x * (1 - x)" },
      params: { r: 3.2 },
      steps: 100,
    });
    expect(rows).toHaveLength(100);
    expect(rows[0]).toEqual({ n: 0, x: 0.5 });
    // After ~30 iterations r=3.2 settles into a period-2 orbit
    // alternating between two fixed values. Verify late rows
    // oscillate around the analytic fixed points 0.5130... and
    // 0.7995... (to 3 decimals — RK accumulated rounding is fine).
    const tail = rows.slice(60).map((r) => r.x);
    const lo = Math.min(...tail);
    const hi = Math.max(...tail);
    expect(lo).toBeCloseTo(0.513, 3);
    expect(hi).toBeCloseTo(0.7995, 3);
  });

  it("walks the curlicue recurrence z_{n+1} = z_n + e^(i·θ·n²)", () => {
    // The complex form expressed as real components.
    const rows = iterateRecurrence({
      shape: "recurrence",
      state: ["x", "y"],
      initial: { x: 0, y: 0 },
      step: {
        x: "x + cos(theta * n * n)",
        y: "y + sin(theta * n * n)",
      },
      params: { theta: 1.5708 }, // π/2 — produces a four-fold symmetric figure
      steps: 50,
    });
    expect(rows).toHaveLength(50);
    expect(rows[0]).toEqual({ n: 0, x: 0, y: 0 });
    // The first step always uses n=1, so Δz = (cos(θ), sin(θ)).
    expect(rows[1]?.x).toBeCloseTo(Math.cos(1.5708), 6);
    expect(rows[1]?.y).toBeCloseTo(Math.sin(1.5708), 6);
    // Every row's n column must equal its index.
    rows.forEach((r, i) => {
      expect(r.n).toBe(i);
    });
  });
});

describe("iterateRecurrence — determinism", () => {
  it("emits byte-identical rows for the same spec across two calls", () => {
    const spec = {
      shape: "recurrence" as const,
      state: ["x", "y"],
      initial: { x: 0, y: 0 },
      step: {
        x: "x + cos(theta * n * n)",
        y: "y + sin(theta * n * n)",
      },
      params: { theta: 2.39996 }, // golden-angle curlicue
      steps: 500,
    };
    const a = iterateRecurrence(spec);
    const b = iterateRecurrence(spec);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
