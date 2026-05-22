/**
 * Tests for the `line` mark (PR19).
 *
 * Covers single-line and multi-line (color-grouped), linear + band x scales,
 * point sorting, and the SVG path-d output shape.
 */
import { describe, expect, it } from "vitest";
import type { GlyphSpec } from "../spec/types.js";
import { type CompileFieldInfo, compileSpec } from "./compile.js";

const schema: CompileFieldInfo[] = [
  { name: "hour", type: "INTEGER" },
  { name: "rides", type: "INTEGER" },
];

const rows: number[][] = [
  [0, 10],
  [1, 30],
  [2, 20],
];

describe("compileSpec — line mark (PR19)", () => {
  it("emits a single path mark with one M + (N-1) L commands", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "line", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const paths = scene.marks.filter((m) => m.type === "path");
    expect(paths).toHaveLength(1);
    const d = paths[0]?.d ?? "";
    expect(d.startsWith("M ")).toBe(true);
    const lCount = (d.match(/ L /g) ?? []).length;
    expect(lCount).toBe(rows.length - 1);
  });

  it("uses linear x scale for quantitative x (no band gaps)", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "line", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    // Bottom axis should have linear ticks rather than category ticks.
    const bottom = scene.axes.find((a) => a.orientation === "bottom");
    expect(bottom?.ticks.length).toBeGreaterThan(0);
    expect(bottom?.label).toBe("hour");
  });

  it("sorts points by x ascending even if the source rows are unordered", () => {
    const unordered: number[][] = [
      [2, 20],
      [0, 10],
      [1, 30],
    ];
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "line", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows: unordered, schema });
    const d = scene.marks.find((m) => m.type === "path")?.d ?? "";
    // First point should correspond to hour=0 — its x px should be the smallest.
    const tokens = d.split(/\s+/);
    const x0 = Number(tokens[1]);
    const x1 = Number(tokens[4]);
    const x2 = Number(tokens[7]);
    expect(x0).toBeLessThan(x1);
    expect(x1).toBeLessThan(x2);
  });

  it("emits one path per color group when color encoding is set", () => {
    const cs: CompileFieldInfo[] = [...schema, { name: "weekday", type: "VARCHAR" }];
    const cr: Array<Array<number | string>> = [
      [0, 10, "mon"],
      [1, 30, "mon"],
      [2, 20, "mon"],
      [0, 5, "tue"],
      [1, 15, "tue"],
      [2, 25, "tue"],
    ];
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        {
          mark: "line",
          encoding: { x: "hour", y: "rides", color: "weekday" },
        },
      ],
    };
    const scene = compileSpec({ spec, rows: cr, schema: cs });
    const paths = scene.marks.filter((m) => m.type === "path");
    expect(paths).toHaveLength(2);
    // Distinct strokes from the palette.
    expect(paths[0]?.stroke).not.toBe(paths[1]?.stroke);
  });

  it("drops groups with < 2 points (a single dot is not a line)", () => {
    const sparse: number[][] = [[0, 10]];
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "line", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows: sparse, schema });
    expect(scene.marks.filter((m) => m.type === "path")).toHaveLength(0);
  });

  it("composes with a bar layer (line on top of bars, single y scale)", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        { mark: "bar", encoding: { x: "hour", y: "rides" } },
        { mark: "line", encoding: { x: "hour", y: "rides" } },
      ],
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.marks.filter((m) => m.type === "rect")).toHaveLength(3);
    expect(scene.marks.filter((m) => m.type === "path")).toHaveLength(1);
  });

  it("determinism: identical input → identical scene", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "line", encoding: { x: "hour", y: "rides" } }],
    };
    const a = compileSpec({ spec, rows, schema });
    const b = compileSpec({ spec, rows, schema });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  // Math PR5 — parametric data preserves insertion order (no x-sort).
  // These two tests isolate the sort behavior so a regression in the
  // sentinel detection surfaces as a focused failure instead of a
  // 14KB SVG snapshot diff. The first locks the default (sort) path;
  // the second locks the parametric (preserve-order) path.
  describe("Math PR5 — preserveOrder for parametric data", () => {
    // Three points whose insertion order (x = 3, 1, 2) zigzags but
    // whose x-sort produces a monotone left-to-right line.
    const unsortedRows: number[][] = [
      [3, 30],
      [1, 10],
      [2, 20],
    ];

    it("scalar data sorts by x (default behavior, unchanged)", () => {
      const spec: GlyphSpec = {
        data: { source: "x" },
        layers: [{ mark: "line", encoding: { x: "hour", y: "rides" } }],
      };
      const scene = compileSpec({ spec, rows: unsortedRows, schema });
      const d = (scene.marks.find((m) => m.type === "path")?.d ?? "") as string;
      // After sort the path starts at x = 1 (smallest), not x = 3
      // (insertion order). Extract the first M coordinate.
      const firstM = d.match(/^M (\d+(?:\.\d+)?) /)?.[1];
      expect(firstM).toBeDefined();
      // The plot-area scaling maps x=1 to the smallest pixel x and
      // x=3 to the largest; assert ascending order across all three
      // L-segments so we don't tie the test to plot-area constants.
      const xs = [...d.matchAll(/[ML] (\d+(?:\.\d+)?) /g)].map((m) =>
        Number.parseFloat(m[1] ?? "0"),
      );
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
    });

    it("parametric data preserves insertion order", () => {
      // The compiler treats source === "<inline:function-parametric>"
      // as the signal that materializeFunctionInput ran on parametric
      // data. We construct the spec with that sentinel directly to
      // bypass the sampler — the test isolates the sort logic only.
      const spec: GlyphSpec = {
        data: { source: "<inline:function-parametric>" },
        layers: [{ mark: "line", encoding: { x: "hour", y: "rides" } }],
      };
      const scene = compileSpec({ spec, rows: unsortedRows, schema });
      const d = (scene.marks.find((m) => m.type === "path")?.d ?? "") as string;
      const xs = [...d.matchAll(/[ML] (\d+(?:\.\d+)?) /g)].map((m) =>
        Number.parseFloat(m[1] ?? "0"),
      );
      // Insertion order is (3, 1, 2). After plot-area scaling that's
      // (largest, smallest, middle) in pixels. Crucially NOT sorted.
      expect(xs).toHaveLength(3);
      // Destructure via a 3-tuple assertion so biome's
      // noNonNullAssertion rule doesn't trip on the comparisons below.
      // The toHaveLength(3) check above proves all three slots exist.
      const [first, second, third] = xs as [number, number, number];
      expect(first).toBeGreaterThan(second);
      expect(third).toBeGreaterThan(second);
      expect(third).toBeLessThan(first);
    });

    it("the area mark mirrors the same parametric carve-out", () => {
      // Same shape as the line test above but with mark: "area".
      // The area path closes down to baseline, but the data segment
      // (the M + L parts before the baseline close) must respect
      // insertion order for parametric data.
      const spec: GlyphSpec = {
        data: { source: "<inline:function-parametric>" },
        layers: [{ mark: "area", encoding: { x: "hour", y: "rides" } }],
      };
      const scene = compileSpec({ spec, rows: unsortedRows, schema });
      const d = (scene.marks.find((m) => m.type === "path")?.d ?? "") as string;
      // Take the M + first 2 L segments (the data portion); the
      // remaining L segments are the baseline close.
      const xs = [...d.matchAll(/[ML] (\d+(?:\.\d+)?) /g)]
        .map((m) => Number.parseFloat(m[1] ?? "0"))
        .slice(0, 3);
      expect(xs).toHaveLength(3);
      // Same 3-tuple assertion as the line variant above — the
      // toHaveLength check is the guard biome needs.
      const [first, second, third] = xs as [number, number, number];
      expect(first).toBeGreaterThan(second);
      expect(third).toBeGreaterThan(second);
      expect(third).toBeLessThan(first);
    });
  });
});
