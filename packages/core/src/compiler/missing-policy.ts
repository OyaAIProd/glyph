/**
 * Moat PR3 — failure-aware rendering. Single source of truth for how the
 * compiler reacts to rows whose y-encoded value is null / undefined / NaN.
 *
 * Three policies (matching `DataSourceSchema.onMissing`):
 *
 *   - "skip"        drop the row from the output stream. This is the
 *                   default (back-compat with every existing snapshot),
 *                   but AUDIT-10 fires at render time when the silent
 *                   dropout exceeds 5% so the agent still learns about
 *                   the gap.
 *   - "callout"     keep the row in the stream with `y: undefined`. The
 *                   mark compiler emits an explicit visual marker
 *                   (dashed rect on the baseline for bars; "✕" glyph for
 *                   line/point) with a `<title>` tooltip "Missing value
 *                   at x=<value>" for accessibility.
 *   - "interpolate" linear-interpolate y from the previous valid row to
 *                   the next valid row. The interpolated point is
 *                   flagged so line/area compilers can dash the bridging
 *                   segment. Leading / trailing missing values fall
 *                   through to a "skip" outcome (no neighbor to
 *                   interpolate against) — `y` is undefined for those.
 *
 * The helper returns one `MissingPoint` per input row in insertion order;
 * callers can then iterate without re-implementing the policy logic. This
 * keeps the policy DRY across `buildBars`, `buildPoints`, `buildLines`,
 * `buildAreas`, and the future audit pass.
 */

import type { MissingPolicy } from "../spec/types.js";

/** One row's worth of policy-resolved y value plus the metadata flags
 *  that downstream renderers (bar callout marker, line dash segment)
 *  and the audit pass (`AUDIT-10`) consume. */
export interface MissingPoint {
  /** The original x value from the source row, untouched. */
  readonly x: unknown;
  /**
   * Resolved y:
   *   - finite number    → renderable point
   *   - undefined        → row is omitted from the visual output (either
   *                        the "skip" policy or a leading/trailing
   *                        unresolved interpolation gap)
   */
  readonly y: number | undefined;
  /** Set when `y` was synthesized by linear interpolation. */
  readonly interpolated?: boolean;
  /**
   * True iff the original row's y was null/undefined/NaN. Always set,
   * regardless of the policy choice — audit code reads this to count
   * the input-row missing-rate without needing to inspect the raw rows.
   */
  readonly wasMissing: boolean;
}

/** Coerce a raw cell to a finite number, or undefined when not. */
function toFiniteNumber(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Resolve a missing-data policy against an ordered row stream.
 *
 * Pure-function: same input → same output. No clock, no global state.
 *
 * Determinism note: insertion order is the contract. Callers that x-sort
 * their points (line/area in the non-parametric path) do so AFTER this
 * function returns, so interpolation operates on the row stream the spec
 * declared rather than a re-ordered view (which would change which two
 * neighbors bridge a gap).
 */
export function applyMissingPolicy(
  rows: ReadonlyArray<{ readonly x: unknown; readonly y: unknown }>,
  policy: MissingPolicy,
): ReadonlyArray<MissingPoint> {
  const n = rows.length;
  if (n === 0) return [];

  // Pass 1 — classify every row.
  const classified: MissingPoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = rows[i] as { x: unknown; y: unknown };
    const yNum = toFiniteNumber(r.y);
    if (yNum === undefined) {
      classified[i] = { x: r.x, y: undefined, wasMissing: true };
    } else {
      classified[i] = { x: r.x, y: yNum, wasMissing: false };
    }
  }

  if (policy === "skip") {
    // Drop missing rows entirely — they don't appear in the output stream.
    // The renderer pipeline sees no signal at all (this is the prior
    // behavior). AUDIT-10 fires at render time when this dropout > 5%.
    return classified.filter((p) => !p.wasMissing);
  }

  if (policy === "callout") {
    // Keep every row; missing rows carry `y: undefined` and `wasMissing`
    // so the mark compiler can emit an explicit marker.
    return classified;
  }

  // policy === "interpolate"
  // Walk forward, finding (prevIdx, nextIdx) pairs of valid points
  // bracketing each missing run. Leading / trailing missing values have
  // no neighbor on one side — they keep `y: undefined` (effectively
  // "skip" for those, since interpolation is undefined at the edges).
  const out: MissingPoint[] = classified.slice();
  let i = 0;
  // Find first valid index.
  let prevValid = -1;
  for (let k = 0; k < n; k++) {
    if (!classified[k]?.wasMissing) {
      prevValid = k;
      break;
    }
  }
  if (prevValid === -1) {
    // Every row is missing — nothing to interpolate against.
    return out;
  }
  i = prevValid + 1;
  while (i < n) {
    if (!classified[i]?.wasMissing) {
      prevValid = i;
      i++;
      continue;
    }
    // Find next valid index.
    let nextValid = -1;
    for (let k = i + 1; k < n; k++) {
      if (!classified[k]?.wasMissing) {
        nextValid = k;
        break;
      }
    }
    if (nextValid === -1) {
      // Trailing run — leave as-is.
      break;
    }
    // Interpolate every index in (prevValid, nextValid).
    const y0 = classified[prevValid]?.y as number;
    const y1 = classified[nextValid]?.y as number;
    const span = nextValid - prevValid;
    for (let j = prevValid + 1; j < nextValid; j++) {
      const t = (j - prevValid) / span;
      const y = y0 + (y1 - y0) * t;
      const orig = classified[j];
      if (orig) {
        out[j] = {
          x: orig.x,
          y,
          interpolated: true,
          wasMissing: true,
        };
      }
    }
    prevValid = nextValid;
    i = nextValid + 1;
  }
  return out;
}

/** Count helper used by the AUDIT-10 pass — kept here so the audit
 *  module doesn't have to re-implement the "what counts as missing"
 *  rule. Same input cell-set as `applyMissingPolicy`. */
export function countMissingY(
  rows: ReadonlyArray<{ readonly y: unknown }>,
): { readonly total: number; readonly missing: number } {
  let missing = 0;
  for (const r of rows) {
    if (toFiniteNumber(r.y) === undefined) missing++;
  }
  return { total: rows.length, missing };
}
