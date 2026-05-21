/**
 * Moat PR3 — AUDIT-10 (silent missing-data dropout) emission test.
 *
 * Locks the rule's text + path + severity. The rule fires only when
 * the policy is "skip" (or unset) AND > 5% of rows have a missing y.
 */
import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "../../src/compute/engine.js";
import { renderTimeAuditFindings } from "../../src/audit/index.js";
import type { GlyphSpec } from "../../src/spec/types.js";

const schema: ColumnInfo[] = [
  { name: "day", type: "VARCHAR", nullable: false },
  { name: "sales", type: "DOUBLE", nullable: true },
];

// 10 rows, 3 of them null y → 30% missing rate; well over the 5%
// threshold.
const rowsWithMissing: Array<Array<string | number | null>> = [
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

const skipSpec: GlyphSpec = {
  data: { source: "fixture.csv" },
  layers: [
    {
      mark: "bar",
      encoding: {
        x: { field: "day", type: "ordinal" },
        y: { field: "sales", type: "quantitative" },
      },
    },
  ],
};

describe("AUDIT-10 — silent missing-data dropout", () => {
  it("fires on the unset (skip-default) policy when missing rate > 5%", () => {
    const findings = renderTimeAuditFindings(skipSpec, rowsWithMissing, "sales", schema);
    const f = findings.find((x) => x.rule_id === "AUDIT-10");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("medium");
    expect(f?.path).toBe("/data/onMissing");
    expect(f?.message).toMatch(/silently dropped 3 of 10 rows \(30%\)/);
    expect(f?.suggestion).toMatch(/onMissing.*callout/);
  });

  it("does NOT fire when onMissing is set to 'callout' (gap is surfaced)", () => {
    const spec: GlyphSpec = {
      ...skipSpec,
      data: { source: "fixture.csv", onMissing: "callout" },
    };
    const findings = renderTimeAuditFindings(spec, rowsWithMissing, "sales", schema);
    expect(findings.find((x) => x.rule_id === "AUDIT-10")).toBeUndefined();
  });

  it("does NOT fire when onMissing is set to 'interpolate'", () => {
    const spec: GlyphSpec = {
      ...skipSpec,
      data: { source: "fixture.csv", onMissing: "interpolate" },
    };
    const findings = renderTimeAuditFindings(spec, rowsWithMissing, "sales", schema);
    expect(findings.find((x) => x.rule_id === "AUDIT-10")).toBeUndefined();
  });

  it("does NOT fire under the 5% threshold (one missing out of fifty)", () => {
    // 50 rows; 1 missing = 2%. Below the AUDIT-10 threshold.
    const tinyMiss: Array<Array<string | number | null>> = [];
    for (let i = 0; i < 50; i++) tinyMiss.push([String(i), i === 7 ? null : i]);
    const findings = renderTimeAuditFindings(skipSpec, tinyMiss, "sales", schema);
    expect(findings.find((x) => x.rule_id === "AUDIT-10")).toBeUndefined();
  });

  it("does NOT fire when no rows are missing", () => {
    const allGood: Array<Array<string | number>> = [
      ["01", 1],
      ["02", 2],
      ["03", 3],
    ];
    const findings = renderTimeAuditFindings(skipSpec, allGood, "sales", schema);
    expect(findings).toEqual([]);
  });
});
