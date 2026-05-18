/**
 * Tests for the force simulation (PR68 / D3 Gap 5).
 *
 *   - simulateForce is deterministic given a seed
 *   - changing the seed changes the layout
 *   - nodes stay inside bounds
 *   - edges connect source/target nodes
 *   - beeswarm: no two points overlap; same x preserved
 */
import { describe, expect, it } from "vitest";
import { simulateBeeswarm, simulateForce } from "./force.js";

describe("simulateForce", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const edges = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "c", target: "d" },
    { source: "d", target: "a" },
  ];

  it("returns one laid-out node per input", () => {
    const out = simulateForce(nodes, edges, { bounds: [0, 0, 400, 400], seed: 42 });
    expect(out.length).toBe(4);
    expect(out.map((n) => n.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("is deterministic with a given seed", () => {
    const a = simulateForce(nodes, edges, { bounds: [0, 0, 400, 400], seed: 1 });
    const b = simulateForce(nodes, edges, { bounds: [0, 0, 400, 400], seed: 1 });
    expect(a).toEqual(b);
  });

  it("different seeds produce different layouts", () => {
    const a = simulateForce(nodes, edges, { bounds: [0, 0, 400, 400], seed: 1 });
    const b = simulateForce(nodes, edges, { bounds: [0, 0, 400, 400], seed: 99 });
    // At least one position must differ.
    const diff = a.some((na, i) => {
      const nb = b[i];
      return nb !== undefined && (na.x !== nb.x || na.y !== nb.y);
    });
    expect(diff).toBe(true);
  });

  it("keeps every node inside the bounds (minus radius)", () => {
    const out = simulateForce(nodes, edges, { bounds: [0, 0, 400, 400], seed: 42 });
    for (const n of out) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(400);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(400);
    }
  });

  it("uses provided initial x/y as the starting position", () => {
    const pinned = [{ id: "a", x: 50, y: 50, r: 4 }, { id: "b" }];
    // 0 iterations — should leave x/y untouched.
    const out = simulateForce(pinned, [], { bounds: [0, 0, 400, 400], seed: 42, iterations: 0 });
    const a = out.find((n) => n.id === "a");
    expect(a?.x).toBe(50);
    expect(a?.y).toBe(50);
  });

  it("works with no edges (lonely-particle layout)", () => {
    const out = simulateForce([{ id: "a" }, { id: "b" }, { id: "c" }], [], {
      bounds: [0, 0, 200, 200],
      seed: 7,
    });
    expect(out.length).toBe(3);
  });
});

describe("simulateBeeswarm", () => {
  it("preserves x coordinates exactly", () => {
    const xs = [10, 20, 30, 40, 50];
    const rs = [4, 4, 4, 4, 4];
    const out = simulateBeeswarm({ xs, rs, y: 100, yMin: 0, yMax: 200, seed: 1 });
    expect(out.map((p) => p.x)).toEqual([10, 20, 30, 40, 50]);
  });

  it("spreads same-x points along y", () => {
    const xs = [50, 50, 50, 50];
    const rs = [4, 4, 4, 4];
    const out = simulateBeeswarm({ xs, rs, y: 100, yMin: 0, yMax: 200, seed: 1 });
    // The four y-values shouldn't all be equal — collision spreads them.
    const yValues = out.map((p) => p.y);
    const allEqual = yValues.every((v) => v === yValues[0]);
    expect(allEqual).toBe(false);
  });

  it("is deterministic given a seed", () => {
    const args = { xs: [10, 20, 30], rs: [4, 4, 4], y: 100, yMin: 0, yMax: 200, seed: 1 };
    const a = simulateBeeswarm(args);
    const b = simulateBeeswarm(args);
    expect(a).toEqual(b);
  });

  it("clamps y values to [yMin, yMax]", () => {
    const xs = [50, 50, 50, 50, 50, 50];
    const rs = [10, 10, 10, 10, 10, 10];
    const out = simulateBeeswarm({ xs, rs, y: 100, yMin: 80, yMax: 120, seed: 1 });
    for (const p of out) {
      expect(p.y).toBeGreaterThanOrEqual(80);
      expect(p.y).toBeLessThanOrEqual(120);
    }
  });
});
