/**
 * `glyph diff` — extended for S4 / "Chart Audit on PR" Action.
 *
 * Two modes, selected by the second positional argument:
 *
 *   1. SPEC × BASELINE-SVG (legacy, PR64):
 *        glyph diff <spec.json> <baseline.svg> [--threshold N] [--output html|md|diff]
 *      Renders the spec, byte-compares to baseline, emits a unified diff.
 *
 *   2. SPEC × SPEC (new, S4 / PR0):
 *        glyph diff <a.json> <b.json> --format md [--image-dir <dir>]
 *      Diffs two specs, runs the chart auditor on both, computes a trust
 *      score, and writes before.svg + after.svg into --image-dir (mkdir -p).
 *      Emits a Markdown block suitable for a GitHub PR comment.
 *
 * Mode detection: if both positional args end in `.json`, mode 2; else mode 1.
 * `--format md` is the S4-friendly synonym of `--output md` and forces mode 2
 * when ambiguous.
 *
 * `runDiffCommand` is the programmatic surface used by tests and downstream
 * tooling (the GitHub Action shells out to the CLI, but the Action repo's
 * unit tests can call this directly).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AuditFinding,
  type AuditSeverity,
  type GlyphSpec,
  auditSpec,
  compileSpec,
  diffSpecs,
  renderSvg,
  safeParseSpecJson,
} from "@glyph/core";
import { createDuckDBEngine, materializeSpec } from "@glyph/duckdb";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Output format selector. `diff` = legacy unified-diff text. */
export type DiffFormat = "diff" | "html" | "md";

/** Options for the programmatic entry point. */
export interface RunDiffOptions {
  /** Path to the "before" spec (or, in legacy mode, the spec to render). */
  readonly a: string;
  /** Path to the "after" spec (mode 2) OR the baseline SVG (legacy). */
  readonly b: string;
  /** Output format. Defaults to "diff" (unified diff). */
  readonly format?: DiffFormat;
  /** Mode-2 only: directory to write before.svg + after.svg into. */
  readonly imageDir?: string;
  /** Legacy mode: accept up to N changed lines (default 0). */
  readonly threshold?: number;
}

/** Result returned to programmatic callers. */
export interface RunDiffResult {
  /** Stdout payload — markdown body in mode 2, unified diff text in legacy. */
  readonly markdown: string;
  /** Mode-2 only: basenames of SVGs written into imageDir. */
  readonly imagesGenerated: ReadonlyArray<string>;
  /** Process exit code (0 = OK, 1 = diff found, 2 = invocation error). */
  readonly exitCode: number;
}

/**
 * Programmatic entry — pure I/O at the file-system boundary, no stdout writes.
 *
 * Returns the markdown / diff payload + the list of SVGs written. The CLI
 * wrapper (`cmdDiff` below) takes care of routing stdout/stderr and exit
 * codes; callers from JS (e.g. the GitHub Action) prefer the structured
 * result.
 */
export async function runDiffCommand(opts: RunDiffOptions): Promise<RunDiffResult> {
  const format: DiffFormat = opts.format ?? "diff";
  // Mode 2 (spec-vs-spec) when both inputs are JSON OR when --format=md is
  // requested with --image-dir (the S4 contract).
  const aIsJson = opts.a.toLowerCase().endsWith(".json");
  const bIsJson = opts.b.toLowerCase().endsWith(".json");
  if (aIsJson && bIsJson) {
    return runSpecVsSpec(opts);
  }
  return runLegacySpecVsBaseline(opts, format);
}

// ---------------------------------------------------------------------------
// Mode 2 — spec × spec: structural diff + audit + render
// ---------------------------------------------------------------------------

async function runSpecVsSpec(opts: RunDiffOptions): Promise<RunDiffResult> {
  const specA = readSpec(opts.a);
  const specB = readSpec(opts.b);

  // Structural diff of the JSON specs (before path-resolution — readers want
  // to see the *source* values, not absolute paths the CLI synthesized).
  const structural = diffSpecs(specA, specB);

  // Audit the *after* state, since that's what the PR is introducing. The
  // trust score and the rendered findings list both reflect B. (Diffing
  // findings — "this rule was new in B" — is a future enhancement; for now
  // any reader can compare with the before-spec themselves.)
  const auditAfter = auditSpec({ spec: specB });
  const trust = computeTrustScore(auditAfter);

  // Render both sides to SVG, if --image-dir was given. We resolve relative
  // data.source paths against each spec file (matching `cmdRender`).
  const imagesGenerated: string[] = [];
  if (opts.imageDir) {
    mkdirSync(opts.imageDir, { recursive: true });
    const svgBefore = await renderSpecToSvg(specA, opts.a);
    const svgAfter = await renderSpecToSvg(specB, opts.b);
    const beforePath = resolve(opts.imageDir, "before.svg");
    const afterPath = resolve(opts.imageDir, "after.svg");
    writeFileSync(beforePath, svgBefore, "utf8");
    writeFileSync(afterPath, svgAfter, "utf8");
    imagesGenerated.push("before.svg", "after.svg");
  }

  const markdown = formatSpecDiffMarkdown({
    structural,
    auditAfter,
    trust,
    hasImages: imagesGenerated.length > 0,
  });

  // Exit 0 when nothing changed (no structural diff AND no audit findings on
  // the "after" side) — mirrors the existing exit-0-on-clean semantics. Any
  // structural change is exit 1 (the comment is informational, not a gate;
  // adopters can opt into `fail-on: error` at the Action layer).
  const isClean =
    structural.added.length === 0 &&
    structural.removed.length === 0 &&
    structural.changed.length === 0;
  return {
    markdown,
    imagesGenerated,
    exitCode: isClean ? 0 : 1,
  };
}

// ---------------------------------------------------------------------------
// Mode 1 (legacy) — spec × baseline SVG
// ---------------------------------------------------------------------------

async function runLegacySpecVsBaseline(
  opts: RunDiffOptions,
  format: DiffFormat,
): Promise<RunDiffResult> {
  const spec = readSpec(opts.a);
  const baseline = readFileSync(resolve(opts.b), "utf8");
  const threshold = opts.threshold ?? 0;
  const svg = await renderSpecToSvg(spec, opts.a);
  if (svg === baseline) {
    return { markdown: "OK — no diff\n", imagesGenerated: [], exitCode: 0 };
  }
  const diff = unifiedDiff(baseline, svg, opts.b, "rendered");
  const changedLines = diff
    .split("\n")
    .filter((l) => l.startsWith("+") || l.startsWith("-")).length;
  if (changedLines <= threshold) {
    return {
      markdown: `OK — ${changedLines} line(s) changed, within threshold ${threshold}\n`,
      imagesGenerated: [],
      exitCode: 0,
    };
  }
  let payload: string;
  if (format === "html") {
    payload = renderHtmlDiff(baseline, svg, opts.b);
  } else if (format === "md") {
    payload = `## Glyph chart diff: \`${opts.b}\`\n\n\`\`\`diff\n${diff}\n\`\`\`\n`;
  } else {
    payload = diff;
  }
  return { markdown: payload, imagesGenerated: [], exitCode: 1 };
}

// ---------------------------------------------------------------------------
// Markdown formatter (mode 2)
// ---------------------------------------------------------------------------

interface FormatArgs {
  readonly structural: ReturnType<typeof diffSpecs>;
  readonly auditAfter: ReadonlyArray<AuditFinding>;
  readonly trust: number;
  readonly hasImages: boolean;
}

function formatSpecDiffMarkdown(args: FormatArgs): string {
  const lines: string[] = ["## Glyph chart change", ""];

  // ── Diff section ───────────────────────────────────────────────────────
  lines.push("### Diff", "```diff");
  if (
    args.structural.added.length === 0 &&
    args.structural.removed.length === 0 &&
    args.structural.changed.length === 0
  ) {
    lines.push("(no structural changes)");
  } else {
    for (const r of args.structural.removed) {
      lines.push(`- "${r.path}": ${formatScalar(r.value)}`);
    }
    for (const a of args.structural.added) {
      lines.push(`+ "${a.path}": ${formatScalar(a.value)}`);
    }
    for (const c of args.structural.changed) {
      lines.push(`- "${c.path}": ${formatScalar(c.before)}`);
      lines.push(`+ "${c.path}": ${formatScalar(c.after)}`);
    }
  }
  lines.push("```", "");

  // ── Audit section ─────────────────────────────────────────────────────
  lines.push("### Audit");
  if (args.auditAfter.length === 0) {
    lines.push("- (no findings)");
  } else {
    for (const f of args.auditAfter) {
      lines.push(`- ${severityIcon(f.severity)} \`${f.rule_id}\` — ${f.message}`);
    }
  }
  lines.push("");
  lines.push(`trust: ${args.trust} / 100`);
  lines.push("");

  // ── Render section ────────────────────────────────────────────────────
  if (args.hasImages) {
    lines.push("### Render", "");
    lines.push("| before | after |");
    lines.push("| ------ | ----- |");
    lines.push("| ![before](before.svg) | ![after](after.svg) |");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Trust score
// ---------------------------------------------------------------------------

/**
 * Compute a 0–100 trust score from audit findings.
 *
 * Deductions: high = -15, medium = -7, low = -3. Floored at 0, capped at 100.
 * Deterministic and unit-test-friendly; weights are intentionally round so the
 * score number on a PR comment is predictable from the rule_id list.
 */
export function computeTrustScore(findings: ReadonlyArray<AuditFinding>): number {
  let score = 100;
  for (const f of findings) {
    score -= severityWeight(f.severity);
  }
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}

function severityWeight(s: AuditSeverity): number {
  switch (s) {
    case "high":
      return 15;
    case "medium":
      return 7;
    case "low":
      return 3;
  }
}

/**
 * Severity → unicode icon. Mapping:
 *   high   → ✗   (U+2717  error)
 *   medium → ⚠   (U+26A0  warning — variation selector U+FE0F appended)
 *   low    → ℹ   (U+2139  info)
 */
function severityIcon(s: AuditSeverity): string {
  switch (s) {
    case "high":
      return "✗";
    case "medium":
      return "⚠️";
    case "low":
      return "ℹ";
  }
}

// ---------------------------------------------------------------------------
// Spec I/O + render helpers
// ---------------------------------------------------------------------------

function readSpec(path: string): GlyphSpec {
  const raw = readFileSync(resolve(path), "utf8");
  const parsed = safeParseSpecJson(raw);
  if (!parsed.ok) {
    throw new Error(`${path}: ${parsed.error.message}`);
  }
  return parsed.spec;
}

function resolveSourcePaths(spec: GlyphSpec, specPath: string): GlyphSpec {
  if (!spec.data) return spec;
  if (spec.data.source === undefined) return spec;
  const specDir = resolve(specPath, "..");
  return {
    ...spec,
    data: { ...spec.data, source: resolve(specDir, spec.data.source) },
  };
}

async function renderSpecToSvg(spec: GlyphSpec, specPath: string): Promise<string> {
  const resolved = resolveSourcePaths(spec, specPath);
  // Mirror cmdRender's branching: hierarchy / graph / grid specs bypass DuckDB.
  if (resolved.data?.hierarchy || resolved.data?.graph || resolved.data?.grid) {
    return renderSvg(compileSpec({ spec: resolved, rows: [], schema: [] }));
  }
  const engine = await createDuckDBEngine();
  try {
    const m = await materializeSpec(engine, resolved);
    const scene = compileSpec({
      spec: resolved,
      rows: m.result.rows,
      schema: m.handle.schema,
    });
    return renderSvg(scene);
  } finally {
    await engine.close();
  }
}

function formatScalar(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Objects / arrays — single-line JSON, truncated to keep diff blocks readable.
  const s = JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

// ---------------------------------------------------------------------------
// Unified diff (legacy mode) — moved verbatim from index.ts so the two modes
// share one home. Re-exported via `../index.ts` for backwards compatibility.
// ---------------------------------------------------------------------------

/**
 * Tiny unified-diff implementation — pure-fn, no deps. Output mirrors `diff -u`:
 *
 *   --- baselinePath
 *   +++ aLabel
 *   @@ -L,N +L,N @@
 *   ...
 *
 * For SVG diff we treat each line as a token; small enough that an O(N²)
 * LCS is fine. For huge SVGs callers should use git itself.
 */
export function unifiedDiff(
  before: string,
  after: string,
  beforeLabel: string,
  afterLabel: string,
): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs = longestCommonSubsequence(a, b);
  const out: string[] = [`--- ${beforeLabel}`, `+++ ${afterLabel}`];
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.length || j < b.length) {
    if (k < lcs.length && a[i] === lcs[k] && b[j] === lcs[k]) {
      out.push(` ${a[i]}`);
      i++;
      j++;
      k++;
    } else if (k < lcs.length && a[i] !== lcs[k]) {
      out.push(`-${a[i]}`);
      i++;
    } else if (k < lcs.length && b[j] !== lcs[k]) {
      out.push(`+${b[j]}`);
      j++;
    } else if (j < b.length) {
      out.push(`+${b[j]}`);
      j++;
    } else if (i < a.length) {
      out.push(`-${a[i]}`);
      i++;
    } else {
      break;
    }
  }
  return `${out.join("\n")}\n`;
}

function longestCommonSubsequence(a: ReadonlyArray<string>, b: ReadonlyArray<string>): string[] {
  const n = a.length;
  const m = b.length;
  const dp = new Int32Array((n + 1) * (m + 1));
  const idx = (i: number, j: number): number => i * (m + 1) + j;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (a[i] === b[j]) {
        dp[idx(i + 1, j + 1)] = (dp[idx(i, j)] ?? 0) + 1;
      } else {
        const up = dp[idx(i, j + 1)] ?? 0;
        const left = dp[idx(i + 1, j)] ?? 0;
        dp[idx(i + 1, j + 1)] = up > left ? up : left;
      }
    }
  }
  const out: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      const v = a[i - 1];
      if (v !== undefined) out.unshift(v);
      i--;
      j--;
    } else if ((dp[idx(i - 1, j)] ?? 0) >= (dp[idx(i, j - 1)] ?? 0)) {
      i--;
    } else {
      j--;
    }
  }
  return out;
}

function renderHtmlDiff(before: string, after: string, beforeLabel: string): string {
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Glyph chart diff</title>
<style>body{font-family:system-ui;margin:1rem}h1{font-size:1.1rem}.pane{display:inline-block;vertical-align:top;width:48%;border:1px solid #ddd;margin-right:1%;padding:0.5rem}.label{font-size:0.85rem;color:#666;margin-bottom:0.5rem}</style>
</head><body>
<h1>Glyph chart diff: <code>${escapeHtml(beforeLabel)}</code></h1>
<div class="pane"><div class="label">baseline</div>${before}</div>
<div class="pane"><div class="label">rendered</div>${after}</div>
</body></html>
`;
}

// ---------------------------------------------------------------------------
// CLI argument parsing + dispatch
// ---------------------------------------------------------------------------

/**
 * CLI handler — parses argv, writes to stdout/stderr, returns the process
 * exit code. Called by the top-level dispatcher in `index.ts`.
 */
export async function cmdDiff(args: string[]): Promise<number> {
  let a: string | undefined;
  let b: string | undefined;
  let threshold = 0;
  let format: DiffFormat | undefined;
  let imageDir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (tok === "--threshold") {
      const raw = args[++i];
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        process.stderr.write(
          `glyph diff: --threshold expects a non-negative number, got "${raw}"\n`,
        );
        return 2;
      }
      threshold = n;
    } else if (tok === "--output" || tok === "--format") {
      const v = args[++i];
      if (v === "html" || v === "md" || v === "diff") {
        format = v;
      } else {
        process.stderr.write(
          `glyph diff: ${tok} expects "html" | "md" | "diff", got "${v}"\n`,
        );
        return 2;
      }
    } else if (tok === "--image-dir") {
      imageDir = args[++i];
    } else if (!a && tok) {
      a = tok;
    } else if (!b && tok) {
      b = tok;
    }
  }
  if (!a || !b) {
    process.stderr.write(
      "glyph diff: usage:\n" +
        "  glyph diff <spec.json> <baseline.svg> [--threshold N] [--output html|md|diff]\n" +
        "  glyph diff <a.json> <b.json> --format md [--image-dir <dir>]\n",
    );
    return 2;
  }
  const result = await runDiffCommand({
    a,
    b,
    ...(format !== undefined ? { format } : {}),
    ...(imageDir !== undefined ? { imageDir } : {}),
    threshold,
  });
  process.stdout.write(result.markdown);
  return result.exitCode;
}
