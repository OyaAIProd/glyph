/**
 * Structured explanation envelope — Moat PR 2.
 *
 * `buildStructuredExplanation` is the agent-consumable companion to
 * `explainHandle` (the prose pipeline). It returns a typed `Explanation`
 * with five orthogonal axes — headline, keyInsights, potentialMisreadings,
 * dataSources, chartTypeRationale, suggestedFollowups — plus a schema tag
 * (`format: "glyph-explanation/1"`) so agents can version-gate on it.
 *
 * The killer field is `suggestedFollowups[].suggestedVerb` /
 * `suggestedArgs` — the agent can pivot from "what does this chart say"
 * to "what would I run next" without an LLM re-read. Everything is pure
 * + deterministic: same {spec, rows, schema, auditFindings} → same
 * Explanation byte-for-byte. No clock, no PRNG, no LLM.
 *
 * Lives next to `explainHandle` (Phase 3 §2 PR35) so callers can pick the
 * envelope shape that matches their consumer (human → ExplainResult,
 * agent → Explanation).
 */

import type { AuditFinding } from "../audit/index.js";
import type { CompileFieldInfo } from "../compiler/compile-shared.js";
import { type ExplainColumn, type FieldRoleHint, explainHandle } from "../explain/index.js";
import type { GlyphSpec } from "../spec/types.js";

// ---------------------------------------------------------------------------
// Public types — the on-wire envelope
// ---------------------------------------------------------------------------

/** Confidence tier for a heuristic-derived insight. */
export type InsightConfidence = "high" | "medium" | "low";

/** Severity tier for a potential misreading; mirrors AuditSeverity. */
export type MisreadingSeverity = "low" | "medium" | "high";

/** A single key insight a reader should walk away with. */
export interface KeyInsight {
  /** Sentence describing the insight, data-grounded. */
  readonly insight: string;
  /** RFC 6901 JSON pointer into the spec / scene where this insight applies. */
  readonly path?: string;
  /** Confidence in the insight (heuristic-derived). */
  readonly confidence: InsightConfidence;
}

/** A common misreading the chart's encoding might invite. */
export interface PotentialMisreading {
  /** Description of the misreading. */
  readonly description: string;
  /** Which audit rule (AUDIT-01..09) this maps to, if any. */
  readonly auditRuleId?: string;
  /** Severity — mirrors the underlying audit finding when applicable. */
  readonly severity: MisreadingSeverity;
  /**
   * RFC 6901 pointer into the spec where the misreading originates,
   * passed through from the audit finding. Lets agents jump-to-source
   * without re-running auditSpec. NIT-6 from review.
   */
  readonly path?: string;
}

/** A pointer to where a value in the chart came from. */
export interface DataSourceRef {
  /** Spec field this references (e.g. "data.source", "layers[0].data.source"). */
  readonly field: string;
  /** Stringified value at that field. */
  readonly value: string;
}

/** Why this chart type was chosen, and what else would fit. */
export interface ChartTypeRationale {
  /** The mark (or chart family) used — bar, line, point, etc. */
  readonly chartType: string;
  /** One-sentence justification of the choice. */
  readonly rationale: string;
  /** Alternative chart types that would also fit; each notes its trade-off. */
  readonly alternatives: ReadonlyArray<{
    readonly chartType: string;
    readonly tradeoff: string;
  }>;
}

/** A follow-up question + the verb an agent should run to answer it. */
export interface SuggestedFollowup {
  /** Natural-language question; useful for UIs. */
  readonly question: string;
  /** Suggested MCP verb (e.g. "glyph_anomaly", "glyph_forecast"). */
  readonly suggestedVerb?: string;
  /**
   * Pre-built args the agent can use directly. Always omits `handle_id`
   * (the agent supplies that themselves). May omit other required args
   * when they can't be inferred from the spec; see `requires` below.
   */
  readonly suggestedArgs?: Record<string, unknown>;
  /**
   * Names of required-by-the-verb args that this followup CAN'T infer
   * from the spec alone — the agent must supply them. Empty when
   * `suggestedArgs` is complete. Example: `glyph_drift` needs
   * `periodField`, `periodA`, `periodB`, none of which a static spec
   * carries. Without this field the agent would have to read each
   * verb's schema to know what's missing.
   */
  readonly requires?: ReadonlyArray<string>;
}

/** The full structured explanation envelope. */
export interface Explanation {
  /** One-sentence summary of the chart's main message. */
  readonly headline: string;
  /** 2–5 specific, data-grounded insights. */
  readonly keyInsights: ReadonlyArray<KeyInsight>;
  /** Common misreadings this chart might invite, sourced from the audit pass. */
  readonly potentialMisreadings: ReadonlyArray<PotentialMisreading>;
  /** Where the data came from, surfaced for citation. */
  readonly dataSources: ReadonlyArray<DataSourceRef>;
  /** Why this chart type was the right (or wrong) choice. */
  readonly chartTypeRationale: ChartTypeRationale;
  /** 3–5 follow-up questions an agent can chain into. */
  readonly suggestedFollowups: ReadonlyArray<SuggestedFollowup>;
  /** Schema version of this explanation envelope. */
  readonly format: "glyph-explanation/1";
}

/** Input to `buildStructuredExplanation`. */
export interface StructuredExplainInput {
  readonly spec: GlyphSpec;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly schema: ReadonlyArray<CompileFieldInfo>;
  /** Audit findings from `auditSpec` — pre-computed by the caller. */
  readonly auditFindings: ReadonlyArray<AuditFinding>;
  /** Optional manual role hints — overrides heuristics. */
  readonly hints?: FieldRoleHint;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function fmtLabel(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "bigint") return String(v);
  return String(v);
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1).replace(/\.0$/, "");
  return n.toFixed(2).replace(/\.?0+$/, "");
}

/** Adapt a CompileFieldInfo to an ExplainColumn. */
function toExplainColumn(c: CompileFieldInfo): ExplainColumn {
  return { name: c.name, type: c.type };
}

/** Map DuckDB-ish type to an encoding role. */
function inferRole(type: string): "quantitative" | "temporal" | "nominal" | "ordinal" {
  const t = type.toUpperCase();
  if (/TIMESTAMP|DATE|TIME/.test(t)) return "temporal";
  if (/INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/.test(t)) return "quantitative";
  return "nominal";
}

/**
 * Pick x / y / group field names from the spec's first layer, falling back
 * to heuristic role inference over the schema. Hints win.
 */
function pickFieldNames(input: StructuredExplainInput): {
  readonly xField: string | undefined;
  readonly yField: string | undefined;
  readonly groupField: string | undefined;
  readonly xIsTemporal: boolean;
} {
  const layer = input.spec.layers[0];
  const enc = layer?.encoding ?? {};

  const channelField = (ch: unknown): string | undefined => {
    if (!ch) return undefined;
    if (typeof ch === "string") return ch;
    const f = (ch as { field?: string }).field;
    return typeof f === "string" ? f : undefined;
  };

  let xField = input.hints?.xField ?? channelField(enc.x);
  let yField = input.hints?.yField ?? channelField(enc.y);
  // EncodingSchema in spec/schemas.ts has no `group` channel — color
  // is the canonical group-by signal. NIT-5 from review removed a dead
  // fallback to a non-existent `enc.group` here.
  const groupField = input.hints?.groupField ?? channelField(enc.color);

  // Fallback: walk schema if the spec didn't declare an x/y.
  if (yField === undefined) {
    const q = input.schema.find((c) => inferRole(c.type) === "quantitative");
    yField = q?.name;
  }
  if (xField === undefined) {
    const t = input.schema.find((c) => inferRole(c.type) === "temporal");
    xField = t?.name ?? input.schema.find((c) => c.name !== yField)?.name;
  }

  const xCol = input.schema.find((c) => c.name === xField);
  const xIsTemporal = xCol ? inferRole(xCol.type) === "temporal" : false;
  return { xField, yField, groupField, xIsTemporal };
}

// ---------------------------------------------------------------------------
// Stage builders
// ---------------------------------------------------------------------------

/** Stage: keyInsights — extract concrete, data-grounded observations. */
function buildKeyInsights(
  input: StructuredExplainInput,
  roles: ReturnType<typeof pickFieldNames>,
): ReadonlyArray<KeyInsight> {
  const insights: KeyInsight[] = [];
  if (!roles.yField) return insights;

  const yIdx = input.schema.findIndex((c) => c.name === roles.yField);
  const xIdx = roles.xField ? input.schema.findIndex((c) => c.name === roles.xField) : -1;
  if (yIdx < 0) return insights;

  const pairs = input.rows
    .map((row) => ({
      x: xIdx >= 0 ? row[xIdx] : undefined,
      y: toNumber(row[yIdx]),
    }))
    .filter((p): p is { x: unknown; y: number } => p.y !== undefined);

  if (pairs.length === 0) return insights;

  // Insight 1: peak.
  const sortedDesc = [...pairs].sort((a, b) => b.y - a.y);
  // biome-ignore lint/style/noNonNullAssertion: length checked.
  const peak = sortedDesc[0]!;
  const peakLabel =
    xIdx >= 0 && peak.x !== undefined ? ` at ${roles.xField}=${fmtLabel(peak.x)}` : "";
  insights.push({
    insight: `${roles.yField} peaks${peakLabel} (${fmtNum(peak.y)}).`,
    path: "/layers/0/encoding/y",
    confidence: "high",
  });

  // Insight 2: trough.
  if (sortedDesc.length > 1) {
    // biome-ignore lint/style/noNonNullAssertion: length checked.
    const trough = sortedDesc[sortedDesc.length - 1]!;
    const troughLabel =
      xIdx >= 0 && trough.x !== undefined ? ` at ${roles.xField}=${fmtLabel(trough.x)}` : "";
    const ratio =
      trough.y !== 0 && Number.isFinite(peak.y / trough.y)
        ? ` — ${(peak.y / trough.y).toFixed(1)}× the trough`
        : "";
    insights.push({
      insight: `${roles.yField} bottoms${troughLabel} (${fmtNum(trough.y)})${ratio}.`,
      path: "/layers/0/encoding/y",
      confidence: "high",
    });
  }

  // Insight 3: top-3 by value (when more than three rows).
  if (sortedDesc.length >= 3) {
    const top3 = sortedDesc.slice(0, 3);
    const labels = top3
      .map((p) => (xIdx >= 0 ? `${fmtLabel(p.x)}=${fmtNum(p.y)}` : fmtNum(p.y)))
      .join(", ");
    insights.push({
      insight: `Top three by ${roles.yField}: ${labels}.`,
      path: "/layers/0/encoding/y",
      confidence: "medium",
    });
  }

  // Insight 4: monotonicity — when x is temporal (or numeric) check whether y
  // is strictly increasing / decreasing in x order.
  if (xIdx >= 0 && pairs.length >= 4) {
    const sortedByX = [...pairs].sort((a, b) => {
      const av = a.x instanceof Date ? a.x.getTime() : Number(a.x);
      const bv = b.x instanceof Date ? b.x.getTime() : Number(b.x);
      return av - bv;
    });
    let inc = true;
    let dec = true;
    for (let i = 1; i < sortedByX.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded above.
      const a = sortedByX[i - 1]!;
      // biome-ignore lint/style/noNonNullAssertion: bounded above.
      const b = sortedByX[i]!;
      if (b.y < a.y) inc = false;
      if (b.y > a.y) dec = false;
      if (!inc && !dec) break;
    }
    if (inc && !dec) {
      insights.push({
        insight: `${roles.yField} is monotonically increasing across ${roles.xField}.`,
        path: "/layers/0/encoding",
        confidence: "high",
      });
    } else if (dec && !inc) {
      insights.push({
        insight: `${roles.yField} is monotonically decreasing across ${roles.xField}.`,
        path: "/layers/0/encoding",
        confidence: "high",
      });
    }
  }

  return insights.slice(0, 5);
}

/** Stage: potentialMisreadings — derived from audit findings. */
function buildPotentialMisreadings(
  findings: ReadonlyArray<AuditFinding>,
): ReadonlyArray<PotentialMisreading> {
  // Stable canonical descriptions per audit rule. We surface the audit's
  // own message when available — that already speaks in the misreading's
  // voice — and fall back to a per-rule canned description.
  const canned: Record<string, string> = {
    "AUDIT-01":
      "Bar heights don't start at zero, so the relative magnitude between bars is exaggerated.",
    "AUDIT-02":
      "Two y-axes side by side invite comparing magnitudes that live on different scales.",
    "AUDIT-03":
      "A logarithmic y axis is not labelled as such; readers will interpret distances as linear.",
    "AUDIT-04":
      "Aggregating < 5 rows per bar makes the bar height read more reliable than the underlying sample supports.",
    "AUDIT-06":
      "More than ~8 colors crowd the palette; viewers can't reliably tell categories apart.",
    "AUDIT-07":
      "An extreme aspect ratio stretches the visual slope and can suggest a trend the data doesn't carry.",
    "AUDIT-08":
      "Diverging palette without an explicit midpoint — readers will pick their own zero, often the wrong one.",
    "AUDIT-09":
      "Stacked bars cross zero — positive + negative values cancel and the stack height stops being informative.",
  };
  return findings.map((f) => ({
    description: canned[f.rule_id] ?? f.message,
    auditRuleId: f.rule_id,
    severity: f.severity,
    // NIT-6 from review: pass-through the audit-finding's RFC 6901
    // pointer when present so callers can jump-to-source without
    // re-running auditSpec. Undefined when the rule doesn't anchor
    // to a specific spec location (e.g. global aspect-ratio rules).
    ...(f.path !== undefined ? { path: f.path } : {}),
  }));
}

/** Stage: dataSources — walk spec.data + each layer's data.source. */
function buildDataSources(spec: GlyphSpec): ReadonlyArray<DataSourceRef> {
  const out: DataSourceRef[] = [];
  if (spec.data?.source !== undefined) {
    out.push({ field: "data.source", value: String(spec.data.source) });
  }
  if (spec.data?.transform !== undefined) {
    out.push({ field: "data.transform", value: String(spec.data.transform) });
  }
  spec.layers.forEach((layer, i) => {
    if (layer.data?.source !== undefined) {
      out.push({ field: `layers[${i}].data.source`, value: String(layer.data.source) });
    }
    if (layer.data?.transform !== undefined) {
      out.push({ field: `layers[${i}].data.transform`, value: String(layer.data.transform) });
    }
  });
  return out;
}

/** Stage: chartTypeRationale — per-mark canned reasoning. */
function buildChartTypeRationale(spec: GlyphSpec): ChartTypeRationale {
  const mark = spec.layers[0]?.mark ?? "unknown";
  const table: Record<
    string,
    {
      rationale: string;
      alternatives: ReadonlyArray<{ chartType: string; tradeoff: string }>;
    }
  > = {
    bar: {
      rationale:
        "Bar marks excel at categorical comparison — bar length maps directly to magnitude and the eye reads differences cleanly.",
      alternatives: [
        { chartType: "point", tradeoff: "Better when categories are densely ordered." },
        {
          chartType: "boxplot",
          tradeoff: "Better when each category has many underlying samples.",
        },
      ],
    },
    line: {
      rationale:
        "Line marks excel at continuous trends — slope encodes rate of change and the connected geometry makes the trajectory obvious.",
      alternatives: [
        {
          chartType: "area",
          tradeoff: "Adds magnitude framing at the cost of overdraw with multiple series.",
        },
        {
          chartType: "point",
          tradeoff: "Removes the connecting line when adjacency is not meaningful.",
        },
      ],
    },
    point: {
      rationale:
        "Point marks excel at correlation between two quantitative fields — each point is one observation, density carries the relationship.",
      alternatives: [
        { chartType: "heatmap", tradeoff: "Better when too many points overplot." },
        { chartType: "line", tradeoff: "Better when x is ordered and continuity matters." },
      ],
    },
    area: {
      rationale:
        "Area marks excel at part-to-whole over time — fill conveys cumulative magnitude alongside the trend.",
      alternatives: [
        { chartType: "line", tradeoff: "Removes the fill when only the trend matters." },
        { chartType: "bar", tradeoff: "Better when x is discrete." },
      ],
    },
    rect: {
      rationale:
        "Rect marks excel at categorical × categorical comparison — area encodes a third quantitative axis.",
      alternatives: [
        { chartType: "heatmap", tradeoff: "Tighter grid, color carries the third axis." },
      ],
    },
    rule: {
      rationale:
        "Rule marks excel at threshold reference — a single line at a critical value frames the rest of the chart.",
      alternatives: [
        { chartType: "line", tradeoff: "Use when the reference value varies across x." },
      ],
    },
    heatmap: {
      rationale:
        "Heatmaps excel at dense 2D categorical comparison — color encodes magnitude across both axes at once.",
      alternatives: [
        { chartType: "rect", tradeoff: "Same shape, explicit per-cell value labels." },
        {
          chartType: "point",
          tradeoff: "Better when only a sparse subset of cells is meaningful.",
        },
      ],
    },
    boxplot: {
      rationale:
        "Box plots excel at distribution comparison — quartiles + whiskers reveal spread and skew per category.",
      alternatives: [
        {
          chartType: "point",
          tradeoff: "Better when individual observations matter more than aggregates.",
        },
      ],
    },
    text: {
      rationale: "Text marks annotate other layers — they don't carry the primary signal alone.",
      alternatives: [],
    },
    treemap: {
      rationale:
        "Treemaps excel at hierarchical part-to-whole — nested rectangles encode magnitude at every level.",
      alternatives: [
        {
          chartType: "sunburst",
          tradeoff: "Radial layout — better when depth comparison matters more than magnitude.",
        },
      ],
    },
    sunburst: {
      rationale:
        "Sunburst marks excel at hierarchical depth — radial position encodes depth, arc length encodes magnitude.",
      alternatives: [
        { chartType: "treemap", tradeoff: "Rectangular layout — easier magnitude comparison." },
      ],
    },
    force: {
      rationale:
        "Force-directed graphs excel at relational structure — node placement reveals clusters and bridges.",
      alternatives: [],
    },
    contour: {
      rationale:
        "Contour marks excel at 2D scalar fields — isolines reveal level sets without losing spatial context.",
      alternatives: [
        { chartType: "heatmap", tradeoff: "Continuous color instead of discrete level sets." },
      ],
    },
    "geo-point": {
      rationale:
        "Geo-point marks excel at geospatial point distributions — projection preserves spatial intuition.",
      alternatives: [
        {
          chartType: "geo-region",
          tradeoff: "Better when the analytic unit is an area, not a point.",
        },
      ],
    },
    "geo-region": {
      rationale:
        "Geo-region marks excel at choropleth comparison — color encodes a metric per region within its real geographic footprint.",
      alternatives: [
        {
          chartType: "geo-point",
          tradeoff: "Better when the analytic unit is a point, not an area.",
        },
      ],
    },
    // Math PR3 — vector-field mark renders {x, y, dx, dy} rows as
    // arrows on a grid. The natural alternative is a heatmap if the
    // viewer cares about |v| (magnitude), or streamlines if they
    // want flow lines.
    "vector-field": {
      rationale:
        "Vector-field marks are ideal for 2D fluid flow, gradient fields, and force visualization — arrows show both magnitude and direction at each sampled grid point.",
      alternatives: [
        {
          chartType: "heatmap",
          tradeoff: "Better when only magnitude matters (drops the directional information).",
        },
        {
          chartType: "contour",
          tradeoff:
            "Better when the underlying scalar potential matters (drops the direction; emphasizes level curves).",
        },
      ],
    },
    // Math PR4 — math-text renders a LaTeX expression at a fixed
    // (x, y) in data space. Used for chart titles, axis labels, and
    // pointwise annotations. The natural alternative is the plain
    // text mark when the label has no mathematical notation.
    "math-text": {
      rationale:
        "Math-text marks render LaTeX expressions inline — best for axis labels with subscripts/Greek letters, chart titles with formulas, and pointwise mathematical annotations.",
      alternatives: [
        {
          chartType: "text",
          tradeoff:
            "Better when the label has no mathematical notation (avoids the KaTeX parse cost).",
        },
      ],
    },
  };
  const entry = table[String(mark)];
  if (entry) {
    return {
      chartType: String(mark),
      rationale: entry.rationale,
      alternatives: entry.alternatives,
    };
  }
  return {
    chartType: String(mark),
    rationale: `Chart uses the ${mark} mark; no canonical rationale registered.`,
    alternatives: [],
  };
}

/** Stage: suggestedFollowups — per-mark canned diagnostic chains. */
function buildSuggestedFollowups(
  input: StructuredExplainInput,
  roles: ReturnType<typeof pickFieldNames>,
): ReadonlyArray<SuggestedFollowup> {
  const mark = input.spec.layers[0]?.mark ?? "unknown";
  const out: SuggestedFollowup[] = [];
  const yField = roles.yField;
  const xField = roles.xField;
  const groupField = roles.groupField;

  // Generic followups available for any chart with a numeric y.
  if (yField) {
    out.push({
      question: `Are there any outliers in ${yField}?`,
      suggestedVerb: "glyph_anomaly",
      suggestedArgs: {
        valueField: yField,
        ...(groupField ? { groupField } : {}),
      },
    });
  }

  // Mark-specific chains.
  switch (mark) {
    case "bar":
    case "rect": {
      // Categorical x — decompose tells you which dimension explains the spread.
      if (yField && xField) {
        out.push({
          question: `Which dimensions explain the variance in ${yField}?`,
          suggestedVerb: "glyph_decompose",
          suggestedArgs: {
            metricField: yField,
            factors: groupField ? [xField, groupField] : [xField],
          },
        });
      }
      if (yField && groupField) {
        out.push({
          question: `How does ${yField} drift across ${groupField} between periods?`,
          suggestedVerb: "glyph_drift",
          suggestedArgs: {
            valueField: yField,
            groupField,
          },
          // glyph_drift requires periodField + periodA + periodB; none
          // of those can be inferred from a categorical bar spec. The
          // agent has to choose which temporal column + which two
          // period boundaries the drift should compare.
          requires: ["periodField", "periodA", "periodB"],
        });
      }
      break;
    }
    case "line":
    case "area": {
      // Continuous x — forecast the next horizon.
      if (yField && xField) {
        out.push({
          question: `What does the next horizon of ${yField} look like?`,
          suggestedVerb: "glyph_forecast",
          suggestedArgs: {
            xField,
            yField,
            horizon: 7,
          },
        });
      }
      if (yField && xField && roles.xIsTemporal) {
        out.push({
          question: `Are there period-over-period drifts in ${yField}?`,
          suggestedVerb: "glyph_drift",
          suggestedArgs: {
            valueField: yField,
            ...(groupField ? { groupField } : {}),
          },
          // Same as the bar→drift case: drift needs periodField +
          // periodA + periodB picked by the agent. The temporal x
          // field is a strong candidate for periodField but the
          // boundary values can't be picked without knowing the
          // domain extent.
          requires: ["periodField", "periodA", "periodB"],
        });
      }
      break;
    }
    case "point": {
      if (yField && xField) {
        out.push({
          question: `Is the ${xField}/${yField} relationship explained by a third dimension?`,
          suggestedVerb: "glyph_decompose",
          suggestedArgs: {
            metricField: yField,
            factors: groupField ? [groupField] : [xField],
          },
        });
      }
      break;
    }
    case "heatmap":
    case "contour": {
      if (yField) {
        out.push({
          question: "Which cells of the grid are anomalous?",
          suggestedVerb: "glyph_anomaly",
          suggestedArgs: {
            valueField: yField,
            ...(groupField ? { groupField } : {}),
          },
        });
      }
      break;
    }
    case "boxplot": {
      if (yField && xField) {
        out.push({
          question: `Which ${xField} groups carry the most variance in ${yField}?`,
          suggestedVerb: "glyph_decompose",
          suggestedArgs: {
            metricField: yField,
            factors: [xField],
          },
        });
      }
      break;
    }
    default:
      break;
  }

  // NIT-4 from review: the generic "explain me" rerun used to live
  // AFTER mark-specific entries, so when a mark already filled the
  // 5-entry cap the rerun got silently dropped. Hoist it to the
  // front so it's guaranteed to appear in every envelope — agents
  // can always fall back to the prose narrative if the structured
  // followups don't fit their UX.
  const rerun: SuggestedFollowup = {
    question: "Re-read this chart in prose form.",
    suggestedVerb: "glyph_explain",
    suggestedArgs: { format: "legacy" },
  };

  // Cap at 5 to keep the envelope small. Rerun reserves slot 0.
  return [rerun, ...out].slice(0, 5);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Build a typed `Explanation` envelope from a spec + rows + schema + audit.
 *
 * Pure function — no engine handles, no clock, no PRNG, no LLM. Same input
 * yields the same Explanation. Callers that need the legacy prose envelope
 * should keep calling `explainHandle`.
 */
export function buildStructuredExplanation(input: StructuredExplainInput): Explanation {
  const roles = pickFieldNames(input);

  // Reuse the existing prose pipeline to keep the headline consistent — the
  // structured envelope is a different *shape* of the same reasoning, not a
  // different reasoning.
  const prose = explainHandle({
    schema: input.schema.map(toExplainColumn),
    rows: input.rows,
    hints: input.hints,
  });

  const keyInsights = buildKeyInsights(input, roles);
  const potentialMisreadings = buildPotentialMisreadings(input.auditFindings);
  const dataSources = buildDataSources(input.spec);
  const chartTypeRationale = buildChartTypeRationale(input.spec);
  const suggestedFollowups = buildSuggestedFollowups(input, roles);

  return {
    headline: prose.headline,
    keyInsights,
    potentialMisreadings,
    dataSources,
    chartTypeRationale,
    suggestedFollowups,
    format: "glyph-explanation/1",
  };
}
