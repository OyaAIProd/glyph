/**
 * Moat 5/5 — declarative crossfilter, single-chart fixture.
 *
 * The spec is a 7-sample bar chart with
 *   `interactive: { crossfilter: { group: "demo", mode: "hover" } }`.
 * No `key` is set, so the renderer derives the crossfilter key from
 * `encoding.x` (no color encoding in this spec).
 *
 * Locked behaviours:
 *   1. SVG root carries `data-crossfilter-group="demo"`.
 *   2. Every bar carries `data-crossfilter-group="demo"` AND
 *      `data-crossfilter-key="<x-value>"`.
 *   3. The inline `<style>` block (`CROSSFILTER_STYLE`) is emitted
 *      exactly once.
 *   4. Two renders of the same input produce byte-identical SVG.
 *
 * Byte snapshot lives next to this file as `single-chart-hover.svg`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./single-chart-hover.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("crossfilter — single-chart hover (moat 5/5)", () => {
  it("emits data-crossfilter-* attrs + inline style + stays byte-stable", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    // Determinism gate.
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);

    // Root-level group id is on the SVG element.
    expect(svg).toContain('data-crossfilter-group="demo"');
    // Each mark carries the per-row crossfilter-key. We don't lock a
    // specific x value here (the function sampler controls that) — we
    // just assert that at least one mark exposes the attribute.
    expect(svg).toContain("data-crossfilter-key=");
    // The same-chart hover CSS rule is emitted exactly once.
    expect(svg).toContain(":has([data-crossfilter-key]:hover)");
    expect(svg.match(/--crossfilter-highlight/g)?.length).toBe(1);

    // Lock the bytes to a file snapshot — any drift surfaces as a diff.
    await expect(svg).toMatchFileSnapshot("./single-chart-hover.svg");
  });

  it("does not emit crossfilter attrs when interactive.crossfilter is unset", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    // Strip the crossfilter block. The compiler should now skip every
    // crossfilter-* emission and the inline style.
    const stripped = {
      ...spec,
      interactive: { ...spec.interactive, crossfilter: undefined },
    };
    const svg = renderSvg(compileSpec({ spec: stripped, rows: [], schema: [] }));
    expect(svg).not.toContain("data-crossfilter-group");
    expect(svg).not.toContain("data-crossfilter-key");
    expect(svg).not.toContain("--crossfilter-highlight");
  });
});
