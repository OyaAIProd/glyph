/**
 * Tests for the default {@link Evaluator} (expr-eval-backed).
 *
 * Determinism is the headline contract — these tests verify the byte-
 * stable, side-effect-free behavior of the evaluator interface that
 * `sampleFunction` (math PR1) and future math marks rely on.
 */
import { describe, expect, it } from "vitest";
import { EvaluationError } from "./evaluator.js";
import { defaultEvaluator } from "./expr-eval-adapter.js";

describe("defaultEvaluator", () => {
  it("evaluates a simple identity", () => {
    expect(defaultEvaluator("x + 1", { x: 4 })).toBe(5);
  });

  it("evaluates trig functions", () => {
    expect(defaultEvaluator("sin(0)", {})).toBe(0);
    expect(defaultEvaluator("cos(0)", {})).toBe(1);
  });

  it("rejects an undefined identifier with a typed error", () => {
    expect(() => defaultEvaluator("y * 2", { x: 4 })).toThrow(EvaluationError);
    try {
      defaultEvaluator("y * 2", { x: 4 });
    } catch (e) {
      expect(e).toBeInstanceOf(EvaluationError);
      expect((e as EvaluationError).identifier).toBe("y");
      expect((e as EvaluationError).expression).toBe("y * 2");
    }
  });

  it("is deterministic across calls", () => {
    const a = defaultEvaluator("sin(x) * exp(-x/10)", { x: 1.234 });
    const b = defaultEvaluator("sin(x) * exp(-x/10)", { x: 1.234 });
    expect(a).toBe(b);
  });

  it("refuses to evaluate Math.random (no I/O / no clock by construction)", () => {
    // expr-eval doesn't bind `random` by default — it surfaces as an
    // undefined identifier. This locks the contract that the default
    // evaluator is side-effect-free.
    expect(() => defaultEvaluator("random()", {})).toThrow();
  });
});
