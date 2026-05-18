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

  it("handles case 10 saddle (TL+BR high) deterministically — N→E + W→S", () => {
    // Bit layout: TL=8, TR=4, BR=2, BL=1. TL+BR high → code = 8+2 = 10.
    // Corner avg = (1+0+1+0)/4 = 0.5; threshold also 0.5 → avg >= t.
    // Decider says contour segments connect the "above" diagonal:
    // N→E (isolating TR low) + W→S (isolating BL low).
    const grid: ContourGrid = { rows: 2, cols: 2, values: [1, 0, 0, 1] };
    const segs = marchingSquares(grid, [0.5]);
    expect(segs.length).toBe(2);
    // Sort the endpoints for assertion stability: each segment's endpoints
    // are at the midpoints of two edges of the 1×1 cell.
    // N edge midpoint: (0.5, 0). E edge: (1, 0.5). S edge: (0.5, 1). W edge: (0, 0.5).
    const endpoints = new Set<string>();
    for (const s of segs) {
      endpoints.add(`${s.x1},${s.y1}`);
      endpoints.add(`${s.x2},${s.y2}`);
    }
    expect(endpoints.has("0.5,0")).toBe(true); // N
    expect(endpoints.has("1,0.5")).toBe(true); // E
    expect(endpoints.has("0.5,1")).toBe(true); // S
    expect(endpoints.has("0,0.5")).toBe(true); // W
  });

  it("handles case 5 saddle (TR+BL high) deterministically — different connectivity from case 10", () => {
    // TR+BL high → code = 4+1 = 5. The opposite diagonal from case 10.
    const grid5: ContourGrid = { rows: 2, cols: 2, values: [0, 1, 1, 0] };
    const segs5 = marchingSquares(grid5, [0.5]);
    expect(segs5.length).toBe(2);
    // The case-5 connectivity must differ from case-10's at the same
    // threshold and avg level. With avg=0.5 in both, case 5 connects
    // N-W + S-E (separating the two "above" corners TR+BL). The set of
    // edge endpoints is the same 4 midpoints, but the *pairing* differs.
    const grid10: ContourGrid = { rows: 2, cols: 2, values: [1, 0, 0, 1] };
    const segs10 = marchingSquares(grid10, [0.5]);
    // Pair each segment's endpoints into a canonical key, then compare.
    const pairs = (segs: typeof segs5): Set<string> => {
      const out = new Set<string>();
      for (const s of segs) {
        const a = `${s.x1},${s.y1}`;
        const b = `${s.x2},${s.y2}`;
        out.add([a, b].sort().join(" | "));
      }
      return out;
    };
    const p5 = pairs(segs5);
    const p10 = pairs(segs10);
    // The set of pair-strings MUST differ between case 5 and case 10
    // (different connectivity). If a future refactor flips the decider's
    // >= to <, both cases would produce the same connectivity and this
    // assertion would fail.
    let differs = false;
    for (const k of p5) if (!p10.has(k)) differs = true;
    expect(differs).toBe(true);
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
