/**
 * Scales — pure functions that map data values to pixel coordinates.
 *
 * Phase 0:
 *   - linear: continuous quantitative
 *   - band: categorical (used for x of bar charts)
 *
 * Deterministic to 8 decimal places — important for snapshot byte-identity.
 */

/** Round to 8 decimal places. Stabilizes outputs across platforms. */
export function roundPx(n: number): number {
  // 1e8 is the highest precision that's still safe for IEEE-754 doubles.
  return Math.round(n * 1e8) / 1e8;
}

export interface LinearScale {
  readonly type: "linear";
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  readonly apply: (v: number) => number;
}

export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const apply = (v: number): number => {
    if (span === 0) return roundPx(r0);
    const t = (v - d0) / span;
    return roundPx(r0 + t * (r1 - r0));
  };
  return { type: "linear", domain, range, apply };
}

export interface BandScale {
  readonly type: "band";
  readonly domain: ReadonlyArray<string>;
  readonly range: readonly [number, number];
  readonly bandwidth: number;
  readonly apply: (v: string) => number;
}

export function bandScale(
  domain: ReadonlyArray<string>,
  range: readonly [number, number],
  padding = 0.1,
): BandScale {
  const [r0, r1] = range;
  const step = (r1 - r0) / Math.max(1, domain.length);
  const bandwidth = roundPx(step * (1 - padding));
  const offset = (step - bandwidth) / 2;
  const index = new Map(domain.map((d, i) => [d, i] as const));
  const apply = (v: string): number => {
    const i = index.get(v);
    if (i === undefined) return Number.NaN;
    return roundPx(r0 + i * step + offset);
  };
  return { type: "band", domain, range, bandwidth, apply };
}

/**
 * PR65 (D3 fix-ups, no-architecture-change) — power-of-N continuous scale.
 *
 *   pow(0.5)  → equivalent to sqrt scale (matches D3 default sqrt exponent)
 *   pow(2)    → squaring scale (useful for area-encoded radius)
 *   pow(3)    → cubic — rare; exposed for completeness
 *
 * Identical signature to linearScale: `(domain, range) → { apply }`.
 * Determinism: maps every value through `Math.sign(t) * |t|^exp`, which
 * preserves sign for negative domains.
 */
export interface PowScale {
  readonly type: "pow";
  readonly exponent: number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  readonly apply: (v: number) => number;
}

export function powScale(
  domain: readonly [number, number],
  range: readonly [number, number],
  exponent: number,
): PowScale {
  if (!Number.isFinite(exponent) || exponent <= 0) {
    throw new Error(`powScale: exponent must be a positive finite number, got ${exponent}`);
  }
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const pow = (n: number): number => Math.sign(n) * Math.abs(n) ** exponent;
  const dp0 = pow(d0);
  const dp1 = pow(d1);
  const span = dp1 - dp0;
  const apply = (v: number): number => {
    if (span === 0) return roundPx(r0);
    const t = (pow(v) - dp0) / span;
    return roundPx(r0 + t * (r1 - r0));
  };
  return { type: "pow", exponent, domain, range, apply };
}

/**
 * PR65 — threshold scale. Maps numeric inputs to discrete output buckets
 * based on explicit breakpoints. With `breakpoints = [25, 50, 75]` and
 * `outputs = ["low", "med", "high", "extreme"]`:
 *
 *   apply(10)  → "low"
 *   apply(40)  → "med"
 *   apply(60)  → "high"
 *   apply(90)  → "extreme"
 *
 * outputs.length must be breakpoints.length + 1.
 */
export interface ThresholdScale<T> {
  readonly type: "threshold";
  readonly breakpoints: ReadonlyArray<number>;
  readonly outputs: ReadonlyArray<T>;
  readonly apply: (v: number) => T;
}

export function thresholdScale<T>(
  breakpoints: ReadonlyArray<number>,
  outputs: ReadonlyArray<T>,
): ThresholdScale<T> {
  if (outputs.length !== breakpoints.length + 1) {
    throw new Error(
      `thresholdScale: outputs.length (${outputs.length}) must be breakpoints.length + 1 (${breakpoints.length + 1})`,
    );
  }
  const apply = (v: number): T => {
    let i = 0;
    while (i < breakpoints.length && v >= (breakpoints[i] ?? 0)) i++;
    return outputs[i] as T;
  };
  return { type: "threshold", breakpoints, outputs, apply };
}

/**
 * PR65 — quantile scale. Sorts the sample, divides into N equal-rank
 * buckets, returns the i-th output for each input. Deterministic on a
 * given sample. Tie-breaking: lower index wins (i.e. boundary values
 * fall into the *lower* bucket).
 *
 *   samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
 *   outputs = ["low", "mid", "high"]  → 3 buckets, 33% each
 *   apply(15) → "low"     (15 is in the bottom third)
 *   apply(55) → "mid"
 *   apply(95) → "high"
 */
export interface QuantileScale<T> {
  readonly type: "quantile";
  readonly thresholds: ReadonlyArray<number>;
  readonly outputs: ReadonlyArray<T>;
  readonly apply: (v: number) => T;
}

export function quantileScale<T>(
  samples: ReadonlyArray<number>,
  outputs: ReadonlyArray<T>,
): QuantileScale<T> {
  if (outputs.length === 0) {
    throw new Error("quantileScale: outputs cannot be empty");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const n = outputs.length;
  const thresholds: number[] = [];
  for (let i = 1; i < n; i++) {
    const idx = ((sorted.length - 1) * i) / n;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const v =
      lo === hi
        ? (sorted[lo] ?? 0)
        : (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (idx - lo);
    thresholds.push(v);
  }
  const apply = (v: number): T => {
    let i = 0;
    while (i < thresholds.length && v >= (thresholds[i] ?? 0)) i++;
    return outputs[i] as T;
  };
  return { type: "quantile", thresholds, outputs, apply };
}

/**
 * PR66 — angle scale. Maps a categorical or linear domain into radians
 * around a circle. Categorical mode (default) gives every domain entry
 * an equal slice; linear mode (when `weights` is supplied) sizes slices
 * by the per-entry weight (used for pie charts where the bar values
 * become slice sizes).
 *
 * `startAngle` / `endAngle` are in radians, measured clockwise from
 * 12-o'clock (i.e. 0 = up, π/2 = right). Matches D3.arc convention.
 */
export interface AngleScale {
  readonly type: "angle";
  readonly domain: ReadonlyArray<string>;
  readonly startAngle: number;
  readonly endAngle: number;
  /** Returns [start, end] in radians for the category. */
  readonly apply: (v: string) => readonly [number, number];
}

export function angleScale(
  domain: ReadonlyArray<string>,
  startAngle: number,
  endAngle: number,
  weights?: ReadonlyArray<number>,
): AngleScale {
  const sweep = endAngle - startAngle;
  const useWeights = weights !== undefined && weights.length === domain.length;
  const total = useWeights
    ? (weights ?? []).reduce((s, w) => s + Math.max(0, w), 0)
    : domain.length;
  // Pre-compute cumulative start angle per domain entry for deterministic O(1) apply.
  const starts: number[] = [];
  let cursor = startAngle;
  for (let i = 0; i < domain.length; i++) {
    starts.push(cursor);
    const weight = useWeights ? Math.max(0, weights?.[i] ?? 0) : 1;
    cursor += total > 0 ? (weight / total) * sweep : 0;
  }
  // Plus one terminal angle so endAngle is reachable.
  starts.push(endAngle);
  const index = new Map(domain.map((d, i) => [d, i] as const));
  const apply = (v: string): readonly [number, number] => {
    const i = index.get(v);
    if (i === undefined) return [Number.NaN, Number.NaN];
    return [starts[i] ?? 0, starts[i + 1] ?? 0] as const;
  };
  return { type: "angle", domain, startAngle, endAngle, apply };
}

/**
 * PR66 — build an SVG `<path d="…">` string for one annular sector.
 * Deterministic to 8 decimals via `roundPx`. Handles three cases:
 *   1. innerRadius === 0 + sweep < 2π: pie slice (wedge to center).
 *   2. innerRadius > 0:                annular sector (donut slice).
 *   3. sweep >= 2π and innerRadius === 0: full disc (filled circle).
 *
 * Angle convention: clockwise from 12-o'clock (top = 0, right = π/2).
 * SVG y axis grows downward, so we subtract π/2 internally to rotate.
 */
export function arcPathD(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  // Rotate so 0 rad = up (12 o'clock) instead of right.
  const a0 = startAngle - Math.PI / 2;
  const a1 = endAngle - Math.PI / 2;
  const sweep = endAngle - startAngle;
  const largeArc = sweep > Math.PI ? 1 : 0;
  const ox = (r: number, a: number) => roundPx(cx + r * Math.cos(a));
  const oy = (r: number, a: number) => roundPx(cy + r * Math.sin(a));
  // Full ring (donut with no gap) — emit two concentric circles.
  if (sweep >= 2 * Math.PI - 1e-9) {
    if (innerRadius <= 0) {
      // Full disc.
      return `M ${ox(outerRadius, a0)} ${oy(outerRadius, a0)} A ${roundPx(outerRadius)} ${roundPx(outerRadius)} 0 1 1 ${ox(outerRadius, a0 + Math.PI)} ${oy(outerRadius, a0 + Math.PI)} A ${roundPx(outerRadius)} ${roundPx(outerRadius)} 0 1 1 ${ox(outerRadius, a0)} ${oy(outerRadius, a0)} Z`;
    }
    // Full ring — even-odd-fill rectangle of two circles.
    return `M ${ox(outerRadius, a0)} ${oy(outerRadius, a0)} A ${roundPx(outerRadius)} ${roundPx(outerRadius)} 0 1 1 ${ox(outerRadius, a0 + Math.PI)} ${oy(outerRadius, a0 + Math.PI)} A ${roundPx(outerRadius)} ${roundPx(outerRadius)} 0 1 1 ${ox(outerRadius, a0)} ${oy(outerRadius, a0)} Z M ${ox(innerRadius, a0)} ${oy(innerRadius, a0)} A ${roundPx(innerRadius)} ${roundPx(innerRadius)} 0 1 0 ${ox(innerRadius, a0 + Math.PI)} ${oy(innerRadius, a0 + Math.PI)} A ${roundPx(innerRadius)} ${roundPx(innerRadius)} 0 1 0 ${ox(innerRadius, a0)} ${oy(innerRadius, a0)} Z`;
  }
  if (innerRadius <= 0) {
    // Pie slice.
    return `M ${roundPx(cx)} ${roundPx(cy)} L ${ox(outerRadius, a0)} ${oy(outerRadius, a0)} A ${roundPx(outerRadius)} ${roundPx(outerRadius)} 0 ${largeArc} 1 ${ox(outerRadius, a1)} ${oy(outerRadius, a1)} Z`;
  }
  // Annular sector (donut slice).
  return `M ${ox(innerRadius, a0)} ${oy(innerRadius, a0)} L ${ox(outerRadius, a0)} ${oy(outerRadius, a0)} A ${roundPx(outerRadius)} ${roundPx(outerRadius)} 0 ${largeArc} 1 ${ox(outerRadius, a1)} ${oy(outerRadius, a1)} L ${ox(innerRadius, a1)} ${oy(innerRadius, a1)} A ${roundPx(innerRadius)} ${roundPx(innerRadius)} 0 ${largeArc} 0 ${ox(innerRadius, a0)} ${oy(innerRadius, a0)} Z`;
}

/**
 * PR66 — project polar (angle, radius) → cartesian (x, y) with the
 * clockwise-from-12-o'clock convention. Used for non-arc marks under
 * polar coordinates (e.g. a point chart in polar space → cartesian
 * positioned circles).
 */
export function polarToCartesian(
  cx: number,
  cy: number,
  angle: number,
  radius: number,
): { x: number; y: number } {
  const a = angle - Math.PI / 2;
  return { x: roundPx(cx + radius * Math.cos(a)), y: roundPx(cy + radius * Math.sin(a)) };
}

/**
 * "Nice" round numbers for a linear domain. Used for axis tick generation.
 * Adapted from d3-array's tickStep (BSD license), simplified for Phase 0.
 */
export function niceTicks(
  d0: number,
  d1: number,
  count = 5,
): { domain: [number, number]; ticks: number[] } {
  if (d0 === d1) {
    return { domain: [d0 - 1, d0 + 1], ticks: [d0] };
  }
  const span = d1 - d0;
  const step0 = span / Math.max(1, count);
  const exp = Math.floor(Math.log10(step0));
  const pow = 10 ** exp;
  const norm = step0 / pow;
  // Round to a "nice" multiple: 1, 2, 5, 10.
  let nice: number;
  if (norm < 1.5) nice = 1;
  else if (norm < 3) nice = 2;
  else if (norm < 7) nice = 5;
  else nice = 10;
  const step = nice * pow;
  const niceMin = Math.floor(d0 / step) * step;
  const niceMax = Math.ceil(d1 / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(roundPx(v));
  }
  return { domain: [roundPx(niceMin), roundPx(niceMax)], ticks };
}
