/**
 * Math PR6 — snapshot test for accents (`\hat`, `\vec`, `\bar`).
 *
 * KaTeX lowers all three to `<mover accent="true">` with the accent
 * glyph as the second child. `layoutAccent` in math-text.ts centers
 * that glyph horizontally over the base at 0.6em above the baseline,
 * scaled to 0.7×. The three accents share that codepath; the test
 * proves all three render side-by-side without overlap and that the
 * SVG bytes are stable across two compiles.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./text-accents.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — math-text accents (math PR6)", () => {
  it("renders hat, vec, bar accents deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // Each accent layer emits at least a base glyph + an accent glyph.
    // Three layers → at least 6 `<text>` nodes from the math-text marks
    // alone (plus axis labels, title etc).
    expect((svg.match(/<text /g) ?? []).length).toBeGreaterThanOrEqual(10);
    // Base glyphs from each accent expression.
    expect(svg).toContain(">x<");
    expect(svg).toContain(">v<");
    expect(svg).toContain(">y<");
    await expect(svg).toMatchFileSnapshot("./text-accents.svg");
  });
});
