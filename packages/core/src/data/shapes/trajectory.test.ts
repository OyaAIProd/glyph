/**
 * Tests for `integrateTrajectory` — the `data.shape: "trajectory"`
 * sampler (Math Phase 2 Track A PR A1, RK4 ODE solver).
 *
 * Determinism: byte-identical output across calls; structural errors
 * (min >= max, samples cap, non-finite initial) throw with clear
 * messages.
 *
 * Numerical coverage: the harmonic oscillator (`dx/dt = y`, `dy/dt =
 * -x`) is the canonical RK4 test case — the exact analytical
 * solution is `x(t) = cos(t)`, `y(t) = -sin(t)` starting from `(1,
 * 0)`. With 1000 samples across [0, 2π] RK4 should agree to ~1e-9.
 */
import { describe, expect, it } from "vitest";
import { integrateTrajectory } from "./trajectory.js";

describe("integrateTrajectory", () => {
  it("anchors the first row to the initial condition at t=time.min", () => {
    const rows = integrateTrajectory({
      shape: "trajectory",
      dxdt: "y",
      dydt: "-x",
      initial: { x: 1, y: 0 },
      time: { min: 0, max: 1, samples: 10 },
    });
    expect(rows[0]).toEqual({ t: 0, x: 1, y: 0 });
    expect(rows).toHaveLength(10);
  });

  it("anchors the last row's t to time.max exactly (endpoint anchoring)", () => {
    const rows = integrateTrajectory({
      shape: "trajectory",
      dxdt: "y",
      dydt: "-x",
      initial: { x: 1, y: 0 },
      time: { min: 0, max: Math.PI, samples: 100 },
    });
    // Last row's `t` must be exactly `time.max` — guards against
    // floating drift accumulating across the integration loop.
    expect(rows[99]?.t).toBe(Math.PI);
  });

  it("integrates the harmonic oscillator to machine-ish precision", () => {
    // dx/dt = y, dy/dt = -x with (1, 0) at t=0 → x(t) = cos(t), y(t) = -sin(t).
    // 1000 steps across [0, 2π] → RK4 error ~ h^4 ≈ (2π/1000)^4 ≈ 1.6e-12,
    // well within a 1e-8 tolerance. (Loose tolerance keeps the test
    // robust to future evaluator/precision tweaks.)
    const rows = integrateTrajectory({
      shape: "trajectory",
      dxdt: "y",
      dydt: "-x",
      initial: { x: 1, y: 0 },
      time: { min: 0, max: 2 * Math.PI, samples: 1000 },
    });
    // Periodic: x and y must return near the starting point after 2π.
    // Pull through a defensive check rather than `rows[...]!` so biome's
    // noNonNullAssertion stays on globally.
    const last = rows[rows.length - 1];
    if (!last) throw new Error("rows must be non-empty for this test");
    expect(last.x).toBeCloseTo(1, 8);
    expect(last.y).toBeCloseTo(0, 8);
    // Every row must agree with the closed-form solution
    // x(t) = cos(t), y(t) = -sin(t) to RK4 precision.
    for (const row of rows) {
      expect(row.x).toBeCloseTo(Math.cos(row.t), 6);
      expect(row.y).toBeCloseTo(-Math.sin(row.t), 6);
    }
  });

  it("produces byte-identical rows across two calls (determinism)", () => {
    const make = () =>
      integrateTrajectory({
        shape: "trajectory",
        dxdt: "y",
        dydt: "-x - 0.1*y",
        initial: { x: 1, y: 0 },
        time: { min: 0, max: 30, samples: 300 },
      });
    const a = make();
    const b = make();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("integrates a time-dependent system (uses t in the derivative)", () => {
    // dx/dt = 1, dy/dt = t  →  x(t) = t, y(t) = t^2/2 starting at (0, 0).
    const rows = integrateTrajectory({
      shape: "trajectory",
      dxdt: "1",
      dydt: "t",
      initial: { x: 0, y: 0 },
      time: { min: 0, max: 2, samples: 5 },
    });
    expect(rows[4]?.t).toBe(2);
    expect(rows[4]?.x).toBeCloseTo(2, 10);
    expect(rows[4]?.y).toBeCloseTo(2, 10); // 2^2 / 2 = 2
  });

  it("rejects time.min >= time.max with a clear error", () => {
    expect(() =>
      integrateTrajectory({
        shape: "trajectory",
        dxdt: "y",
        dydt: "-x",
        initial: { x: 1, y: 0 },
        time: { min: 5, max: 5, samples: 10 },
      }),
    ).toThrow(/time\.min.*time\.max/);
  });

  it("rejects samples below 2 with a clear error", () => {
    expect(() =>
      integrateTrajectory({
        shape: "trajectory",
        dxdt: "y",
        dydt: "-x",
        initial: { x: 1, y: 0 },
        time: { min: 0, max: 1, samples: 1 },
      }),
    ).toThrow(/time\.samples/);
  });

  it("rejects samples above MAX_SAMPLES with a clear error", () => {
    expect(() =>
      integrateTrajectory({
        shape: "trajectory",
        dxdt: "y",
        dydt: "-x",
        initial: { x: 1, y: 0 },
        time: { min: 0, max: 1, samples: 200_000 },
      }),
    ).toThrow(/MAX_SAMPLES/);
  });

  it("rejects non-finite initial coordinates with a clear error", () => {
    expect(() =>
      integrateTrajectory({
        shape: "trajectory",
        dxdt: "y",
        dydt: "-x",
        initial: { x: Number.NaN, y: 0 },
        time: { min: 0, max: 1, samples: 10 },
      }),
    ).toThrow(/initial/);
  });

  it("rejects expressions referencing an unbound identifier", () => {
    // `z` isn't one of the bound identifiers (x, y, t). The
    // evaluator should reject the expression with a message
    // mentioning the offending name so a typo is debuggable.
    expect(() =>
      integrateTrajectory({
        shape: "trajectory",
        dxdt: "y",
        dydt: "z + y", // z is unbound
        initial: { x: 1, y: 0 },
        time: { min: 0, max: 1, samples: 10 },
      }),
    ).toThrow(/z|unbound|undefined|unknown/i);
  });

  it("surfaces a divergent trajectory as a contextualized error", () => {
    // dx/dt = x^2 with x(0) = 10 has the analytical solution
    // x(t) = 10 / (1 - 10*t), which diverges at t = 0.1. The RK4
    // step blows up to +Infinity within the time window; evalDeriv
    // re-throws with the offending (x, y, t) coordinate so callers
    // can locate the singularity.
    expect(() =>
      integrateTrajectory({
        shape: "trajectory",
        dxdt: "x*x",
        dydt: "0",
        initial: { x: 10, y: 0 },
        time: { min: 0, max: 10, samples: 1000 },
      }),
    ).toThrow(/non-finite|trajectory|derivative/i);
  });

  it("emits rows in time order (insertion order) for closed orbits", () => {
    // Damped oscillator — every t should be strictly greater than
    // the previous one (no reordering). This is what lets the line
    // mark trace the spiral without zigzagging.
    const rows = integrateTrajectory({
      shape: "trajectory",
      dxdt: "y",
      dydt: "-x - 0.1*y",
      initial: { x: 1, y: 0 },
      time: { min: 0, max: 30, samples: 300 },
    });
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]?.t).toBeGreaterThan(rows[i - 1]?.t);
    }
  });
});
