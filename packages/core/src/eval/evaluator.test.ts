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

  it("pins the expr-eval error-message contract used by AUDIT-11", () => {
    // We extract the undefined-identifier from expr-eval's error message via
    // a regex (UNDEFINED_VAR_RE in expr-eval-adapter.ts) so AUDIT-11 can tell
    // the user WHICH identifier is missing. If a future expr-eval upgrade
    // reworded the message (e.g. "unknown variable foo" or "foo is not
    // defined"), our regex would silently fail to capture and AUDIT-11 would
    // degrade to a generic "identifier unknown" — without any other test
    // failing. This test locks the contract so the upgrade is caught loudly.
    let captured: EvaluationError | null = null;
    try {
      defaultEvaluator("missingIdent + 1", {});
    } catch (e) {
      if (e instanceof EvaluationError) captured = e;
    }
    expect(captured).not.toBeNull();
    expect(captured?.identifier).toBe("missingIdent");
    // Belt-and-braces: also assert the underlying message matches the
    // regex's expected shape directly.
    expect(captured?.message).toMatch(/undefined variable:?\s*missingIdent/i);
  });

  it("survives many distinct expressions without unbounded cache growth", () => {
    // Cache caps at AST_CACHE_MAX (1024). Send more than that to verify
    // the bound holds. We can't observe the cache directly without exposing
    // internals, so we rely on a behavioral signal: 2000 unique expressions
    // all evaluate correctly without throwing, in bounded time.
    for (let i = 0; i < 2000; i++) {
      expect(defaultEvaluator(`x + ${i}`, { x: 0 })).toBe(i);
    }
  });
});
