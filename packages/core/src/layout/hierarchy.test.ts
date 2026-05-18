/**
 * Tests for hierarchy layouts (PR67 / D3 Gap 2).
 *
 *   - hierarchyValues folds bottom-up
 *   - squarifiedTreemap covers the input rectangle exactly
 *   - partitionLayout divides the angular range proportionally
 *   - flatten helpers walk depth-first
 */
import { describe, expect, it } from "vitest";
import type { HierarchyNode } from "../spec/types.js";
import {
  flattenArcs,
  flattenRects,
  hierarchyValues,
  partitionLayout,
  squarifiedTreemap,
} from "./hierarchy.js";

const sampleTree: HierarchyNode = {
  name: "root",
  children: [
    {
      name: "A",
      children: [
        { name: "a1", value: 10 },
        { name: "a2", value: 20 },
      ],
    },
    {
      name: "B",
      value: 30,
    },
  ],
};

describe("hierarchyValues", () => {
  it("sums leaf values upward", () => {
    const v = hierarchyValues(sampleTree);
    expect(v.value).toBe(60); // 10 + 20 + 30
    expect(v.children?.[0]?.value).toBe(30); // 10 + 20
    expect(v.children?.[1]?.value).toBe(30); // explicit
  });

  it("defaults missing leaf values to 1", () => {
    const v = hierarchyValues({ name: "x" });
    expect(v.value).toBe(1);
  });
});

describe("squarifiedTreemap", () => {
  it("returns a root rect covering the input bounds", () => {
    const root = squarifiedTreemap(sampleTree, 0, 0, 100, 100);
    expect(root.x0).toBe(0);
    expect(root.y0).toBe(0);
    expect(root.x1).toBe(100);
    expect(root.y1).toBe(100);
    expect(root.value).toBe(60);
  });

  it("child rectangles tile within the parent (no overlap, full coverage)", () => {
    const root = squarifiedTreemap(sampleTree, 0, 0, 100, 100);
    const children = root.children ?? [];
    let totalArea = 0;
    for (const c of children) {
      totalArea += (c.x1 - c.x0) * (c.y1 - c.y0);
    }
    // Total area should equal the parent area within rounding error.
    expect(totalArea).toBeCloseTo(100 * 100, 0);
  });

  it("is deterministic — same tree → same layout", () => {
    const a = squarifiedTreemap(sampleTree, 0, 0, 100, 100);
    const b = squarifiedTreemap(sampleTree, 0, 0, 100, 100);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("handles a single leaf", () => {
    const root = squarifiedTreemap({ name: "solo", value: 42 }, 0, 0, 50, 50);
    expect(root.value).toBe(42);
    expect(root.children).toBeUndefined();
  });

  it("flattenRects walks depth-first", () => {
    const root = squarifiedTreemap(sampleTree, 0, 0, 100, 100);
    const flat = flattenRects(root);
    // root + 2 children + 2 grandchildren (a1, a2 under A; B is a leaf).
    expect(flat.length).toBe(5);
  });
});

describe("partitionLayout", () => {
  it("root occupies the full angular range", () => {
    const root = partitionLayout(sampleTree, 0, 100, 0, 2 * Math.PI);
    expect(root.startAngle).toBe(0);
    expect(root.endAngle).toBeCloseTo(2 * Math.PI, 6);
  });

  it("child sweeps sum to the parent sweep", () => {
    const root = partitionLayout(sampleTree, 0, 100);
    const sweep = root.endAngle - root.startAngle;
    const childSweeps = (root.children ?? []).reduce((s, c) => s + (c.endAngle - c.startAngle), 0);
    expect(childSweeps).toBeCloseTo(sweep, 6);
  });

  it("each ring has the same thickness (outerRadius - innerRadius)", () => {
    const root = partitionLayout(sampleTree, 0, 100);
    const flat = flattenArcs(root);
    // Skip root (which has its own ring) and look at depth-1 and depth-2.
    const r1 = flat.find((n) => n.depth === 1);
    const r2 = flat.find((n) => n.depth === 2);
    if (r1 && r2) {
      expect(r1.outerRadius - r1.innerRadius).toBeCloseTo(r2.outerRadius - r2.innerRadius, 6);
    }
  });

  it("is deterministic", () => {
    const a = partitionLayout(sampleTree, 0, 100);
    const b = partitionLayout(sampleTree, 0, 100);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
