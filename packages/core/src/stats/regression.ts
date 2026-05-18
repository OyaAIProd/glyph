/**
 * Linear regression — PR65 / D3 fix-ups.
 *
 * D3 has `d3-regression` (linear, exponential, polynomial, loess). Glyph
 * v0 ships **linear OLS** only — the most-used flavor and the cheapest
 * to implement deterministically. The output is a small object the host
 * agent can plug into a second `line` layer overlay:
 *
 *   const fit = linearRegression(rows, "x", "y");
 *   // fit.line() returns the two endpoints to draw across the x-range.
 *
 * Pure function. No clock, no randomness. Deterministic to 1e-10 over
 * any reasonable dataset.
 */

export interface LinearRegressionFit {
  /** Slope. */
  readonly slope: number;
  /** y-intercept (where the fitted line hits x=0). */
  readonly intercept: number;
  /** Coefficient of determination (R²) ∈ [0, 1]; higher = better fit. */
  readonly r2: number;
  /** Number of (x, y) pairs the fit was computed over. */
  readonly n: number;
  /** Two endpoint coordinates for plotting: [{x: minX, y}, {x: maxX, y}]. */
  readonly line: () => ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

/** Compute a least-squares linear fit over the (x, y) pairs in `rows`. */
export function linearRegression(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<{ readonly name: string }>,
  xField: string,
  yField: string,
): LinearRegressionFit {
  const xi = schema.findIndex((c) => c.name === xField);
  const yi = schema.findIndex((c) => c.name === yField);
  if (xi < 0) throw new Error(`linearRegression: xField "${xField}" not in schema`);
  if (yi < 0) throw new Error(`linearRegression: yField "${yField}" not in schema`);
  const xs: number[] = [];
  const ys: number[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    const rx = r[xi];
    const ry = r[yi];
    // Skip nulls/undefined explicitly — Number(null) coerces to 0, which
    // would silently corrupt the fit.
    if (rx === null || rx === undefined || ry === null || ry === undefined) continue;
    const x = Number(rx);
    const y = Number(ry);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xs.push(x);
    ys.push(y);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  return linearRegressionPairs(xs, ys, minX, maxX);
}

/** Lower-level API: regress pre-extracted xs / ys arrays. */
export function linearRegressionPairs(
  xs: ReadonlyArray<number>,
  ys: ReadonlyArray<number>,
  minX?: number,
  maxX?: number,
): LinearRegressionFit {
  const n = xs.length;
  if (n === 0) {
    return {
      slope: 0,
      intercept: 0,
      r2: 0,
      n: 0,
      line: () => [],
    };
  }
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i] ?? 0;
    sumY += ys[i] ?? 0;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - meanX;
    const dy = (ys[i] ?? 0) - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  const slope = varX === 0 ? 0 : cov / varX;
  const intercept = meanY - slope * meanX;
  const r2 = varX === 0 || varY === 0 ? 0 : (cov * cov) / (varX * varY);
  let lo = minX;
  let hi = maxX;
  if (lo === undefined || hi === undefined) {
    lo = Math.min(...xs);
    hi = Math.max(...xs);
  }
  return {
    slope,
    intercept,
    r2,
    n,
    line: () => [
      { x: lo as number, y: intercept + slope * (lo as number) },
      { x: hi as number, y: intercept + slope * (hi as number) },
    ],
  };
}
