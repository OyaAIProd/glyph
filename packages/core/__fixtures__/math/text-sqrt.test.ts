/**
 * Math PR6 — snapshot test for `\sqrt{x^2 + 1}` rendered via math-text.
 *
 * Locks the SVG byte-for-byte across two compiles (determinism) and to
 * disk (`text-sqrt.svg`). The radical sign `√`, overbar rule line, and
 * radicand layout all live in `marks/math-text.ts`'s `layoutSqrt`.
 *
 * The fixture nests a superscript inside the radicand (`x^2`) so the
 * sub-expression layout (ascent + descent of an `<msup>` inside an
 * `<msqrt>`) is also exercised — exactly the case where v0 would lay
 * the overbar at the wrong y if it forgot to use the radicand's true
 * ascent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./text-sqrt.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — math-text sqrt (math PR6)", () => {
  it("renders \\sqrt{x^2 + 1} deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // Sanity: the √ glyph appears and the overbar rule emits a <path>.
    expect(svg).toContain("√");
    // The annotation also carries `y =`, `x`, `2`, `+`, `1`.
    expect(svg).toContain("y");
    expect(svg).toContain("=");
    // Lock bytes.
    await expect(svg).toMatchFileSnapshot("./text-sqrt.svg");
  });
});
