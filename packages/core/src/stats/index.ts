/**
 * Statistical helpers — PR65 / D3 fix-ups.
 *
 * Pure-fn primitives for in-process stat overlays. These are composable
 * with regular Glyph layers: compute the stat once, then encode the
 * result as an additional layer on top of the raw data.
 *
 * v0 ships: linearRegression. Future: density (KDE), bin (histogram),
 * polynomial regression, loess. Each is its own module so consumers
 * can tree-shake what they don't need.
 */

export * from "./regression.js";
