/**
 * Moat PR4 — `bad-contrast.json` is a brand kit with deliberately
 * unreadable grey-on-grey surfaces. The fixture renders without
 * throwing (the auditor is advisory, not gating), but AUDIT-11 MUST
 * fire and name the failing color pair.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditSpec } from "../../src/audit/index.js";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./bad-contrast.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("brand examples — bad-contrast (moat PR4)", () => {
  it("renders the failing brand deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    await expect(svg).toMatchFileSnapshot("./bad-contrast.svg");
  });

  it("AUDIT-11 fires and names the failing color pair", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const findings = auditSpec({ spec });
    const finding = findings.find((f) => f.rule_id === "AUDIT-11");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("medium");
    expect(finding?.message).toContain("#888888");
    expect(finding?.message).toContain("#999999");
    expect(finding?.path).toBe("/brand/palette");
  });
});
