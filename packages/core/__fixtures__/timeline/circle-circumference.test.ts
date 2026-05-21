/**
 * Joy of Math PR E3 — end-to-end snapshot test for the canonical
 * timeline fixture.
 *
 * A three-scene story showing why the circumference of a circle is
 * 2πr:
 *
 *   scene 0 (begin 0ms,    dur 2000ms) — draw the unit circle (line layer)
 *   scene 1 (begin 2000ms, dur 1000ms) — fade in the radius annotation
 *   scene 2 (begin 3500ms, dur 1500ms) — fade in the circumference label
 *
 * Each scene wraps its claimed marks in a `<g class="glyph-scene-…">`
 * with a child SMIL `<animate>` driving `opacity` 0 → 1 at the scene
 * beat. Captions emit their own animated `<text>` at the bottom of
 * the plot area.
 *
 * Determinism gate: two renders of the same fixture must produce the
 * exact same byte string. SMIL `begin` / `dur` values are integer
 * milliseconds, opacity is a pure SMIL transition, and the scene
 * ordering follows the spec — no float math, no clocks.
 *
 * Visual gates (sanity, not byte-exact): the snapshot must contain
 *   - one `glyph-scene-draw`, `glyph-scene-radius`, and
 *     `glyph-scene-circumference` group,
 *   - exactly the expected `<animate begin="…ms">` beats,
 *   - the three caption strings, and
 *   - the existing `glyph-arrow` marker (reused by the annotation
 *     layers in scenes 1 and 2).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./circle-circumference.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("timeline examples — circle-circumference (joy PR E3)", () => {
  it("renders the 3-scene circle story deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    // Same input → same output (byte identity).
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);

    // Scene groups (one per spec scene).
    expect(svg).toContain('class="glyph-scene-draw"');
    expect(svg).toContain('class="glyph-scene-radius"');
    expect(svg).toContain('class="glyph-scene-circumference"');

    // SMIL opacity animates at the declared beats.
    expect(svg).toContain('begin="0ms" dur="2000ms"');
    expect(svg).toContain('begin="2000ms" dur="1000ms"');
    expect(svg).toContain('begin="3500ms" dur="1500ms"');

    // Captions emitted (text + their own fade-in animates).
    expect(svg).toContain("First, draw a circle of radius 1");
    expect(svg).toContain("The radius is r");
    expect(svg).toContain("Walk around the edge");

    // Annotations in scenes 1 + 2 still ride the shared arrow marker.
    expect(svg).toContain('id="glyph-arrow"');
    expect(svg).toContain('marker-end="url(#glyph-arrow)"');

    // E3 review NIT-5: caption-vs-axis-title position guard. The
    // x-axis title sits at `plotArea.y + plotArea.height + 32` per
    // svg.ts:357 (titleOffset = 32); captions now sit at +56 so they
    // clear the axis title. Extract every caption text's y attr and
    // assert none collides with the x-axis title's y.
    const captionYs = [...svg.matchAll(/y="(\d+)"[^>]*>(?:First|The radius|Walk around)/g)]
      .map((m) => Number.parseInt(m[1] ?? "0", 10));
    expect(captionYs.length).toBe(3);
    // The default x-axis title y is `plotArea.height + 32` from the
    // plotArea top; for a 400-tall canvas with default insets the
    // axis title sits at y=392. Caption offset is +56 → y=416. The
    // assertion locks the +24 gap so a future refactor that drops
    // captions back to y=392 (the colliding offset) fails this test
    // loudly rather than visually.
    for (const y of captionYs) {
      expect(y).toBeGreaterThanOrEqual(400);
    }

    // Lock the bytes to a file snapshot — any drift surfaces as a diff.
    await expect(svg).toMatchFileSnapshot("./circle-circumference.svg");
  });
});
