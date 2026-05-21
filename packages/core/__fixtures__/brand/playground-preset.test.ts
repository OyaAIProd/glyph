/**
 * Joy of Math E4 — end-to-end snapshot test for the "playground"
 * preset. Parses `playground-preset.json` against the real spec
 * schema, compiles, renders, and locks the SVG bytes.
 *
 * Also asserts the rendered background matches the preset's
 * `palette.surface.bg` — the headline trick for the preset is that
 * `theme: "playground"` alone (no `brand:` block) routes through
 * the BrandKit pipeline and carries the cream surface through.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";
import { PLAYGROUND_BRAND } from "../../src/themes/playground.js";

const fixtureUrl = new URL("./playground-preset.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("brand examples — playground preset (Joy of Math E4)", () => {
  it("renders the playground preset deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    // Determinism: same input → byte-identical output.
    expect(svg2).toBe(svg);
    // Surface check: the preset's cream background MUST appear in the
    // rendered SVG. If the string-preset routing breaks, the chart
    // would fall back to LIGHT_THEME (#ffffff) and this assertion
    // would catch it before a snapshot diff.
    expect(svg).toContain(PLAYGROUND_BRAND.palette.surface.bg);
    await expect(svg).toMatchFileSnapshot("./playground-preset.svg");
  });
});
