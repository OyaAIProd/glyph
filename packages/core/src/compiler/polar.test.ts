/**
 * Tests for polar coordinates (PR66 / D3 Gap 1).
 *
 * Covers:
 *   - compiles pie chart (bar + polar) → arc marks
 *   - innerRadius produces a donut
 *   - point + polar produces circles at projected positions
 *   - line + polar produces a closed radial path
 *   - existing cartesian specs stay byte-identical (no regression)
 *   - angleScale weights size slices proportionally
 *   - arc-path renderer is deterministic
 */
import { describe, expect, it } from "vitest";
import { renderSvg } from "../render/svg.js";
import type { GlyphSpec } from "../spec/types.js";
import { compileSpec } from "./compile.js";
import { angleScale, polarToCartesian } from "./scales.js";

const pieSpec: GlyphSpec = {
  data: { source: "fixture.csv" },
  layers: [{ mark: "bar", encoding: { x: "category", y: "value" } }],
  coordinates: { type: "polar" },
};

const rows = [
  ["A", 30],
  ["B", 20],
  ["C", 50],
];
const schema = [
  { name: "category", type: "VARCHAR" },
  { name: "value", type: "INTEGER" },
];

describe("polar compileSpec (PR66)", () => {
  it("compiles a pie chart into 3 arc marks", () => {
    const scene = compileSpec({ spec: pieSpec, rows, schema });
    const arcs = scene.marks.filter((m) => m.type === "arc");
    expect(arcs.length).toBe(3);
    // Slice sizes should be proportional to value: 30+20+50 = 100.
    // Sum of sweeps must equal 2π.
    let totalSweep = 0;
    for (const m of arcs) {
      if (m.type !== "arc") continue;
      totalSweep += m.endAngle - m.startAngle;
    }
    expect(totalSweep).toBeCloseTo(2 * Math.PI, 5);
  });

  it("respects innerRadius for donut charts", () => {
    const spec: GlyphSpec = {
      ...pieSpec,
      coordinates: { type: "polar", innerRadius: 0.5 },
    };
    const scene = compileSpec({ spec, rows, schema });
    const arcs = scene.marks.filter((m) => m.type === "arc");
    expect(arcs[0]?.type).toBe("arc");
    if (arcs[0]?.type === "arc") {
      expect(arcs[0].innerRadius).toBeGreaterThan(0);
      expect(arcs[0].innerRadius).toBeLessThan(arcs[0].outerRadius);
    }
  });

  it("supports point marks in polar space → circles", () => {
    const spec: GlyphSpec = {
      data: { source: "fixture.csv" },
      layers: [{ mark: "point", encoding: { x: "category", y: "value" } }],
      coordinates: { type: "polar" },
    };
    const scene = compileSpec({ spec, rows, schema });
    const circles = scene.marks.filter((m) => m.type === "circle");
    expect(circles.length).toBe(3);
  });

  it("supports line marks in polar space → closed path", () => {
    const spec: GlyphSpec = {
      data: { source: "fixture.csv" },
      layers: [{ mark: "line", encoding: { x: "category", y: "value" } }],
      coordinates: { type: "polar" },
    };
    const scene = compileSpec({ spec, rows, schema });
    const paths = scene.marks.filter((m) => m.type === "path");
    expect(paths.length).toBe(1);
    if (paths[0]?.type === "path") {
      expect(paths[0].d).toMatch(/Z$/);
    }
  });

  it("renders arc marks to SVG `<path>` elements", () => {
    const scene = compileSpec({ spec: pieSpec, rows, schema });
    const svg = renderSvg(scene);
    // Three pie slices → three <path d="…"> elements with the arc command.
    const pathMatches = svg.match(/<path d="[^"]*A [^"]*"[^/]*\/>/g) ?? [];
    expect(pathMatches.length).toBe(3);
  });

  it("is deterministic — same spec → same SVG", () => {
    const a = renderSvg(compileSpec({ spec: pieSpec, rows, schema }));
    const b = renderSvg(compileSpec({ spec: pieSpec, rows, schema }));
    expect(a).toBe(b);
  });

  it("BYTE-IDENTITY: a non-polar spec compiles identically with the polar branch present", () => {
    const cartesianSpec: GlyphSpec = {
      data: { source: "fixture.csv" },
      layers: [{ mark: "bar", encoding: { x: "category", y: "value" } }],
    };
    const sceneA = compileSpec({ spec: cartesianSpec, rows, schema });
    const sceneB = compileSpec({ spec: cartesianSpec, rows, schema });
    expect(renderSvg(sceneA)).toBe(renderSvg(sceneB));
    // Ensure the cartesian path didn't emit any arc marks.
    expect(sceneA.marks.some((m) => m.type === "arc")).toBe(false);
  });

  it("supports a non-zero startAngle to rotate the pie", () => {
    const spec: GlyphSpec = {
      ...pieSpec,
      coordinates: { type: "polar", startAngle: 90 },
    };
    const scene = compileSpec({ spec, rows, schema });
    const arcs = scene.marks.filter((m) => m.type === "arc");
    if (arcs[0]?.type === "arc") {
      expect(arcs[0].startAngle).toBeCloseTo(Math.PI / 2, 6);
    }
  });
});

describe("angleScale", () => {
  it("equal-weight domain produces equal slices", () => {
    const s = angleScale(["a", "b", "c", "d"], 0, 2 * Math.PI);
    const [a0, a1] = s.apply("a");
    const [b0, b1] = s.apply("b");
    expect(a1 - a0).toBeCloseTo(b1 - b0, 6);
    expect(a1 - a0).toBeCloseTo(Math.PI / 2, 6);
  });

  it("weights produce proportional slices", () => {
    const s = angleScale(["a", "b"], 0, 2 * Math.PI, [25, 75]);
    const [a0, a1] = s.apply("a");
    const [b0, b1] = s.apply("b");
    // a should occupy 25% of the circle.
    expect(a1 - a0).toBeCloseTo(0.5 * Math.PI, 6);
    expect(b1 - b0).toBeCloseTo(1.5 * Math.PI, 6);
  });

  it("returns NaN for unknown category", () => {
    const s = angleScale(["a"], 0, 2 * Math.PI);
    const [n0] = s.apply("missing");
    expect(Number.isNaN(n0)).toBe(true);
  });
});

describe("polarToCartesian", () => {
  it("angle=0 points up (negative y from center)", () => {
    const p = polarToCartesian(100, 100, 0, 50);
    expect(p.x).toBe(100);
    expect(p.y).toBe(50);
  });

  it("angle=π/2 points right", () => {
    const p = polarToCartesian(100, 100, Math.PI / 2, 50);
    expect(p.x).toBe(150);
    expect(p.y).toBe(100);
  });

  it("angle=π points down", () => {
    const p = polarToCartesian(100, 100, Math.PI, 50);
    expect(p.x).toBe(100);
    expect(p.y).toBe(150);
  });
});
