/**
 * `data.shape: "function"` sampler (math PR1/6).
 *
 * Takes a {@link FunctionDataSpec} (free-variable range + expression),
 * samples the expression at evenly-spaced points across `[x.min, x.max]`,
 * and returns a row array shaped for Glyph's existing line / area / point
 * machinery. Non-finite outputs (e.g. `log(0)`, `log(-1)`) become `null`
 * in the row, which the line interpolator treats as a path break.
 *
 * Determinism: pure function. Same spec → same rows, byte-stable across
 * runs and platforms.
 *
 * The materializer keeps the dispatch (compile.ts → sampleFunction →
 * inline rows) so that all downstream features — facet, polar, animation,
 * audit, MCP — work unchanged.
 */

import { EvaluationError, type Evaluator } from "../../eval/evaluator.js";
import { defaultEvaluator } from "../../eval/expr-eval-adapter.js";

/**
 * Hard cap on samples per axis — protects the compiler from a malformed
 * spec DoS-ing the renderer. 100k is enough for any plot a human can
 * read; AUDIT-10 (math PR5) will additionally warn at 10k+.
 */
export const MAX_SAMPLES = 100_000;

/**
 * Scalar single-variable form: y = f(x). The single-`x` form is the math
 * PR1 baseline; math PR2 widens to parametric (t-driven {x, y}).
 */
export interface FunctionDataSpec {
  shape: "function";
  /** Free variable range. Currently fixed to `x`; PR2 generalizes. */
  x: { min: number; max: number; samples: number };
  /**
   * Single-output expression. Identifiers allowed: `x`, the constants
   * `pi` and `e`, and the standard math functions (`sin`, `cos`, `exp`,
   * `log`, `sqrt`, `abs`, `pow`, …) exposed by the evaluator.
   */
  expr: string;
  /**
   * Optional 3D z-coordinate expression. Today's renderer ignores it; a
   * future 3D renderer (Option B) reads it without a spec rev. Stays
   * undefined-safe so the 2D snapshot stays byte-identical.
   */
  zExpr?: string;
}

/**
 * One materialized sample row. `y` is `null` when the expression is
 * non-finite at that x (the renderer's line interpolator breaks the
 * path on null — same convention as missing tabular data).
 */
export interface FunctionRow {
  x: number;
  y: number | null;
  z?: number | null;
}

/**
 * Sample `spec.expr` at `spec.x.samples` evenly-spaced points across
 * `[spec.x.min, spec.x.max]`.
 *
 * Throws on structural errors (min >= max, samples < 2, samples beyond
 * the {@link MAX_SAMPLES} cap). Per-point non-finite results surface
 * as `null` rather than throwing, so a single hole in the domain
 * (`log(0)`) does not abort the whole render.
 */
export function sampleFunction(
  spec: FunctionDataSpec,
  evaluator: Evaluator = defaultEvaluator,
): FunctionRow[] {
  if (!Number.isFinite(spec.x.min) || !Number.isFinite(spec.x.max)) {
    throw new Error(
      `function data: x.min and x.max must be finite (got ${spec.x.min}, ${spec.x.max})`,
    );
  }
  if (spec.x.min >= spec.x.max) {
    throw new Error(`function data: x.min (${spec.x.min}) must be < x.max (${spec.x.max})`);
  }
  if (!Number.isInteger(spec.x.samples) || spec.x.samples < 2) {
    throw new Error(`function data: x.samples must be an integer >= 2 (got ${spec.x.samples})`);
  }
  if (spec.x.samples > MAX_SAMPLES) {
    throw new Error(
      `function data: x.samples (${spec.x.samples}) exceeds MAX_SAMPLES (${MAX_SAMPLES})`,
    );
  }

  const rows: FunctionRow[] = [];
  const step = (spec.x.max - spec.x.min) / (spec.x.samples - 1);
  const hasZ = spec.zExpr !== undefined;
  for (let i = 0; i < spec.x.samples; i++) {
    // Endpoints are anchored exactly to spec.x.min / spec.x.max — guards
    // against floating drift accumulating across the loop and shifting
    // snapshot bytes between platforms.
    const x = i === spec.x.samples - 1 ? spec.x.max : spec.x.min + step * i;
    const y = safeEval(evaluator, spec.expr, { x });
    if (hasZ) {
      // biome-ignore lint/style/noNonNullAssertion: hasZ guards spec.zExpr presence.
      const z = safeEval(evaluator, spec.zExpr!, { x });
      rows.push({ x, y, z });
    } else {
      rows.push({ x, y });
    }
  }
  return rows;
}

/**
 * Evaluate `expr` against `scope`, returning `null` when the result is
 * non-finite. Other evaluator errors (parse, unbound identifier) bubble
 * — those are spec-level mistakes the user needs to see, not per-point
 * holes.
 */
function safeEval(
  evaluator: Evaluator,
  expr: string,
  scope: Record<string, number>,
): number | null {
  try {
    return evaluator(expr, scope);
  } catch (e) {
    if (e instanceof EvaluationError && /non-finite/.test(e.message)) {
      return null;
    }
    throw e;
  }
}
