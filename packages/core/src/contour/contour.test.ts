/**
 * Tests for marching-squares (PR75 / D3 Gap 4).
 */
import { describe, expect, it } from "vitest";
import { type ContourGrid, marchingSquares, segmentsToPathD } from "./index.js";

describe("marchingSquares", () => {
  it("returns no segments for an all-below grid", () => {
    const grid: ContourGrid = {
      rows: 2,
      cols: 2,
      values: [0, 0, 0, 0],
    };
    expect(marchingSquares(grid, [0.5])).toEqual([]);
  });

  it("returns no segments for an all-above grid", () => {
    const grid: ContourGrid = {
      rows: 2,
      cols: 2,
      values: [1, 1, 1, 1],
    };
    expect(marchingSquares(grid, [0.5])).toEqual([]);
  });

  it("emits one segment for a single corner above (case 1)", () => {
    // Only bottom-left corner is above the threshold.
    const grid: ContourGrid = {
      rows: 2,
      cols: 2,
      values: [0, 0, 0, 1],
    };
    const segs = marchingSquares(grid, [0.5]);
    expect(segs.length).toBe(1);
    // The segment runs from the west edge to the south edge.
    const s = segs[0];
    expect(s).toBeDefined();
  });

  it("symmetric: flipping above/below produces the same segment count", () => {
    const a: ContourGrid = { rows: 3, cols: 3, values: [0, 0, 1, 0, 1, 1, 1, 1, 1] };
    const b: ContourGrid = { rows: 3, cols: 3, values: [1, 1, 0, 1, 0, 0, 0, 0, 0] };
    expect(marchingSquares(a, [0.5]).length).toBe(marchingSquares(b, [0.5]).length);
  });

  it("multiple thresholds produce multiple bands", () => {
    // 3×3 ramp 0..8.
    const grid: ContourGrid = {
      rows: 3,
      cols: 3,
      values: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    };
    const segs = marchingSquares(grid, [1.5, 4.5, 6.5]);
    // Each threshold produces ≥1 segment for a non-trivial ramp.
    const byThresh = new Map<number, number>();
    for (const s of segs) byThresh.set(s.threshold, (byThresh.get(s.threshold) ?? 0) + 1);
    expect(byThresh.get(1.5)).toBeGreaterThan(0);
    expect(byThresh.get(4.5)).toBeGreaterThan(0);
    expect(byThresh.get(6.5)).toBeGreaterThan(0);
  });

  it("is deterministic — same input → same output", () => {
    const grid: ContourGrid = {
      rows: 4,
      cols: 4,
      values: [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6],
    };
    const a = marchingSquares(grid, [2.5, 4.5]);
    const b = marchingSquares(grid, [2.5, 4.5]);
    expect(a).toEqual(b);
  });

  it("ignores non-finite thresholds", () => {
    const grid: ContourGrid = { rows: 2, cols: 2, values: [0, 1, 1, 0] };
    const segs = marchingSquares(grid, [Number.NaN, 0.5, Number.POSITIVE_INFINITY]);
    // Only the 0.5 threshold produces segments.
    expect(segs.every((s) => s.threshold === 0.5)).toBe(true);
  });

  it("handles a saddle (case 5) deterministically", () => {
    // TL high, BR high, TR low, BL low → saddle case 5+10.
    const grid: ContourGrid = {
      rows: 2,
      cols: 2,
      values: [1, 0, 0, 1],
    };
    const segs = marchingSquares(grid, [0.5]);
    // Saddle emits two segments.
    expect(segs.length).toBe(2);
  });

  it("rejects an undersized grid", () => {
    expect(() => marchingSquares({ rows: 1, cols: 2, values: [0, 1] }, [0.5])).toThrow(
      /at least 2/,
    );
  });

  it("rejects a values array of wrong length", () => {
    expect(() => marchingSquares({ rows: 2, cols: 2, values: [0, 1, 2] }, [0.5])).toThrow(
      /expected 4 values/,
    );
  });
});

describe("segmentsToPathD", () => {
  it("emits one M..L per segment with the supplied scale", () => {
    const grid: ContourGrid = { rows: 2, cols: 2, values: [0, 0, 0, 1] };
    const segs = marchingSquares(grid, [0.5]);
    // Scale: cell unit → 10× pixels.
    const d = segmentsToPathD(segs, (cx, cy) => ({ x: cx * 10, y: cy * 10 }));
    expect(d).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+/);
  });
});
