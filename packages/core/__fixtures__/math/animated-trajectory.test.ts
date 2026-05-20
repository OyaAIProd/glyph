/**
 * Math PR2 — validation snapshot for parametric data composed with the
 * existing `animation.kind: "scrub"` machinery. This is the load-
 * bearing test for the math-extension thesis: if it passes, parametric
 * data flows through scrub/race animations without any compiler
 * changes, and PR3-6 can ship confidently.
 *
 * The fixture traces a unit circle in 60 steps via `(cos t, sin t)`
 * with `animation.kind: "scrub"` keyed on `t`. The compiler's scrub
 * path looks up `frame_field` in the schema; PR2 adds `t` to that
 * schema (via materializeFunctionInput), so the existing animation
 * compiler finds it and emits frames.
 *
 * The snapshot is locked to file like every other math snapshot. The
 * per-frame check (via renderFrames) asserts the first and last
 * frames differ — a regression that collapsed scrub into a static
 * SVG would surface here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderFrames, renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./animated-trajectory.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — animated parametric trajectory (math PR2)", () => {
  it("renders a scrub-animated unit circle deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const scene = compileSpec({ spec, rows: [], schema: [] });
    // Sanity: the scrub animation actually attached to the scene (i.e.
    // the parametric → animation handoff happened with no compiler
    // changes — the math-thesis go/no-go signal).
    expect(scene.animation?.kind).toBe("scrub");
    if (scene.animation?.kind === "scrub") {
      expect(scene.animation.frame_field).toBe("t");
      expect(scene.animation.frames.length).toBeGreaterThan(2);
    }
    const svg = renderSvg(scene);
    // Byte-identity across two compiles.
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    await expect(svg).toMatchFileSnapshot("./animated-trajectory.svg");
  });

  it("emits per-frame variation across the trajectory", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const scene = compileSpec({ spec, rows: [], schema: [] });
    const frames = renderFrames(scene);
    expect(frames.length).toBeGreaterThan(2);
    // First and last frame should differ — the curve has moved.
    expect(frames[0]).not.toBe(frames[frames.length - 1]);
  });
});
