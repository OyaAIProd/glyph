/**
 * Voronoi / Delaunay primitives — D3 Gap 8 (PR77).
 *
 * Pure functions. Deterministic — same input points → same triangles
 * and polygons, byte-stable across runs.
 *
 * Algorithm: Bowyer-Watson incremental Delaunay triangulation, then
 * dualize to Voronoi cells. O(n log n) average, O(n²) worst-case.
 * Fine for the hover-targeting / lasso use cases (typically < 5k
 * points). For 100k+ point clouds, a flat-bucket k-NN is faster than
 * full Voronoi anyway — that's the user-facing nearest-neighbor API
 * exposed as `nearestPoint()` for the common case.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Triangle {
  readonly a: number; // index into the input points
  readonly b: number;
  readonly c: number;
}

/** A voronoi cell as a closed polygon (ring of points, last != first). */
export interface VoronoiCell {
  /** The site (one of the input points). */
  readonly site: Point;
  /** The site's index in the input array. */
  readonly siteIndex: number;
  /** Polygon ring; CCW order, not closed. */
  readonly polygon: ReadonlyArray<Point>;
}

// ---------------------------------------------------------------------------
// Nearest-neighbor (the common hover-targeting case)
// ---------------------------------------------------------------------------

/**
 * Index of the point in `points` nearest to `target`. O(N) brute force —
 * fine for < 10k points; consumers with hot paths should bucket their
 * points spatially.
 *
 * Returns -1 when `points` is empty.
 */
export function nearestPoint(points: ReadonlyArray<Point>, target: Point): number {
  if (points.length === 0) return -1;
  let bestI = 0;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    const dx = p.x - target.x;
    const dy = p.y - target.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestI = i;
    }
  }
  return bestI;
}

// ---------------------------------------------------------------------------
// Bowyer-Watson Delaunay triangulation
// ---------------------------------------------------------------------------

/**
 * Compute the Delaunay triangulation of a point set. Each triangle's
 * vertex indices reference `points`. Degenerate inputs (collinear
 * points, duplicates) return an empty list rather than throwing.
 *
 * Determinism: super-triangle is built from input-derived bounds, point
 * insertion is input-order, tie-breaking is stable index order.
 */
export function delaunayTriangulate(points: ReadonlyArray<Point>): ReadonlyArray<Triangle> {
  if (points.length < 3) return [];

  // 1. Build a super-triangle large enough to contain every input point.
  // Indices -1, -2, -3 conceptually; we use a parallel super-points
  // array and shift by points.length.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const dx = maxX - minX;
  const dy = maxY - minY;
  const deltaMax = Math.max(dx, dy) * 10 + 1;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  // Three super-points well outside the bounds.
  const N = points.length;
  const all: Point[] = [...points];
  all.push({ x: midX - 20 * deltaMax, y: midY - deltaMax });
  all.push({ x: midX, y: midY + 20 * deltaMax });
  all.push({ x: midX + 20 * deltaMax, y: midY - deltaMax });
  // Initial triangulation: just the super-triangle.
  let tris: Triangle[] = [{ a: N, b: N + 1, c: N + 2 }];

  // 2. Insert each input point one at a time.
  for (let i = 0; i < N; i++) {
    const p = all[i];
    if (!p) continue;
    // Find all triangles whose circumcircle contains p.
    const bad: Triangle[] = [];
    const good: Triangle[] = [];
    for (const t of tris) {
      if (circumcircleContains(all, t, p)) bad.push(t);
      else good.push(t);
    }
    // Polygon "hole" = edges of bad triangles that aren't shared with
    // another bad triangle.
    const edgeCount = new Map<string, { count: number; a: number; b: number }>();
    for (const t of bad) {
      for (const [u, v] of [
        [t.a, t.b],
        [t.b, t.c],
        [t.c, t.a],
      ] as const) {
        const key = u < v ? `${u}-${v}` : `${v}-${u}`;
        const entry = edgeCount.get(key);
        if (entry) entry.count += 1;
        else edgeCount.set(key, { count: 1, a: u, b: v });
      }
    }
    const hole: Array<{ a: number; b: number }> = [];
    for (const e of edgeCount.values()) {
      if (e.count === 1) hole.push({ a: e.a, b: e.b });
    }
    // Retriangulate the hole by connecting p to each boundary edge.
    const next: Triangle[] = [...good];
    for (const e of hole) {
      next.push({ a: e.a, b: e.b, c: i });
    }
    tris = next;
  }

  // 3. Remove triangles that touch any super-triangle vertex.
  const superMin = N;
  const out = tris.filter((t) => t.a < superMin && t.b < superMin && t.c < superMin);
  return out;
}

/**
 * Does triangle t's circumcircle contain point p?
 *
 * The standard determinant test is sign-sensitive to triangle winding
 * (CCW vs CW). We compute both the in-circle determinant AND the
 * triangle's signed orientation, then return inside ⟺ same sign — that
 * way the test works for arbitrary triangle winding.
 */
function circumcircleContains(points: ReadonlyArray<Point>, t: Triangle, p: Point): boolean {
  const a = points[t.a];
  const b = points[t.b];
  const c = points[t.c];
  if (!a || !b || !c) return false;
  const ax = a.x - p.x;
  const ay = a.y - p.y;
  const bx = b.x - p.x;
  const by = b.y - p.y;
  const cx = c.x - p.x;
  const cy = c.y - p.y;
  const det =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay);
  // Triangle orientation (signed 2× area).
  const orient = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (orient === 0) return false; // degenerate (collinear)
  // Inside ⟺ sign(det) === sign(orient).
  return (det > 0) === (orient > 0);
}

// ---------------------------------------------------------------------------
// Voronoi dual
// ---------------------------------------------------------------------------

/**
 * Build Voronoi cells from a set of points. Each cell is a polygon
 * ring of triangle circumcenters around the site, clipped to the
 * `bounds` rectangle (so unbounded cells become closed polygons).
 *
 * Determinism: same points + same bounds → same cells.
 */
export function voronoiPolygons(
  points: ReadonlyArray<Point>,
  bounds: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
): ReadonlyArray<VoronoiCell> {
  if (points.length === 0) return [];
  // Special case: a single point owns the entire bounds.
  if (points.length === 1) {
    const p = points[0];
    if (!p) return [];
    return [
      {
        site: p,
        siteIndex: 0,
        polygon: [
          { x: bounds.x0, y: bounds.y0 },
          { x: bounds.x1, y: bounds.y0 },
          { x: bounds.x1, y: bounds.y1 },
          { x: bounds.x0, y: bounds.y1 },
        ],
      },
    ];
  }
  const tris = delaunayTriangulate(points);
  // For each site, gather circumcenters of triangles that include it.
  const siteToCenters = new Map<number, Point[]>();
  for (const t of tris) {
    const center = circumcenter(points, t);
    if (!center) continue;
    for (const v of [t.a, t.b, t.c]) {
      let list = siteToCenters.get(v);
      if (!list) {
        list = [];
        siteToCenters.set(v, list);
      }
      list.push(center);
    }
  }
  const cells: VoronoiCell[] = [];
  for (let i = 0; i < points.length; i++) {
    const site = points[i];
    if (!site) continue;
    const centers = siteToCenters.get(i) ?? [];
    if (centers.length === 0) continue;
    // Sort centers by angle around the site for CCW ring order.
    const sorted = [...centers].sort((a, b) => {
      const angA = Math.atan2(a.y - site.y, a.x - site.x);
      const angB = Math.atan2(b.y - site.y, b.x - site.x);
      return angA - angB;
    });
    // Clip each vertex to the bounds rectangle.
    const clipped = sorted.map((c) => ({
      x: clamp(c.x, bounds.x0, bounds.x1),
      y: clamp(c.y, bounds.y0, bounds.y1),
    }));
    cells.push({ site, siteIndex: i, polygon: clipped });
  }
  return cells;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Compute the circumcenter of triangle t (or undefined for degenerate). */
function circumcenter(points: ReadonlyArray<Point>, t: Triangle): Point | undefined {
  const a = points[t.a];
  const b = points[t.b];
  const c = points[t.c];
  if (!a || !b || !c) return undefined;
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (d === 0) return undefined;
  const ux =
    ((a.x * a.x + a.y * a.y) * (b.y - c.y) +
      (b.x * b.x + b.y * b.y) * (c.y - a.y) +
      (c.x * c.x + c.y * c.y) * (a.y - b.y)) /
    d;
  const uy =
    ((a.x * a.x + a.y * a.y) * (c.x - b.x) +
      (b.x * b.x + b.y * b.y) * (a.x - c.x) +
      (c.x * c.x + c.y * c.y) * (b.x - a.x)) /
    d;
  return { x: ux, y: uy };
}
