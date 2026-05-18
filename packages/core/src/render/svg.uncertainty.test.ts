/**
 * Tests for the uncertainty-rendering pass (PR61 / PLAN item 2.3).
 *
 * Asserts:
 *   - byte-identity when scene.uncertainty is absent (no regressions)
 *   - hatched overlay + badge when hatchBars fires
 *   - dim-points style block when dimPoints fires
 *   - compiler-derived uncertainty from provenance round-trips
 *   - opt-out via spec.interactive.uncertainty=false works
 */
import { describe, expect, it } from "vitest";
import { compileSpec } from "../compiler/compile.js";
import type { Scene } from "../scenegraph/types.js";
import type { GlyphSpec } from "../spec/types.js";
import { renderSvg } from "./svg.js";

const base: Scene = {
  width: 200,
  height: 120,
  background: "#fff",
  plotArea: { x: 10, y: 10, width: 150, height: 100 },
  axes: [],
  marks: [
    { type: "rect", x: 20, y: 30, width: 30, height: 50, fill: "#1f77b4" },
    { type: "circle", cx: 100, cy: 60, r: 4, fill: "#1f77b4" },
  ],
};

describe("renderSvg — uncertainty (PR61)", () => {
  it("emits no overlay or style when scene.uncertainty is unset", () => {
    const out = renderSvg(base);
    expect(out).not.toContain("glyph-hatch");
    expect(out).not.toContain("glyph-uncertainty-badge");
    expect(out).not.toContain("glyph-uncertain");
  });

  it("emits hatch defs + overlay rect + badge when hatchBars fires", () => {
    const out = renderSvg({
      ...base,
      uncertainty: {
        confidence: "low",
        sampleRows: 8,
        hatchBars: true,
        dimPoints: true,
      },
    });
    expect(out).toContain('<pattern id="glyph-hatch"');
    expect(out).toContain('fill="url(#glyph-hatch)"');
    expect(out).toContain("glyph-uncertainty-badge");
    // Badge text formats as "n=8 · confidence: low" — assert the count and tier.
    expect(out).toContain("n=8");
    expect(out).toContain("confidence: low");
    // dimPoints triggers a class + style block.
    expect(out).toContain("glyph-uncertain");
    expect(out).toContain("g.glyph-marks.glyph-uncertain circle{opacity:0.55}");
  });

  it("respects an explicit note override on the badge", () => {
    const out = renderSvg({
      ...base,
      uncertainty: {
        confidence: "medium",
        sampleRows: 25,
        hatchBars: false,
        dimPoints: false,
        note: "preview · n=25",
      },
    });
    expect(out).toContain("preview · n=25");
    // No hatch when hatchBars=false.
    expect(out).not.toContain('<pattern id="glyph-hatch"');
  });

  it("compileSpec emits uncertainty when provenance.confidence != 'high'", () => {
    const spec: GlyphSpec = {
      data: { source: "fixture.csv" },
      layers: [
        {
          mark: "bar",
          encoding: { x: "x", y: "y" },
        },
      ],
    };
    const scene = compileSpec({
      spec,
      rows: [
        ["a", 1],
        ["b", 2],
      ],
      schema: [
        { name: "x", type: "VARCHAR" },
        { name: "y", type: "INTEGER" },
      ],
      provenance: {
        freshness: "2024-01-01T00:00:00Z",
        sampleRows: 12,
        filteredOut: 0,
        confidence: "low",
      },
    });
    expect(scene.uncertainty).toBeDefined();
    expect(scene.uncertainty?.confidence).toBe("low");
    expect(scene.uncertainty?.hatchBars).toBe(true);
    expect(scene.uncertainty?.dimPoints).toBe(true);
    expect(scene.uncertainty?.sampleRows).toBe(12);
  });

  it("compileSpec emits no uncertainty when provenance is 'high' + ample rows", () => {
    const spec: GlyphSpec = {
      data: { source: "fixture.csv" },
      layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
    };
    const scene = compileSpec({
      spec,
      rows: [
        ["a", 1],
        ["b", 2],
      ],
      schema: [
        { name: "x", type: "VARCHAR" },
        { name: "y", type: "INTEGER" },
      ],
      provenance: {
        freshness: "2024-01-01T00:00:00Z",
        sampleRows: 10000,
        filteredOut: 0,
        confidence: "high",
      },
    });
    expect(scene.uncertainty).toBeUndefined();
  });

  it("respects spec.interactive.uncertainty=false as an opt-out", () => {
    const spec: GlyphSpec = {
      data: { source: "fixture.csv" },
      layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
      interactive: { uncertainty: false },
    };
    const scene = compileSpec({
      spec,
      rows: [["a", 1]],
      schema: [
        { name: "x", type: "VARCHAR" },
        { name: "y", type: "INTEGER" },
      ],
      provenance: {
        freshness: "2024-01-01T00:00:00Z",
        sampleRows: 1,
        filteredOut: 0,
        confidence: "low",
      },
    });
    expect(scene.uncertainty).toBeUndefined();
  });

  it("compileSpec emits uncertainty for low-sample even at 'high' confidence", () => {
    const spec: GlyphSpec = {
      data: { source: "fixture.csv" },
      layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
    };
    const scene = compileSpec({
      spec,
      rows: [["a", 1]],
      schema: [
        { name: "x", type: "VARCHAR" },
        { name: "y", type: "INTEGER" },
      ],
      provenance: {
        freshness: "2024-01-01T00:00:00Z",
        sampleRows: 5,
        filteredOut: 0,
        confidence: "high",
      },
    });
    expect(scene.uncertainty).toBeDefined();
    expect(scene.uncertainty?.hatchBars).toBe(true);
  });
});
