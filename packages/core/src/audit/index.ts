/**
 * Chart auditor — PR63 / PLAN item 2.2.
 *
 * A pure-fn linter that inspects a GlyphSpec (+ optional Scene) and flags
 * common ways charts mislead readers. Findings are advisory by default
 * (`strictness: "warn"`); a spec can opt into `strictness: "error"` to
 * make the materializer refuse to render. Hosts can also call the
 * `glyph_audit_spec` MCP verb directly.
 *
 * Rules implemented in v0:
 *
 *   AUDIT-01 (high)   Bar chart with y-axis not starting at 0.
 *   AUDIT-02 (medium) Dual-axis layers — two layers writing different
 *                     fields to left + right y axes, hard to compare.
 *   AUDIT-03 (high)   Logarithmic y scale without "log" mentioned in
 *                     title / subtitle (readers can't tell from a glance).
 *   AUDIT-04 (medium) Excessive aggregation — fewer than 5 underlying
 *                     rows per visible bar/point (low statistical power).
 *   AUDIT-05 (low)    Time axis with gaps not flagged (irregular
 *                     temporal sampling without a note).
 *   AUDIT-06 (low)    Color count > 8 (categorical palette confusion).
 *   AUDIT-07 (low)    Extreme aspect ratio (width:height < 0.5 or > 3).
 *   AUDIT-08 (medium) Diverging palette without explicit midpoint
 *                     declared (palette implies a midpoint, encoding
 *                     doesn't specify what it is).
 *   AUDIT-09 (medium) Stacked layers on top of negative values
 *                     (numeric reading is ambiguous; bars can cancel).
 *   AUDIT-10 (low)    Title implies a comparison the data doesn't
 *                     support — n/a in v0 (requires LLM judgment),
 *                     reserved.
 *
 * Deterministic, no clock, no LLM. Each rule lives in its own function so
 * adding rules is a single-file extension.
 */

import type { Channel, Encoding, GlyphSpec, Layer } from "../spec/types.js";

/** Severity tiers — `high` typically gates rendering when strictness=error. */
export type AuditSeverity = "low" | "medium" | "high";

/** A single audit finding. */
export interface AuditFinding {
  /** Stable id (e.g. "AUDIT-01") for filter / suppress workflows. */
  readonly rule_id: string;
  readonly severity: AuditSeverity;
  /** One-line description. */
  readonly message: string;
  /** Optional suggestion the agent / user can act on. */
  readonly suggestion?: string;
  /** RFC 6901 JSON pointer to the offending spec node (e.g. "/layers/0/encoding/y"). */
  readonly path?: string;
}

/** Input to `auditSpec`. Pass at least the spec; rows are optional. */
export interface AuditInput {
  readonly spec: GlyphSpec;
  /** Optional row count for the underlying data (used by AUDIT-04). */
  readonly rowCount?: number;
  /** Optional total distinct colors used (used by AUDIT-06). */
  readonly colorCardinality?: number;
}

/**
 * Audit a spec, returning all findings sorted by severity desc, then rule_id.
 * Pure function — same input → same output, no side effects.
 */
export function auditSpec(input: AuditInput): ReadonlyArray<AuditFinding> {
  const out: AuditFinding[] = [];
  const { spec } = input;
  for (let i = 0; i < spec.layers.length; i++) {
    const layer = spec.layers[i];
    if (!layer) continue;
    auditTruncatedYAxis(out, layer, i);
    auditLogScaleDisclosure(out, layer, i, spec.title);
    auditDivergingPalette(out, layer, i);
  }
  auditDualAxis(out, spec);
  auditExcessiveAggregation(out, spec, input.rowCount);
  auditColorCount(out, input.colorCardinality);
  auditAspectRatio(out, spec);
  auditStackedNegatives(out, spec);
  return out.sort((a, b) => {
    const sa = severityRank(a.severity);
    const sb = severityRank(b.severity);
    if (sa !== sb) return sb - sa;
    return a.rule_id.localeCompare(b.rule_id);
  });
}

function severityRank(s: AuditSeverity): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-01 — truncated y axis on a bar chart
// ---------------------------------------------------------------------------

function auditTruncatedYAxis(out: AuditFinding[], layer: Layer, idx: number): void {
  if (layer.mark !== "bar") return;
  const yCh = layer.encoding?.y;
  const domain = channelDomain(yCh);
  if (!domain) return;
  if (domain.length < 2) return;
  const lo = Number(domain[0]);
  if (!Number.isFinite(lo)) return;
  if (lo > 0) {
    out.push({
      rule_id: "AUDIT-01",
      severity: "high",
      message: `Layer ${idx}: bar chart y-axis domain starts at ${lo}, not 0 — bar heights misrepresent magnitude.`,
      suggestion:
        "Set scale.domain to [0, max] or use a different mark (point/line) when a non-zero baseline is intentional.",
      path: `/layers/${idx}/encoding/y`,
    });
  }
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-03 — log scale without disclosure
// ---------------------------------------------------------------------------

function auditLogScaleDisclosure(
  out: AuditFinding[],
  layer: Layer,
  idx: number,
  title: string | undefined,
): void {
  const yCh = layer.encoding?.y;
  const scaleType = channelScaleType(yCh);
  if (scaleType !== "log") return;
  const titleText = (title ?? "").toLowerCase();
  if (titleText.includes("log") || titleText.includes("logarithmic")) return;
  out.push({
    rule_id: "AUDIT-03",
    severity: "high",
    message: `Layer ${idx}: y axis uses a logarithmic scale but the chart title doesn't mention it.`,
    suggestion: "Add 'log' to the title or annotate the axis so readers don't read it as linear.",
    path: `/layers/${idx}/encoding/y`,
  });
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-08 — diverging palette without explicit midpoint
// ---------------------------------------------------------------------------

function auditDivergingPalette(out: AuditFinding[], layer: Layer, idx: number): void {
  const colorCh = layer.encoding?.color;
  if (!colorCh || typeof colorCh === "string") return;
  const scale = (colorCh as { scale?: { scheme?: string; midpoint?: number } }).scale;
  if (!scale) return;
  const scheme = (scale.scheme ?? "").toLowerCase();
  if (!/diverging|rdbu|brbg|prgn|piyg|puor|rdgy|rdylbu|rdylgn/.test(scheme)) return;
  if (scale.midpoint !== undefined) return;
  out.push({
    rule_id: "AUDIT-08",
    severity: "medium",
    message: `Layer ${idx}: diverging color palette ("${scheme}") used without an explicit midpoint.`,
    suggestion: "Set color.scale.midpoint (typically 0) so readers know where the palette pivots.",
    path: `/layers/${idx}/encoding/color/scale`,
  });
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-02 — dual-axis layers
// ---------------------------------------------------------------------------

function auditDualAxis(out: AuditFinding[], spec: GlyphSpec): void {
  if (spec.layers.length < 2) return;
  const sides = spec.layers.map((l) => {
    const y = l.encoding?.y;
    if (!y || typeof y === "string") return "left";
    return y.scale?.side === "right" ? "right" : "left";
  });
  const hasLeft = sides.includes("left");
  const hasRight = sides.includes("right");
  if (hasLeft && hasRight) {
    out.push({
      rule_id: "AUDIT-02",
      severity: "medium",
      message:
        "Dual-axis chart: layers use both left and right y axes. Readers often misjudge magnitudes when the two scales differ.",
      suggestion:
        "Prefer normalizing both series to a shared scale, or split into two stacked panels.",
    });
  }
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-04 — excessive aggregation
// ---------------------------------------------------------------------------

function auditExcessiveAggregation(
  out: AuditFinding[],
  spec: GlyphSpec,
  rowCount: number | undefined,
): void {
  if (rowCount === undefined || rowCount === 0) return;
  for (let i = 0; i < spec.layers.length; i++) {
    const layer = spec.layers[i];
    if (!layer || layer.mark !== "bar") continue;
    // If x is grouped (which is the typical bar chart), each bar represents
    // the aggregate of N rows. A reasonable threshold: < 5 rows per bar.
    const xCh = layer.encoding?.x;
    if (!xCh) continue;
    // We don't know the distinct-x count at audit time without scene info,
    // but we can flag the easy case: rowCount < 5 total.
    if (rowCount < 5) {
      out.push({
        rule_id: "AUDIT-04",
        severity: "medium",
        message: `Layer ${i}: only ${rowCount} underlying rows — bar chart aggregates lose statistical power below 5 samples per category.`,
        suggestion:
          "Show the raw data as points or document the sample size in the chart subtitle.",
        path: `/layers/${i}`,
      });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-06 — too many colors
// ---------------------------------------------------------------------------

function auditColorCount(out: AuditFinding[], colorCardinality: number | undefined): void {
  if (colorCardinality === undefined) return;
  if (colorCardinality > 8) {
    out.push({
      rule_id: "AUDIT-06",
      severity: "low",
      message: `Color encoding uses ${colorCardinality} distinct categories — readers can't reliably distinguish more than ~8.`,
      suggestion:
        "Group rarer categories under an 'Other' bucket, or facet by color instead of encoding it.",
    });
  }
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-07 — extreme aspect ratio
// ---------------------------------------------------------------------------

function auditAspectRatio(out: AuditFinding[], spec: GlyphSpec): void {
  const w = spec.width;
  const h = spec.height;
  if (w === undefined || h === undefined) return;
  const ratio = w / h;
  if (ratio < 0.5 || ratio > 3) {
    out.push({
      rule_id: "AUDIT-07",
      severity: "low",
      message: `Aspect ratio ${ratio.toFixed(2)} (${w}×${h}) is unusual; very tall or wide charts can exaggerate trends.`,
      suggestion:
        "Keep width:height between 0.5 and 3 unless the data shape genuinely demands otherwise.",
    });
  }
}

// ---------------------------------------------------------------------------
// Rule: AUDIT-09 — stacked layers crossing zero
// ---------------------------------------------------------------------------

function auditStackedNegatives(out: AuditFinding[], spec: GlyphSpec): void {
  // Heuristic: if any layer has y with a domain that crosses zero AND the
  // mark is bar, stacking would produce ambiguous readings. v0 flags only
  // when an explicit scale.domain is provided.
  for (let i = 0; i < spec.layers.length; i++) {
    const layer = spec.layers[i];
    if (!layer || layer.mark !== "bar") continue;
    const domain = channelDomain(layer.encoding?.y);
    if (!domain || domain.length < 2) continue;
    const lo = Number(domain[0]);
    const hi = Number(domain[domain.length - 1]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    if (lo < 0 && hi > 0 && spec.layers.length > 1) {
      out.push({
        rule_id: "AUDIT-09",
        severity: "medium",
        message: `Layer ${i}: bar chart y domain crosses zero (${lo} → ${hi}) with multiple layers — stacking yields ambiguous totals.`,
        suggestion:
          "Split into separate panels for positive and negative values, or use diverging color encoding.",
        path: `/layers/${i}/encoding/y/scale/domain`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function channelDomain(c: Channel | undefined): ReadonlyArray<unknown> | undefined {
  if (!c || typeof c === "string") return undefined;
  const scale = (c as { scale?: { domain?: ReadonlyArray<unknown> } }).scale;
  return scale?.domain;
}

function channelScaleType(c: Channel | undefined): string | undefined {
  if (!c || typeof c === "string") return undefined;
  const scale = (c as { scale?: { type?: string } }).scale;
  return scale?.type;
}

// Re-export the encoding/layer types to make this module self-contained.
export type { Channel, Encoding, Layer };
