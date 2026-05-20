/**
 * Math PR2 — end-to-end snapshot test for the canonical Lissajous
 * fixture (3:2 ratio). Parses `lissajous.json` against the real spec
 * schema, compiles, renders, and locks the SVG bytes to a file
 * snapshot.
 *
 * The 3:2 Lissajous traces a recognizable "pretzel"-shaped curve in
 * the plane — three lobes on the x-axis paired with two on the y. If
 * the snapshot ever renders as a line, a circle, or anything obviously
 * collapsed, the parametric sampler is wrong (the eyeball check).
 *
 * Determinism gate: two renders of the same fixture must produce the
 * exact same byte string. The parametric sampler inherits PR1's
 * endpoint anchoring + deterministic evaluator so platform drift
 * across CI runners is impossible.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./lissajous.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — Lissajous curve (math PR2)", () => {
  it("renders the 3:2 Lissajous curve deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    // Same input → same output (byte identity).
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // Lock the bytes to a file snapshot — any drift surfaces as a diff.
    await expect(svg).toMatchFileSnapshot("./lissajous.svg");
  });
});
