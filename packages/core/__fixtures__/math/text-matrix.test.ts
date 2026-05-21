/**
 * Math PR6 — snapshot test for a 2×2 matrix annotation.
 *
 * `\begin{pmatrix} a & b \\\\ c & d \end{pmatrix}` lowers to
 * `<mrow><mo>(</mo><mtable>…</mtable><mo>)</mo></mrow>` in MathML.
 * math-text parses the rows/cells and lays out a column-aligned grid;
 * the fence brackets `(` and `)` are normal glyphs from the existing
 * palette (they do NOT stretch to match the matrix height — see the
 * Known Limitations block at the top of math-text.ts).
 *
 * The test guards two invariants: (a) byte identity across two compiles
 * (no nondeterminism in cell ordering, column-width computation, or
 * row-height aggregation), and (b) the snapshot file matches exactly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./text-matrix.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — math-text matrix (math PR6)", () => {
  it("renders a 2x2 pmatrix deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // Four cell glyphs + the surrounding parens.
    expect(svg).toContain(">a<");
    expect(svg).toContain(">b<");
    expect(svg).toContain(">c<");
    expect(svg).toContain(">d<");
    expect(svg).toContain(">(<");
    expect(svg).toContain(">)<");
    await expect(svg).toMatchFileSnapshot("./text-matrix.svg");
  });
});
