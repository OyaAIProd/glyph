/**
 * Tests for voronoi/delaunay primitives (PR77 / D3 Gap 8).
 */
import { describe, expect, it } from "vitest";
import { type Point, delaunayTriangulate, nearestPoint, voronoiPolygons } from "./voronoi.js";

describe("nearestPoint", () => {
  it("returns the index of the nearest point", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 50, y: 50 },
    ];
    expect(nearestPoint(pts, { x: 48, y: 52 })).toBe(2);
    expect(nearestPoint(pts, { x: 5, y: 5 })).toBe(0);
    expect(nearestPoint(pts, { x: 95, y: 95 })).toBe(1);
  });

  it("returns -1 for an empty list", () => {
    expect(nearestPoint([], { x: 0, y: 0 })).toBe(-1);
  });

  it("ties resolve to the lowest index (deterministic)", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    // Midpoint — both equidistant. First-wins.
    expect(nearestPoint(pts, { x: 5, y: 0 })).toBe(0);
  });
});

describe("delaunayTriangulate", () => {
  it("returns [] for < 3 points", () => {
    expect(delaunayTriangulate([])).toEqual([]);
    expect(delaunayTriangulate([{ x: 0, y: 0 }])).toEqual([]);
    expect(
      delaunayTriangulate([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toEqual([]);
  });

  it("triangulates 3 points into 1 triangle", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ];
    const tris = delaunayTriangulate(pts);
    expect(tris.length).toBe(1);
  });

  it("triangulates 4 points (square) into 2 triangles", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const tris = delaunayTriangulate(pts);
    expect(tris.length).toBe(2);
  });

  it("is deterministic — same input → same triangles", () => {
    const pts: Point[] = [
      { x: 10, y: 10 },
      { x: 50, y: 20 },
      { x: 30, y: 70 },
      { x: 80, y: 80 },
      { x: 5, y: 90 },
    ];
    const a = delaunayTriangulate(pts);
    const b = delaunayTriangulate(pts);
    expect(a).toEqual(b);
  });

  it("handles 10 random-ish points without throwing", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 4 },
      { x: 23, y: 17 },
      { x: 35, y: 50 },
      { x: 7, y: 60 },
      { x: 70, y: 22 },
      { x: 85, y: 70 },
      { x: 50, y: 90 },
      { x: 12, y: 85 },
      { x: 60, y: 5 },
    ];
    const tris = delaunayTriangulate(pts);
    // For 10 points in general position, ≈ 2n-2-h triangles (h = hull
    // points). We just assert "lots of triangles, no crash".
    expect(tris.length).toBeGreaterThan(5);
    // Every triangle's indices must be valid.
    for (const t of tris) {
      expect(t.a).toBeGreaterThanOrEqual(0);
      expect(t.b).toBeGreaterThanOrEqual(0);
      expect(t.c).toBeGreaterThanOrEqual(0);
      expect(t.a).toBeLessThan(pts.length);
      expect(t.b).toBeLessThan(pts.length);
      expect(t.c).toBeLessThan(pts.length);
    }
  });
});

describe("voronoiPolygons", () => {
  it("returns one cell per site", () => {
    const pts: Point[] = [
      { x: 25, y: 25 },
      { x: 75, y: 25 },
      { x: 50, y: 75 },
    ];
    const cells = voronoiPolygons(pts, { x0: 0, y0: 0, x1: 100, y1: 100 });
    expect(cells.length).toBe(3);
  });

  it("single point owns the entire bounds", () => {
    const cells = voronoiPolygons([{ x: 50, y: 50 }], { x0: 0, y0: 0, x1: 100, y1: 100 });
    expect(cells.length).toBe(1);
    expect(cells[0]?.polygon.length).toBe(4);
  });

  it("returns [] for empty input", () => {
    expect(voronoiPolygons([], { x0: 0, y0: 0, x1: 100, y1: 100 })).toEqual([]);
  });

  it("each cell's site equals the input point at siteIndex", () => {
    const pts: Point[] = [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 50, y: 90 },
    ];
    const cells = voronoiPolygons(pts, { x0: 0, y0: 0, x1: 100, y1: 100 });
    for (const cell of cells) {
      expect(cell.site).toEqual(pts[cell.siteIndex]);
    }
  });

  it("is deterministic", () => {
    const pts: Point[] = [
      { x: 10, y: 20 },
      { x: 60, y: 30 },
      { x: 40, y: 80 },
      { x: 80, y: 70 },
    ];
    const a = voronoiPolygons(pts, { x0: 0, y0: 0, x1: 100, y1: 100 });
    const b = voronoiPolygons(pts, { x0: 0, y0: 0, x1: 100, y1: 100 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
