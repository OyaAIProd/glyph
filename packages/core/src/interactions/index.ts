/**
 * Interaction primitives — D3 Gap 8 (PR77).
 *
 * Pure-fn helpers that the renderer + browser-side hydration use to
 * implement hover targeting, lasso selection, and zoom/pan UX. Each
 * helper is deterministic so the SVG snapshots that include them
 * (via data attrs) stay byte-stable.
 *
 * Exports:
 *   - nearestPoint(points, target) — O(N) hover nearest-neighbor
 *   - delaunayTriangulate(points)  — Bowyer-Watson incremental
 *   - voronoiPolygons(points, bounds) — Voronoi cells clipped to a box
 */

export * from "./voronoi.js";
