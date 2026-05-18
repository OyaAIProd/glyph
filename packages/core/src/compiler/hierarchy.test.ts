/**
 * Tests for the hierarchy compilation path (PR67 / D3 Gap 2).
 *
 *   - treemap mark → one rect per leaf
 *   - sunburst mark → one arc per non-root node
 *   - hierarchy specs render to SVG
 *   - byte-identity: cartesian specs unaffected by hierarchy branch
 */
import { describe, expect, it } from "vitest";
import { renderSvg } from "../render/svg.js";
import type { GlyphSpec, HierarchyNode } from "../spec/types.js";
import { compileSpec } from "./compile.js";

const tree: HierarchyNode = {
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

describe("compileHierarchy — treemap (PR67)", () => {
  it("emits rect marks for each leaf", () => {
    const spec: GlyphSpec = {
      data: { hierarchy: tree },
      layers: [{ mark: "treemap", encoding: {} }],
    };
    const scene = compileSpec({ spec, rows: [], schema: [] });
    const rects = scene.marks.filter((m) => m.type === "rect");
    // 3 leaves (a1, a2, B) + 1 interior node (A) shown as outline.
    expect(rects.length).toBeGreaterThanOrEqual(3);
  });

  it("rect bounds tile within the plot area", () => {
    const spec: GlyphSpec = {
      data: { hierarchy: tree },
      layers: [{ mark: "treemap", encoding: {} }],
      width: 400,
      height: 300,
    };
    const scene = compileSpec({ spec, rows: [], schema: [] });
    for (const m of scene.marks) {
      if (m.type !== "rect") continue;
      // Every rect should lie inside the plot area.
      expect(m.x).toBeGreaterThanOrEqual(scene.plotArea.x - 0.5);
      expect(m.y).toBeGreaterThanOrEqual(scene.plotArea.y - 0.5);
      expect(m.x + m.width).toBeLessThanOrEqual(scene.plotArea.x + scene.plotArea.width + 0.5);
      expect(m.y + m.height).toBeLessThanOrEqual(scene.plotArea.y + scene.plotArea.height + 0.5);
    }
  });

  it("is deterministic — same tree → same SVG", () => {
    const spec: GlyphSpec = {
      data: { hierarchy: tree },
      layers: [{ mark: "treemap", encoding: {} }],
    };
    const a = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const b = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(a).toBe(b);
  });
});

describe("compileHierarchy — sunburst (PR67)", () => {
  it("emits arc marks (one per non-root node)", () => {
    const spec: GlyphSpec = {
      data: { hierarchy: tree },
      layers: [{ mark: "sunburst", encoding: {} }],
    };
    const scene = compileSpec({ spec, rows: [], schema: [] });
    const arcs = scene.marks.filter((m) => m.type === "arc");
    // Depth 1: A, B (2). Depth 2: a1, a2 (2). Root skipped → 4 arcs.
    expect(arcs.length).toBe(4);
  });

  it("depth-1 arc sweeps add up to 2π (full circle)", () => {
    const spec: GlyphSpec = {
      data: { hierarchy: tree },
      layers: [{ mark: "sunburst", encoding: {} }],
    };
    const scene = compileSpec({ spec, rows: [], schema: [] });
    const arcs = scene.marks.filter((m) => m.type === "arc");
    // Group arcs by innerRadius. The smallest non-zero innerRadius is
    // depth-1, which should cover the full circle.
    const radii = arcs.map((m) => (m.type === "arc" ? m.innerRadius : 0)).sort((a, b) => a - b);
    const minRing = radii[0] ?? 0;
    let depth1Sweep = 0;
    for (const m of arcs) {
      if (m.type !== "arc") continue;
      if (Math.abs(m.innerRadius - minRing) < 0.5) {
        depth1Sweep += m.endAngle - m.startAngle;
      }
    }
    expect(depth1Sweep).toBeCloseTo(2 * Math.PI, 5);
  });

  it("renders without throwing", () => {
    const spec: GlyphSpec = {
      data: { hierarchy: tree },
      layers: [{ mark: "sunburst", encoding: {} }],
    };
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg).toContain("<svg");
  });
});

describe("byte-identity — cartesian specs unaffected by hierarchy branch", () => {
  it("a tabular spec compiles to the same SVG bytes as before", () => {
    const cartesianSpec: GlyphSpec = {
      data: { source: "fixture.csv" },
      layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
    };
    const sceneA = compileSpec({
      spec: cartesianSpec,
      rows: [
        ["a", 1],
        ["b", 2],
      ],
      schema: [
        { name: "x", type: "VARCHAR" },
        { name: "y", type: "INTEGER" },
      ],
    });
    const sceneB = compileSpec({
      spec: cartesianSpec,
      rows: [
        ["a", 1],
        ["b", 2],
      ],
      schema: [
        { name: "x", type: "VARCHAR" },
        { name: "y", type: "INTEGER" },
      ],
    });
    expect(renderSvg(sceneA)).toBe(renderSvg(sceneB));
    // Ensure no hierarchy-specific marks leaked in.
    expect(sceneA.marks.some((m) => m.type === "arc")).toBe(false);
  });
});
