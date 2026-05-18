/**
 * Tests for the semantic / metric layer (PR37 — Phase 3 §1).
 */
import { describe, expect, it } from "vitest";
import {
  buildCausalGraph,
  buildMetricViewSql,
  collectGroupByFields,
  collectMetricNames,
  metricColumnName,
  rewriteMetricChannels,
  validateMetric,
} from "./index.js";

describe("validateMetric", () => {
  it("accepts a well-formed aggregate", () => {
    expect(
      validateMetric({
        name: "mrr",
        sql: "SUM(amount) FILTER (WHERE type = 'subscription')",
        description: "Monthly recurring revenue.",
      }),
    ).toBeUndefined();
  });

  it("rejects a non-identifier name", () => {
    expect(validateMetric({ name: "monthly revenue", sql: "SUM(x)" })).toMatch(
      /SQL-safe identifier/,
    );
  });

  it("rejects a SQL that smuggles a SELECT / FROM / GROUP BY", () => {
    expect(validateMetric({ name: "x", sql: "SELECT SUM(x) FROM t" })).toMatch(/SELECT/);
    expect(validateMetric({ name: "x", sql: "SUM(x) FROM t" })).toMatch(/FROM/);
    expect(validateMetric({ name: "x", sql: "SUM(x) GROUP BY a" })).toMatch(/GROUP BY/);
  });

  it("rejects missing name or sql", () => {
    expect(validateMetric({ sql: "SUM(x)" })).toMatch(/name is required/);
    expect(validateMetric({ name: "x" })).toMatch(/sql is required/);
  });
});

describe("metricColumnName", () => {
  it("prefixes with _metric_ deterministically", () => {
    expect(metricColumnName("mrr")).toBe("_metric_mrr");
    expect(metricColumnName("churn_rate")).toBe("_metric_churn_rate");
  });
});

describe("collectMetricNames", () => {
  it("returns names from any encoding channel, deduped, in order", () => {
    const spec = {
      data: { source: "x.csv" },
      layers: [
        {
          mark: "line" as const,
          encoding: {
            x: "month",
            y: { metric: "mrr" },
            color: { metric: "churn_rate" },
          },
        },
        {
          mark: "line" as const,
          encoding: {
            x: "month",
            y: { metric: "mrr" }, // duplicate of above
          },
        },
      ],
    };
    expect(collectMetricNames(spec)).toEqual(["mrr", "churn_rate"]);
  });

  it("returns an empty array when no encoding uses a metric", () => {
    const spec = {
      data: { source: "x.csv" },
      layers: [{ mark: "bar" as const, encoding: { x: "a", y: "b" } }],
    };
    expect(collectMetricNames(spec)).toEqual([]);
  });
});

describe("collectGroupByFields", () => {
  it("includes plain field references from every channel + facet column", () => {
    const spec = {
      data: { source: "x.csv" },
      facet: { col: "region" },
      layers: [
        {
          mark: "bar" as const,
          encoding: {
            x: "month",
            y: { metric: "mrr" },
            color: "plan_tier",
          },
        },
      ],
    };
    // metric channels do NOT show up here (they're aggregates).
    expect(collectGroupByFields(spec)).toEqual(["region", "month", "plan_tier"]);
  });
});

describe("rewriteMetricChannels", () => {
  it("replaces `metric: <name>` with `field: _metric_<name>`", () => {
    const spec = {
      data: { source: "x.csv" },
      layers: [
        {
          mark: "line" as const,
          encoding: { x: "month", y: { metric: "mrr", type: "quantitative" as const } },
        },
      ],
    };
    const rewritten = rewriteMetricChannels(spec);
    const ch = rewritten.layers[0]?.encoding.y;
    expect(typeof ch === "object" && ch !== null && "field" in ch && ch.field).toBe("_metric_mrr");
    // The `type` hint survives.
    expect(typeof ch === "object" && ch !== null && "type" in ch && ch.type).toBe("quantitative");
    // The original spec is not mutated.
    const original = spec.layers[0]?.encoding.y;
    expect(
      typeof original === "object" && original !== null && "metric" in original && original.metric,
    ).toBe("mrr");
  });

  it("leaves plain field channels untouched", () => {
    const spec = {
      data: { source: "x.csv" },
      layers: [{ mark: "bar" as const, encoding: { x: "month", y: "rides" } }],
    };
    expect(rewriteMetricChannels(spec)).toEqual(spec);
  });

  it("rewrites metric channels inside tooltip arrays", () => {
    const spec = {
      data: { source: "x.csv" },
      layers: [
        {
          mark: "point" as const,
          encoding: {
            x: "month",
            y: "rides",
            tooltip: [{ metric: "mrr" }, "rides"],
          },
        },
      ],
    };
    const t = rewriteMetricChannels(spec).layers[0]?.encoding.tooltip;
    expect(Array.isArray(t)).toBe(true);
    if (Array.isArray(t)) {
      const first = t[0];
      expect(typeof first === "object" && first !== null && "field" in first && first.field).toBe(
        "_metric_mrr",
      );
      expect(t[1]).toBe("rides");
    }
  });
});

describe("buildMetricViewSql", () => {
  it("emits a SELECT … FROM (base) GROUP BY <groupFields>", () => {
    const sql = buildMetricViewSql({
      baseSql: "SELECT * FROM glyph_src_main",
      groupFields: ["month"],
      metrics: [
        {
          name: "mrr",
          sql: "SUM(amount) FILTER (WHERE type = 'subscription')",
        },
      ],
    });
    expect(sql).toBe(
      'SELECT "month", (SUM(amount) FILTER (WHERE type = \'subscription\')) AS "_metric_mrr" FROM (SELECT * FROM glyph_src_main) GROUP BY "month"',
    );
  });

  it("omits GROUP BY when groupFields is empty (single scorecard aggregate)", () => {
    const sql = buildMetricViewSql({
      baseSql: "SELECT * FROM glyph_src_main",
      groupFields: [],
      metrics: [{ name: "total_rev", sql: "SUM(amount)" }],
    });
    expect(sql).toBe(
      'SELECT (SUM(amount)) AS "_metric_total_rev" FROM (SELECT * FROM glyph_src_main)',
    );
  });

  it("handles multiple metrics in stable order", () => {
    const sql = buildMetricViewSql({
      baseSql: "SELECT * FROM t",
      groupFields: ["region", "month"],
      metrics: [
        { name: "mrr", sql: "SUM(amount)" },
        { name: "churn", sql: "COUNT(*) FILTER (WHERE status = 'cancelled')" },
      ],
    });
    expect(sql).toMatch(/AS "_metric_mrr".*AS "_metric_churn"/);
    expect(sql).toMatch(/GROUP BY "region", "month"$/);
  });

  it("escapes embedded double-quotes in group-field names", () => {
    const sql = buildMetricViewSql({
      baseSql: "SELECT * FROM t",
      groupFields: ['weird"name'],
      metrics: [{ name: "x", sql: "SUM(v)" }],
    });
    expect(sql).toContain('"weird""name"');
  });
});

describe("buildCausalGraph (PR64 / PLAN 2.7)", () => {
  it("emits one edge per causal_of entry", () => {
    const g = buildCausalGraph([
      { name: "mrr", sql: "SUM(amount)", causal_of: ["new_customers", "avg_price"] },
      { name: "new_customers", sql: "COUNT(DISTINCT customer_id)" },
      { name: "avg_price", sql: "AVG(price)" },
    ]);
    expect(g.nodes.map((n) => n.name).sort()).toEqual(["avg_price", "mrr", "new_customers"]);
    expect(g.edges).toContainEqual({ from: "new_customers", to: "mrr" });
    expect(g.edges).toContainEqual({ from: "avg_price", to: "mrr" });
    expect(g.cycles).toEqual([]);
  });

  it("detects a 2-step cycle", () => {
    const g = buildCausalGraph([
      { name: "a", sql: "SUM(x)", causal_of: ["b"] },
      { name: "b", sql: "SUM(y)", causal_of: ["a"] },
    ]);
    expect(g.cycles.length).toBeGreaterThan(0);
  });

  it("returns an empty graph for an empty registry", () => {
    expect(buildCausalGraph([])).toEqual({ nodes: [], edges: [], cycles: [] });
  });
});
