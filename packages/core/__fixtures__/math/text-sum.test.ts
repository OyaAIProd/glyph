/**
 * Math PR6 — snapshot test for the stacked-limits big-operator
 * `\sum_{i=1}^{n} i^2`.
 *
 * Even though KaTeX emits `<msubsup>` (not `<munderover>`) for this
 * expression in inline mode, math-text detects the big-operator base
 * (`∑`) and routes through `layoutLimits` to stack the sub below and
 * sup above — visually matching `\displaystyle` rendering. The test
 * locks that behaviour byte-for-byte; if the big-op detection set or
 * the layout constants drift, the snapshot diff surfaces it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./text-sum.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — math-text stacked sum (math PR6)", () => {
  it("renders \\sum_{i=1}^{n} i^2 with stacked limits and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // The sum sigma glyph.
    expect(svg).toContain("∑");
    // Lower limit `i=1` + upper limit `n` + trailing `i^2`.
    expect(svg).toContain(">i<");
    expect(svg).toContain(">n<");
    expect(svg).toContain(">1<");
    await expect(svg).toMatchFileSnapshot("./text-sum.svg");
  });
});
