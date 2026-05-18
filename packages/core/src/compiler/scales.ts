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
