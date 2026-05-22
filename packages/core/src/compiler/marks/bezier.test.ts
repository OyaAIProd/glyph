/**
 * Math Phase 2 Track A PR A5 — unit tests for the bezier mark's
 * pure-function core (de Casteljau + polyline-to-d + construction
 * level emission).
 *
 * The fixture test (`__fixtures__/math/bezier-cubic.test.ts`) covers
 * end-to-end byte-identity against a locked SVG snapshot. These tests
 * pin the algorithmic primitives in isolation so a regression in the
 * math is caught with a small, easy-to-debug failure rather than a
 * 1000-line snapshot diff.
 */
import { describe, expect, it } from "vitest";
import {
  type BezierPoint,
  deCasteljauLevels,
  evaluateBezier,
  polylineToSvgD,
  sampleBezier,
} from "./bezier.js";

/** A known-good cubic for the determinism tests: the standard
 * "S-shape" with control points (0,0), (1,2), (2,-1), (3,1). */
const CUBIC: ReadonlyArray<BezierPoint> = [
  { x: 0, y: 0 },
  { x: 1, y: 2 },
  { x: 2, y: -1 },
  { x: 3, y: 1 },
];

/**
 * Closed-form cubic Bezier at parameter t for a P0..P3 polynomial:
 *   B(t) = (1-t)³ P0 + 3(1-t)²t P1 + 3(1-t)t² P2 + t³ P3
 * Pinned to verify the de Casteljau reduction matches the analytic
 * Bernstein form (different floating-point evaluation order, so
 * exact equality is too strict — we compare to within 1e-12).
 */
function cubicAnalytic(t: number, pts: ReadonlyArray<BezierPoint>): BezierPoint {
  const [p0, p1, p2, p3] = pts as [BezierPoint, BezierPoint, BezierPoint, BezierPoint];
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  return {
    x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
    y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
  };
}

describe("evaluateBezier (de Casteljau)", () => {
  it("matches the analytic Bernstein form for a known-good cubic at t=0.25, 0.5, 0.75", () => {
    for (const t of [0.25, 0.5, 0.75]) {
      const dc = evaluateBezier(CUBIC, t);
      const an = cubicAnalytic(t, CUBIC);
      expect(Math.abs(dc.x - an.x)).toBeLessThan(1e-12);
      expect(Math.abs(dc.y - an.y)).toBeLessThan(1e-12);
    }
  });

  it("pins endpoints: t=0 returns P0, t=1 returns Pn (exact, no rounding)", () => {
    const at0 = evaluateBezier(CUBIC, 0);
    const at1 = evaluateBezier(CUBIC, 1);
    expect(at0).toEqual({ x: 0, y: 0 });
    expect(at1).toEqual({ x: 3, y: 1 });
  });

  it("is deterministic — two evaluations at the same t return strictly equal numbers", () => {
    const a = evaluateBezier(CUBIC, 1 / 3);
    const b = evaluateBezier(CUBIC, 1 / 3);
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
  });
});

describe("sampleBezier", () => {
  it("returns samples + 1 points and pins the endpoints to the first/last control point", () => {
    const out = sampleBezier(CUBIC, 10);
    expect(out.length).toBe(11);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[10]).toEqual({ x: 3, y: 1 });
  });

  it("returns the empty array for degenerate input (< 2 points or < 1 sample)", () => {
    expect(sampleBezier([], 10)).toEqual([]);
    expect(sampleBezier([{ x: 0, y: 0 }], 10)).toEqual([]);
    expect(sampleBezier(CUBIC, 0)).toEqual([]);
  });
});

describe("deCasteljauLevels", () => {
  it("emits N-1 levels for an N-point input (cubic → 3 levels with 4, 3, 2 points)", () => {
    const lvls = deCasteljauLevels(CUBIC, 0.5);
    expect(lvls.length).toBe(3);
    expect(lvls[0]?.length).toBe(4);
    expect(lvls[1]?.length).toBe(3);
    expect(lvls[2]?.length).toBe(2);
  });

  it("level 0 IS the control polygon (verbatim copy of the input)", () => {
    const lvls = deCasteljauLevels(CUBIC, 0.5);
    expect(lvls[0]).toEqual(CUBIC.map((p) => ({ x: p.x, y: p.y })));
  });

  it("emits 4 levels for a quintic (6 control points → polylines of 6, 5, 4, 3, 2)", () => {
    const quintic: BezierPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
      { x: 3, y: 2 },
      { x: 4, y: 0 },
      { x: 5, y: 1 },
    ];
    const lvls = deCasteljauLevels(quintic, 0.3);
    // Algorithm reduces N → N-1 → ... → 2. Single-point level is
    // excluded (a single point is not a polyline).
    expect(lvls.map((l) => l.length)).toEqual([6, 5, 4, 3, 2]);
  });

  it("the final two-point line's midpoint at t equals B(t)", () => {
    const t = 0.4;
    const lvls = deCasteljauLevels(CUBIC, t);
    // The terminal level is guaranteed to be a 2-element line by the
    // algorithm — assert via length check, then narrow via tuple cast
    // so biome's noNonNullAssertion rule sees no `!` in the body.
    expect(lvls.length).toBeGreaterThan(0);
    const last = lvls[lvls.length - 1];
    if (!last || last.length !== 2) throw new Error("de Casteljau terminal must be a 2-point line");
    const [a, b] = last as [{ x: number; y: number }, { x: number; y: number }];
    const tip = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const bt = evaluateBezier(CUBIC, t);
    expect(Math.abs(tip.x - bt.x)).toBeLessThan(1e-12);
    expect(Math.abs(tip.y - bt.y)).toBeLessThan(1e-12);
  });
});

describe("polylineToSvgD", () => {
  it("emits 'M x y L x y …' for a multi-point polyline", () => {
    const d = polylineToSvgD([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
    ]);
    expect(d).toBe("M 10 20 L 30 40 L 50 60");
  });

  it("returns the empty string for degenerate (< 2 points) input", () => {
    expect(polylineToSvgD([])).toBe("");
    expect(polylineToSvgD([{ x: 10, y: 20 }])).toBe("");
  });

  it("preserves coordinate ordering and emits raw numbers (caller pre-rounds)", () => {
    const d = polylineToSvgD([
      { x: 1.5, y: 2.25 },
      { x: 3, y: 4 },
    ]);
    expect(d).toBe("M 1.5 2.25 L 3 4");
  });
});
