/**
 * Moat 5/5 — declarative crossfilter, two-chart linkage proof.
 *
 * The "shared crossfilter group" contract: two charts that declare
 * the same `interactive.crossfilter.group` produce SVGs whose marks
 * carry matching `data-crossfilter-group` + `data-crossfilter-key`
 * attributes. A `@glyph/live` host listens at the shared group bus
 * and re-emits hover events from one chart into the other.
 *
 * This fixture proves the contract by compiling two INDEPENDENT
 * specs that both declare `crossfilter.group: "linked"` and asserts
 * the property holds across them.
 *
 * Limitation documented for v0:
 *   The `facet` primitive splits one spec into N side-by-side panels
 *   but the top-level faceted scene currently drops the per-panel
 *   `schema` (and therefore the root-level `data-crossfilter-group`
 *   attribute), so within a single faceted SVG only the per-mark
 *   data-attrs land. The cross-chart linkage demo is therefore
 *   modeled here as two top-level specs — the shape an MCP agent
 *   produces when emitting "small multiples that talk."
 */
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const schema: CompileFieldInfo[] = [
  { name: "hour", type: "INTEGER" },
  { name: "rides", type: "INTEGER" },
];

const ridesA: number[][] = [
  [0, 10],
  [1, 20],
  [2, 30],
];
const ridesB: number[][] = [
  [0, 8],
  [1, 18],
  [2, 28],
];

describe("crossfilter — two-chart linkage (moat 5/5)", () => {
  it("two specs sharing a group emit matching data-crossfilter-group + key", async () => {
    const specA = parseSpec({
      version: "glyph/0.1",
      title: "Rides — chart A",
      data: { source: "ridesA" },
      layers: [
        {
          mark: "bar",
          encoding: {
            x: { field: "hour", type: "quantitative" },
            y: { field: "rides", type: "quantitative", scale: { domain: [0, 30] } },
          },
        },
      ],
      interactive: { crossfilter: { group: "linked", key: "hour", mode: "both" } },
    });
    const specB = parseSpec({
      version: "glyph/0.1",
      title: "Rides — chart B",
      data: { source: "ridesB" },
      layers: [
        {
          mark: "bar",
          encoding: {
            x: { field: "hour", type: "quantitative" },
            y: { field: "rides", type: "quantitative", scale: { domain: [0, 30] } },
          },
        },
      ],
      interactive: { crossfilter: { group: "linked", key: "hour", mode: "both" } },
    });

    const svgA = renderSvg(compileSpec({ spec: specA, rows: ridesA, schema }));
    const svgB = renderSvg(compileSpec({ spec: specB, rows: ridesB, schema }));

    // Determinism gate.
    const svgA2 = renderSvg(compileSpec({ spec: specA, rows: ridesA, schema }));
    expect(svgA2).toBe(svgA);

    // Both charts carry the same group at the root.
    expect(svgA).toContain('data-crossfilter-group="linked"');
    expect(svgB).toContain('data-crossfilter-group="linked"');

    // Both charts emit per-mark crossfilter-keys for the shared
    // hour-dimension. Hours 0,1,2 are common to both → a hover on
    // hour=1 in chart A can highlight hour=1 in chart B.
    for (const h of ["0", "1", "2"]) {
      expect(svgA).toContain(`data-crossfilter-key="${h}"`);
      expect(svgB).toContain(`data-crossfilter-key="${h}"`);
    }

    // The same-chart hover CSS is emitted exactly once per chart.
    expect(svgA.match(/--crossfilter-highlight/g)?.length).toBe(1);
    expect(svgB.match(/--crossfilter-highlight/g)?.length).toBe(1);

    // Concatenated, the page-level "two charts that talk" artifact
    // contains the group twice (once per SVG root) plus each chart's
    // own per-mark instances. We lock the byte snapshot of the
    // concatenation so any drift in either chart surfaces.
    const combined = `${svgA}\n${svgB}`;
    await expect(combined).toMatchFileSnapshot("./two-charts-linked.svg");
  });

  it("known limitation: spec.facet does NOT lift crossfilter-group to the SVG root", () => {
    // Documents the v0 limitation. The faceted compile path drops
    // the per-panel scene.schema (it returns the synthesized
    // top-level scene with `schema: undefined`), so the root-level
    // `data-crossfilter-group` attr is not emitted. Per-mark
    // data-attrs DO land via each panel's sub-compile, but the
    // root attr is needed for `@glyph/live` to find the group bus.
    // Tracking item: lift schema (incl. crossfilterGroup) onto the
    // top-level faceted scene.
    const spec = parseSpec({
      version: "glyph/0.1",
      data: { source: "rides" },
      layers: [
        {
          mark: "bar",
          encoding: {
            x: { field: "hour", type: "quantitative" },
            y: { field: "rides", type: "quantitative", scale: { domain: [0, 30] } },
          },
        },
      ],
      facet: { col: "weekday" },
      interactive: { crossfilter: { group: "linked", mode: "hover" } },
    });
    const facetSchema: CompileFieldInfo[] = [
      { name: "hour", type: "INTEGER" },
      { name: "rides", type: "INTEGER" },
      { name: "weekday", type: "VARCHAR" },
    ];
    const facetRows: Array<Array<number | string>> = [
      [0, 10, "mon"],
      [1, 20, "mon"],
      [0, 5, "tue"],
      [1, 15, "tue"],
    ];
    const scene = compileSpec({ spec, rows: facetRows, schema: facetSchema });
    // Limitation: faceted scenes drop the root schema.
    expect(scene.schema).toBeUndefined();
    expect(scene.panels?.length).toBe(2);
  });
});
