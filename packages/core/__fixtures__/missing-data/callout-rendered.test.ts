/**
 * Moat PR3 — callout-rendered fixture: same data as `skip-default` but
 * with `onMissing: "callout"`. Each missing-y row emits a small dashed
 * rect on the baseline with a `<title>` tooltip. Locks the SVG bytes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import type { ColumnInfo } from "../../src/compute/engine.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./callout-rendered.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: ColumnInfo[] = [
  { name: "day", type: "VARCHAR", nullable: false },
  { name: "sales", type: "DOUBLE", nullable: true },
];

const rows: Array<Array<string | number | null>> = [
  ["01", 12],
  ["02", 24],
  ["03", null],
  ["04", 40],
  ["05", 55],
  ["06", null],
  ["07", 72],
  ["08", 80],
  ["09", null],
  ["10", 90],
];

describe("moat PR3 — callout-rendered fixture", () => {
  it("emits dashed-rect callout markers for the 3 missing rows", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const scene = compileSpec({ spec, rows, schema });
    // 7 solid bars + 3 dashed callout rects = 10 total rect marks.
    const rects = scene.marks.filter((m) => m.type === "rect");
    expect(rects.length).toBe(10);
    const dashed = rects.filter((r) => r.strokeDasharray !== undefined);
    expect(dashed.length).toBe(3);
    // Each callout rect carries a "Missing value at x=<day>" tooltip.
    for (const d of dashed) {
      expect(d.tooltip).toMatch(/^Missing value at x=/);
    }
    // Determinism + byte snapshot.
    const svg = renderSvg(scene);
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    expect(svg).toContain("stroke-dasharray=");
    expect(svg).toContain("<title>Missing value at x=03</title>");
    await expect(svg).toMatchFileSnapshot("./callout-rendered.svg");
  });
});
