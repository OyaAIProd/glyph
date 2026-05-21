/**
 * Math Phase 2 Track A PR A1 — orthogonality validation. A damped
 * pendulum trajectory composed with `animation.kind: "scrub"` keyed
 * on `t`. This is the go/no-go signal for the trajectory shape's
 * composition story: if the test passes, trajectory data flows
 * through scrub / race animations without any compiler changes
 * (mirrors the Lissajous + scrub validation Math PR2 did for the
 * parametric form).
 *
 * The fixture integrates the pendulum
 *
 *     dx/dt = y                  (x = angle)
 *     dy/dt = -sin(x) - 0.05*y   (y = angular velocity, light friction)
 *
 * for `t ∈ [0, 20]` in 120 steps with `animation.kind: "scrub"` keyed
 * on `t`. The existing animation compiler does a
 * `schema.findIndex(c => c.name === frame_field)`; PR A1 puts `t`
 * first in the materialized schema, so the lookup finds it and the
 * scrub frames materialize without compiler edits.
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

const fixtureUrl = new URL("./animated-pendulum.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — animated trajectory pendulum (Phase 2 Track A PR A1)", () => {
  it("renders a scrub-animated pendulum trajectory deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const scene = compileSpec({ spec, rows: [], schema: [] });
    // Sanity: the scrub animation actually attached to the scene
    // (i.e. the trajectory → animation handoff happened with zero
    // compiler changes — the orthogonality go/no-go signal).
    expect(scene.animation?.kind).toBe("scrub");
    if (scene.animation?.kind === "scrub") {
      expect(scene.animation.frame_field).toBe("t");
      expect(scene.animation.frames.length).toBeGreaterThan(2);
    }
    const svg = renderSvg(scene);
    // Byte-identity across two compiles.
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    await expect(svg).toMatchFileSnapshot("./animated-pendulum.svg");
  });

  it("emits per-frame variation across the pendulum's swing", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const scene = compileSpec({ spec, rows: [], schema: [] });
    const frames = renderFrames(scene);
    expect(frames.length).toBeGreaterThan(2);
    // First and last frame should differ — the pendulum has swung.
    expect(frames[0]).not.toBe(frames[frames.length - 1]);
  });
});
