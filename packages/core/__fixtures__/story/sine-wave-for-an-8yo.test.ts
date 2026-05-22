/**
 * Joy of Math PR E5 — end-to-end fixture for `glyph_story`.
 *
 * The bar-raiser flow in one test:
 *   1. Call `composeStory({ intent: "show me a sine wave", audience: "kid" })`.
 *   2. Lock the composed spec JSON to a file snapshot — guards against
 *      drift in the recipe registry or the audience-default tables.
 *   3. Compile + render the spec to an SVG via the standard core
 *      pipeline. Lock those bytes too.
 *   4. Re-render and confirm byte-identity (determinism contract).
 *
 * If a downstream change shifts the composed spec OR the rendered SVG,
 * one (or both) of the snapshots flags it loudly. The composer's unit
 * tests cover *what* the spec contains; this fixture is the public
 * contract a teacher / agent / kid can re-render and compare against.
 */
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";
import { composeStory } from "../../src/story/compose.js";

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

/**
 * Anchor rows pinning the linear scale extents. `data.shape: "function"`
 * specs synthesize their own rows from `expr` + `parameter`, but the
 * compiler still needs a bounding box for the scale resolver — same
 * pattern the streamline / bezier fixtures use.
 */
function buildDomainAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [-Math.PI * 2, -1.2],
    [Math.PI * 2, 1.2],
  ];
}

describe("joy of math — composed sine story for an 8-year-old (PR E5)", () => {
  it("composes a kid-targeted sine spec and renders deterministically", async () => {
    const { spec } = composeStory({
      intent: "show me a sine wave",
      audience: "kid",
      // Pin theme + duration explicitly so the snapshot doesn't move
      // when the audience defaults table grows. The audience default
      // for "kid" *is* "playground" / 8000ms today, but locking the
      // call site makes that visible.
      theme: "playground",
      duration_ms: 8000,
    });

    // Lock the composed JSON spec. Drift here means either the recipe
    // changed (intentional → update snapshot) or the audience defaults
    // shifted unintentionally (unintentional → fix the regression).
    await expect(`${JSON.stringify(spec, null, 2)}\n`).toMatchFileSnapshot(
      "./sine-wave-for-an-8yo.json",
    );

    // Parse the composed spec through the public schema — guards
    // against the composer emitting fields the static parser would
    // reject (a previous review nit on a related verb caught exactly
    // this kind of drift).
    const parsed = parseSpec(JSON.parse(JSON.stringify(spec)));

    const rows = buildDomainAnchorRows();
    const svg = renderSvg(compileSpec({ spec: parsed, rows, schema }));
    // Determinism — same compose + same compile + same render = same
    // bytes. Mirrors the contract every other Joy-of-Math fixture
    // upholds (E2 traveler, E3 timeline, E4 brand presets).
    const svg2 = renderSvg(compileSpec({ spec: parsed, rows, schema }));
    expect(svg2).toBe(svg);
    await expect(svg).toMatchFileSnapshot("./sine-wave-for-an-8yo.svg");
  });
});
