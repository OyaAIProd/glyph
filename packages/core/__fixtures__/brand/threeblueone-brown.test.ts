/**
 * Joy of Math E4 — end-to-end snapshot test for the "3b1b" preset.
 * Parses `threeblueone-brown.json` against the real spec schema,
 * compiles, renders, and locks the SVG bytes.
 *
 * Mirrors the playground-preset test — asserts that
 * `theme: "3b1b"` alone (no `brand:` block) carries the chalkboard
 * background through the BrandKit pipeline into the rendered SVG.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";
import { THREEBLUEONE_BROWN_BRAND } from "../../src/themes/threeblueone-brown.js";

const fixtureUrl = new URL("./threeblueone-brown.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("brand examples — 3b1b preset (Joy of Math E4)", () => {
  it("renders the 3b1b preset deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    // Determinism: same input → byte-identical output.
    expect(svg2).toBe(svg);
    // Surface check: the preset's chalkboard background MUST appear
    // in the rendered SVG. If the string-preset routing breaks, the
    // chart would fall back to LIGHT_THEME (#ffffff) and this
    // assertion would catch it before a snapshot diff.
    expect(svg).toContain(THREEBLUEONE_BROWN_BRAND.palette.surface.bg);
    await expect(svg).toMatchFileSnapshot("./threeblueone-brown.svg");
  });
});
