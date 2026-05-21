/**
 * Moat PR3 — skip-default fixture: bar chart with 3 of 10 rows null y,
 * `onMissing` unset (so the default skip policy applies). Locks the SVG
 * bytes; the AUDIT-10 emission is exercised separately in
 * `audit.audit-10.test.ts`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";
import type { ColumnInfo } from "../../src/compute/engine.js";

const fixtureUrl = new URL("./skip-default.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: ColumnInfo[] = [
  { name: "day", type: "VARCHAR", nullable: false },
  { name: "sales", type: "DOUBLE", nullable: true },
];

// 10 rows; days "01"..."10"; 3 rows (03, 06, 09) carry null y.
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

describe("moat PR3 — skip-default fixture", () => {
  it("renders bar chart with missing rows silently dropped (default policy)", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const scene = compileSpec({ spec, rows, schema });
    // 7 valid rows → 7 rect bars; nothing emitted for the 3 null rows.
    const rects = scene.marks.filter((m) => m.type === "rect");
    expect(rects.length).toBe(7);
    // None of the rects should carry a dashed stroke (skip policy emits
    // no callout markers).
    expect(rects.every((r) => r.strokeDasharray === undefined)).toBe(true);
    // Determinism check.
    const svg = renderSvg(scene);
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    await expect(svg).toMatchFileSnapshot("./skip-default.svg");
  });
});
