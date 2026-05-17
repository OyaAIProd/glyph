/**
 * Scale tuning suggestions — PR60 item 2.6.
 *
 * Pure-fn heuristic that inspects a handle's rows and the planned encoding,
 * and suggests scale-type changes that would improve readability. The agent
 * (or human) decides whether to accept.
 *
 * Heuristics applied:
 *   - max/min ratio > 100 on a quantitative field → suggest `log`.
 *   - Symmetric around zero (sign-change distribution) → suggest `diverging`.
 *   - Long-tailed (skewness > 2) → suggest `sqrt` or `pow`.
 *   - Tight range (CV < 0.1) → no suggestion needed.
 *
 * Deterministic by construction. No clock, no PRNG, no LLM.
 */

import type { ExplainColumn } from "../explain/index.js";

export type ScaleSuggestionKind = "log" | "sqrt" | "diverging" | "none";

export interface ScaleSuggestion {
  /** The column the suggestion targets. */
  readonly field: string;
  /** The suggested scale type, or "none" when current scale is fine. */
  readonly kind: ScaleSuggestionKind;
  /** Confidence in [0, 1] — higher = stronger recommendation. */
  readonly confidence: number;
  /** Human-readable rationale for the suggestion. */
  readonly reason: string;
  /** Summary stats that drove the decision. */
  readonly stats: {
    readonly min: number;
    readonly max: number;
    readonly mean: number;
    readonly std: number;
    readonly skewness: number;
    readonly ratio: number;
  };
}

export interface SuggestScaleInput {
  readonly schema: ReadonlyArray<ExplainColumn>;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  /** Limit suggestions to a single field (e.g. the y channel). Optional. */
  readonly field?: string | undefined;
}

/**
 * Inspect every quantitative column (or just `field` if specified) and
 * return scale-tuning suggestions ranked by confidence.
 */
export function suggestScale(input: SuggestScaleInput): ReadonlyArray<ScaleSuggestion> {
  const suggestions: ScaleSuggestion[] = [];
  for (let i = 0; i < input.schema.length; i++) {
    const col = input.schema[i];
    if (!col) continue;
    if (input.field !== undefined && col.name !== input.field) continue;
    if (!isQuantitative(col)) continue;
    const values = collectNumeric(input.rows, i);
    if (values.length < 4) continue;
    const stats = describeDistribution(values);
    const suggestion = pickSuggestion(col.name, stats);
    if (suggestion) suggestions.push(suggestion);
  }
  // Sort by confidence descending.
  suggestions.sort((a, b) => b.confidence - a.confidence);
  return suggestions;
}

function isQuantitative(col: ExplainColumn): boolean {
  if (col.suggested === "quantitative") return true;
  const t = col.type.toUpperCase();
  return /INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/.test(t);
}

function collectNumeric(rows: ReadonlyArray<ReadonlyArray<unknown>>, idx: number): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = r[idx];
    const n = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : Number(v);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

interface Stats {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly std: number;
  readonly skewness: number;
  readonly ratio: number;
  readonly hasZeroCrossing: boolean;
}

function describeDistribution(values: ReadonlyArray<number>): Stats {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / values.length;
  let sse = 0;
  let cubeSum = 0;
  for (const v of values) {
    const d = v - mean;
    sse += d * d;
    cubeSum += d * d * d;
  }
  const variance = values.length > 1 ? sse / (values.length - 1) : 0;
  const std = Math.sqrt(variance);
  const skewness = std === 0 ? 0 : cubeSum / values.length / std ** 3;
  // Ratio uses |max/min| only when both are same sign; otherwise undefined.
  let ratio = 1;
  if (min > 0 && max > 0) ratio = max / min;
  else if (max < 0 && min < 0) ratio = Math.abs(min / max);
  const hasZeroCrossing = min < 0 && max > 0;
  return { min, max, mean, std, skewness, ratio, hasZeroCrossing };
}

function pickSuggestion(field: string, s: Stats): ScaleSuggestion | undefined {
  // Diverging — sign-crossing distribution with comparable magnitudes.
  if (
    s.hasZeroCrossing &&
    Math.abs(s.min) > 0.1 * s.max &&
    Math.abs(s.max) > 0.1 * Math.abs(s.min)
  ) {
    return {
      field,
      kind: "diverging",
      confidence: 0.85,
      reason: `Distribution crosses zero (min=${s.min.toFixed(2)}, max=${s.max.toFixed(2)}); a diverging color scale around 0 reads better than a linear ramp.`,
      stats: pubStats(s),
    };
  }
  // Log — multi-order-of-magnitude same-sign ratios.
  if (s.ratio > 100) {
    return {
      field,
      kind: "log",
      confidence: Math.min(0.95, 0.5 + Math.log10(s.ratio) / 8),
      reason: `Values span ${s.ratio.toFixed(0)}× (${s.min.toFixed(2)} → ${s.max.toFixed(2)}); a log scale avoids the smallest 99% of bars rendering invisible.`,
      stats: pubStats(s),
    };
  }
  // sqrt / pow — long-tailed but not multi-OoM.
  if (Math.abs(s.skewness) > 2 && s.ratio > 10) {
    return {
      field,
      kind: "sqrt",
      confidence: Math.min(0.75, 0.3 + Math.abs(s.skewness) / 10),
      reason: `Distribution is long-tailed (skewness=${s.skewness.toFixed(2)}); a sqrt or pow(0.5) scale gives short-tail values visible representation.`,
      stats: pubStats(s),
    };
  }
  // Tight range — no change recommended.
  if (s.std / Math.max(Math.abs(s.mean), 1e-9) < 0.1 && s.ratio < 2) {
    return {
      field,
      kind: "none",
      confidence: 0.9,
      reason: `Values are tightly clustered (CV ≈ ${(s.std / Math.max(Math.abs(s.mean), 1e-9)).toFixed(2)}); the default linear scale is appropriate.`,
      stats: pubStats(s),
    };
  }
  return undefined;
}

function pubStats(s: Stats): ScaleSuggestion["stats"] {
  return {
    min: s.min,
    max: s.max,
    mean: s.mean,
    std: s.std,
    skewness: s.skewness,
    ratio: s.ratio,
  };
}
