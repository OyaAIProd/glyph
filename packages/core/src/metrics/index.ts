/**
 * Semantic / metric layer — Phase 3 §1 (PR37).
 *
 * A named aggregate (e.g. *MRR*, *churn rate*, *active customer*) registered
 * once and reused across every chart in a session. The materializer resolves
 * `{ "metric": "mrr" }` channels against a caller-supplied lookup and emits
 * a `_metric_<name>` synthetic column with the metric's SQL.
 *
 * v0 scope (this PR):
 *   - MetricDefinition type + small validators
 *   - Spec rewrite + SQL synthesis helpers used by `materializeSpec`
 *
 * Deferred to a follow-up:
 *   - yaml file loading (`glyph.metrics.yaml` at workspace root)
 *   - cross-metric joins via a `requires` clause
 */

import type { Channel, Encoding, GlyphSpec, Layer } from "../spec/types.js";

/** Object form of a Channel — re-shaped locally; `Channel` itself is a union. */
type ChannelObjectShape = Exclude<Channel, string>;

/** A registered metric. SQL is an aggregate expression (no FROM clause). */
export interface MetricDefinition {
  readonly name: string;
  /** Human-readable description — used in `glyph_metrics` listings. */
  readonly description?: string | undefined;
  /**
   * The SQL aggregate that computes the metric. Examples:
   *   - "SUM(amount) FILTER (WHERE type = 'subscription')"
   *   - "COUNT(*) FILTER (WHERE status = 'cancelled') / NULLIF(COUNT(*), 0)"
   * Must be a single expression; no SELECT/FROM/GROUP BY clauses.
   */
  readonly sql: string;
  /** Optional coarse grain hint — "hourly" / "daily" / "monthly" etc. */
  readonly grain?: string | undefined;
  /** Source columns the SQL references (for validation / future autocompletion). */
  readonly dimensions?: ReadonlyArray<string> | undefined;
  /** Source columns that MUST be present in the data view for this metric. */
  readonly requires?: ReadonlyArray<string> | undefined;
  /**
   * PR64 (PLAN item 2.7) — names of upstream metrics or columns that
   * causally drive this metric. e.g. `mrr.causal_of = ["new_customers",
   * "avg_price", "churn"]`. Renderers can surface a "→ causal" badge when
   * the chart encodes one of these against the metric. Used by
   * `glyph_causal_graph` to build the DAG.
   */
  readonly causal_of?: ReadonlyArray<string> | undefined;
}

/** PR64 (PLAN item 2.7) — DAG view over registered metrics' causal_of links. */
export interface CausalGraph {
  /** Every metric in the registry, keyed by name. */
  readonly nodes: ReadonlyArray<{ readonly name: string; readonly description?: string }>;
  /** Directed edges: cause → effect. */
  readonly edges: ReadonlyArray<{ readonly from: string; readonly to: string }>;
  /** Cycles, if any (set of names in each cycle). v0 detects 1-step + 2-step cycles. */
  readonly cycles: ReadonlyArray<ReadonlyArray<string>>;
  /**
   * PR64 + I4 from PR review — names referenced in some metric's
   * `causal_of` array but not registered as metrics themselves.
   * Surfaced so callers can warn about typos / missing registrations
   * instead of silently dropping them.
   */
  readonly dangling: ReadonlyArray<string>;
}

/**
 * Build a CausalGraph from a metric registry. Cycle detection runs a small
 * DFS; cycles are reported but don't throw — consumers decide how to render
 * (typical: draw a warning badge on the cycle's edge).
 */
export function buildCausalGraph(metrics: ReadonlyArray<MetricDefinition>): CausalGraph {
  const nodes = metrics.map((m) =>
    m.description !== undefined ? { name: m.name, description: m.description } : { name: m.name },
  );
  const knownNames = new Set(metrics.map((m) => m.name));
  const edges: Array<{ from: string; to: string }> = [];
  const danglingSet = new Set<string>();
  for (const m of metrics) {
    for (const cause of m.causal_of ?? []) {
      edges.push({ from: cause, to: m.name });
      if (!knownNames.has(cause)) danglingSet.add(cause);
    }
  }
  const dangling = [...danglingSet];
  // Cycle detection — DFS-based, returns each strongly-connected component
  // with > 1 node OR self-loops.
  const cycles = detectCycles(metrics, edges);
  return { nodes, edges, cycles, dangling };
}

function detectCycles(
  metrics: ReadonlyArray<MetricDefinition>,
  edges: ReadonlyArray<{ from: string; to: string }>,
): ReadonlyArray<ReadonlyArray<string>> {
  // Build adjacency (cause → effect).
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const bucket = adj.get(e.from);
    if (bucket) bucket.push(e.to);
    else adj.set(e.from, [e.to]);
  }
  const cycles: string[][] = [];
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const m of metrics) color.set(m.name, WHITE);
  const stack: string[] = [];
  function visit(node: string): void {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        // Cycle: extract the slice of stack from `next` to end.
        const idx = stack.indexOf(next);
        if (idx >= 0) cycles.push(stack.slice(idx));
      } else if (c === WHITE) {
        visit(next);
      }
    }
    color.set(node, BLACK);
    stack.pop();
  }
  for (const m of metrics) {
    if ((color.get(m.name) ?? WHITE) === WHITE) visit(m.name);
  }
  return cycles;
}

/** Callback the materializer uses to resolve a metric name. */
export type MetricResolver = (name: string) => MetricDefinition | undefined;

/** Validate a metric definition. Returns an error string or undefined. */
export function validateMetric(metric: unknown): string | undefined {
  if (!metric || typeof metric !== "object") return "metric must be an object";
  const m = metric as Record<string, unknown>;
  if (typeof m.name !== "string" || m.name.length === 0) return "metric.name is required";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(m.name)) {
    return `metric.name "${m.name}" must be a SQL-safe identifier`;
  }
  if (typeof m.sql !== "string" || m.sql.length === 0) return "metric.sql is required";
  // Block obvious shape violations — SELECT/FROM/GROUP BY belong outside the
  // aggregate expression. The materializer wraps this in a SELECT itself.
  if (/\bSELECT\b/i.test(m.sql) || /\bFROM\b/i.test(m.sql) || /\bGROUP\s+BY\b/i.test(m.sql)) {
    return "metric.sql must be a single aggregate expression, not a SELECT/FROM/GROUP BY";
  }
  return undefined;
}

/** Stable column name a metric resolves to. */
export function metricColumnName(metricName: string): string {
  return `_metric_${metricName}`;
}

// ---------------------------------------------------------------------------
// Spec scanning
// ---------------------------------------------------------------------------

/** All metric names referenced by a spec's encodings (deduped, in order). */
export function collectMetricNames(spec: GlyphSpec): ReadonlyArray<string> {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string): void => {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  };
  for (const layer of spec.layers) {
    forEachChannel(layer.encoding, (c) => {
      if (typeof c === "object" && c.metric !== undefined) add(c.metric);
    });
  }
  return out;
}

/** Source fields referenced by all non-metric channels in the spec. */
export function collectGroupByFields(spec: GlyphSpec): ReadonlyArray<string> {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string): void => {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  };
  // Facet adds a grouping column too.
  if (spec.facet?.col) add(spec.facet.col);
  for (const layer of spec.layers) {
    forEachChannel(layer.encoding, (c) => {
      if (typeof c === "string") add(c);
      else if (c.field !== undefined) add(c.field);
    });
  }
  return out;
}

function forEachChannel(encoding: Encoding, fn: (channel: Channel) => void): void {
  // Plain channels.
  for (const k of ["x", "y", "color", "size", "opacity"] as const) {
    const c = encoding[k];
    if (c !== undefined) fn(c);
  }
  // Tooltip can be a single channel or an array of channels.
  const t = encoding.tooltip;
  if (Array.isArray(t)) {
    for (const c of t) fn(c);
  } else if (t !== undefined) {
    fn(t);
  }
}

/**
 * Returns a deep-cloned spec with every `metric: <name>` channel rewritten
 * to `field: _metric_<name>`. Use after collecting names so downstream
 * compile sees only plain field references.
 */
export function rewriteMetricChannels(spec: GlyphSpec): GlyphSpec {
  const layers: Layer[] = spec.layers.map((layer) => ({
    ...layer,
    encoding: rewriteEncoding(layer.encoding),
  }));
  return { ...spec, layers };
}

function rewriteEncoding(encoding: Encoding): Encoding {
  const out: Record<string, unknown> = { ...encoding };
  for (const k of ["x", "y", "color", "size", "opacity"] as const) {
    const c = encoding[k];
    if (c === undefined) continue;
    out[k] = rewriteChannel(c);
  }
  const t = encoding.tooltip;
  if (Array.isArray(t)) {
    out.tooltip = t.map((c) => rewriteChannel(c));
  } else if (t !== undefined) {
    out.tooltip = rewriteChannel(t);
  }
  return out as Encoding;
}

function rewriteChannel(c: Channel): Channel {
  if (typeof c === "string") return c;
  if (c.metric === undefined) return c;
  const { metric, ...rest } = c as ChannelObjectShape;
  return { ...rest, field: metricColumnName(metric ?? "") } as Channel;
}

/**
 * Build the SQL that pre-aggregates a metric expression into a synthetic
 * column. Used by `materializeSpec` when a spec references one or more
 * metrics — the result is the new viewSql that materialize sees.
 *
 * Shape:
 *   SELECT <groupFields...>,
 *          (<metric.sql>) AS _metric_<name>,
 *          ...
 *   FROM (<baseSql>)
 *   GROUP BY <groupFields...>
 *
 * When `groupFields` is empty (e.g. a single aggregate scorecard), the
 * GROUP BY clause is omitted.
 */
export function buildMetricViewSql(args: {
  readonly baseSql: string;
  readonly groupFields: ReadonlyArray<string>;
  readonly metrics: ReadonlyArray<MetricDefinition>;
}): string {
  const quote = (s: string): string => `"${s.replace(/"/g, '""')}"`;
  const projections: string[] = args.groupFields.map(quote);
  for (const m of args.metrics) {
    projections.push(`(${m.sql}) AS ${quote(metricColumnName(m.name))}`);
  }
  const groupBy =
    args.groupFields.length > 0 ? ` GROUP BY ${args.groupFields.map(quote).join(", ")}` : "";
  return `SELECT ${projections.join(", ")} FROM (${args.baseSql})${groupBy}`;
}
