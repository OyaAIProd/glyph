/**
 * Tests for the structured explanation envelope (Moat PR 2).
 *
 * The envelope is the agent-consumable companion to `explainHandle`. These
 * tests pin the determinism contract + the per-mark followup mapping, the
 * audit → misreading bridge, and the schema-tag.
 */
import { describe, expect, it } from "vitest";
import type { AuditFinding } from "../audit/index.js";
import type { CompileFieldInfo } from "../compiler/compile-shared.js";
import type { GlyphSpec } from "../spec/types.js";
import { buildStructuredExplanation } from "./structured-explain.js";

const SCHEMA: ReadonlyArray<CompileFieldInfo> = [
  { name: "category", type: "VARCHAR" },
  { name: "value", type: "DOUBLE" },
];

const ROWS: ReadonlyArray<ReadonlyArray<unknown>> = [
  ["alpha", 10],
  ["beta", 22],
  ["gamma", 5],
  ["delta", 47],
];

const CLEAN_BAR_SPEC: GlyphSpec = {
  data: { source: "rides.csv" },
  layers: [
    {
      mark: "bar",
      encoding: {
        x: { field: "category" },
        y: { field: "value" },
      },
    },
  ],
} as GlyphSpec;

describe("buildStructuredExplanation", () => {
  it("clean bar chart: 0 misreadings, >=2 key insights, glyph_decompose in followups", () => {
    const e = buildStructuredExplanation({
      spec: CLEAN_BAR_SPEC,
      rows: ROWS,
      schema: SCHEMA,
      auditFindings: [],
    });

    expect(e.format).toBe("glyph-explanation/1");
    expect(e.potentialMisreadings).toEqual([]);
    expect(e.keyInsights.length).toBeGreaterThanOrEqual(2);
    expect(e.chartTypeRationale.chartType).toBe("bar");
    expect(e.chartTypeRationale.rationale).toContain("categorical");
    const verbs = e.suggestedFollowups.map((f) => f.suggestedVerb);
    expect(verbs).toContain("glyph_decompose");
    // The data source surfaces in dataSources.
    expect(e.dataSources).toContainEqual({ field: "data.source", value: "rides.csv" });
  });

  it("truncated-y bar chart trips AUDIT-01 → potentialMisreadings has high severity entry", () => {
    const finding: AuditFinding = {
      rule_id: "AUDIT-01",
      severity: "high",
      message:
        "Layer 0: bar chart y-axis domain starts at 5, not 0 — bar heights misrepresent magnitude.",
      path: "/layers/0/encoding/y",
    };

    const e = buildStructuredExplanation({
      spec: CLEAN_BAR_SPEC,
      rows: ROWS,
      schema: SCHEMA,
      auditFindings: [finding],
    });

    expect(e.potentialMisreadings).toHaveLength(1);
    const m = e.potentialMisreadings[0];
    if (!m) throw new Error("expected misreading");
    expect(m.auditRuleId).toBe("AUDIT-01");
    expect(m.severity).toBe("high");
    expect(m.description.toLowerCase()).toContain("bar heights");
  });

  it("time-series line chart: suggested followups include glyph_forecast", () => {
    const timeSchema: ReadonlyArray<CompileFieldInfo> = [
      { name: "date", type: "TIMESTAMP" },
      { name: "revenue", type: "DOUBLE" },
    ];
    const start = new Date("2025-01-01T00:00:00Z").getTime();
    const day = 86400_000;
    const timeRows: ReadonlyArray<ReadonlyArray<unknown>> = Array.from({ length: 14 }, (_, i) => [
      new Date(start + i * day),
      100 + i * 5,
    ]);
    const lineSpec: GlyphSpec = {
      data: { source: "revenue.parquet" },
      layers: [
        {
          mark: "line",
          encoding: {
            x: { field: "date" },
            y: { field: "revenue" },
          },
        },
      ],
    } as GlyphSpec;

    const e = buildStructuredExplanation({
      spec: lineSpec,
      rows: timeRows,
      schema: timeSchema,
      auditFindings: [],
    });

    expect(e.chartTypeRationale.chartType).toBe("line");
    const verbs = e.suggestedFollowups.map((f) => f.suggestedVerb);
    expect(verbs).toContain("glyph_forecast");
    // The forecast args should carry the xField/yField the agent needs.
    const fc = e.suggestedFollowups.find((f) => f.suggestedVerb === "glyph_forecast");
    if (!fc) throw new Error("expected glyph_forecast followup");
    expect(fc.suggestedArgs).toMatchObject({
      xField: "date",
      yField: "revenue",
      horizon: 7,
    });
    // Monotonic series → keyInsights should mention monotonicity.
    const monoHit = e.keyInsights.some((k) => k.insight.toLowerCase().includes("monotonic"));
    expect(monoHit).toBe(true);
  });

  it("is deterministic — same input → deep-equal output across calls", () => {
    const a = buildStructuredExplanation({
      spec: CLEAN_BAR_SPEC,
      rows: ROWS,
      schema: SCHEMA,
      auditFindings: [],
    });
    const b = buildStructuredExplanation({
      spec: CLEAN_BAR_SPEC,
      rows: ROWS,
      schema: SCHEMA,
      auditFindings: [],
    });
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
  });

  it("envelope carries format: 'glyph-explanation/1'", () => {
    const e = buildStructuredExplanation({
      spec: CLEAN_BAR_SPEC,
      rows: ROWS,
      schema: SCHEMA,
      auditFindings: [],
    });
    expect(e.format).toBe("glyph-explanation/1");
  });
});
