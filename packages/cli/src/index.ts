/**
 * Glyph CLI — `glyph render | describe | query | check`.
 *
 * Designed to be both human-friendly and agent-friendly:
 *   - exit 0 on success, 1 on user error, 2 on internal error
 *   - errors go to stderr with a one-line summary an LLM can act on
 *   - `--json` flag on every command emits machine-readable output
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type GlyphSpec, compileSpec, renderSvg, safeParseSpecJson } from "@glyph/core";
import { createDuckDBEngine, materializeSpec } from "@glyph/duckdb";

const HELP = `glyph — chart-and-compute CLI

Usage:
  glyph render <spec.json> [-o file.svg] [--json]
  glyph describe <data-file>                     # CSV/Parquet/JSON
  glyph query   <spec.json> <sql>                # follow-up query
  glyph check   <spec.json> <baseline.svg>       # determinism check
  glyph diff    <spec.json> <baseline.svg> [--threshold N] [--output html]
                                                # PR64/PLAN 2.8 — spec-as-code CI gate
  glyph --help

Spec format: see https://github.com/seanhanca/glyph/blob/main/mvp.md
`;

function readSpec(path: string): GlyphSpec {
  const raw = readFileSync(resolve(path), "utf8");
  // Strip an optional $schema editor hint.
  const parsed = safeParseSpecJson(raw);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.spec;
}

/** Rewrite the spec's top-level data.source to be absolute relative to the spec file. */
function resolveSourcePaths(spec: GlyphSpec, specPath: string): GlyphSpec {
  if (!spec.data) return spec;
  // PR67 — hierarchy-only specs have no `source` to resolve.
  if (spec.data.source === undefined) return spec;
  const specDir = resolve(specPath, "..");
  return {
    ...spec,
    data: { ...spec.data, source: resolve(specDir, spec.data.source) },
  };
}

async function withEngine<T>(
  fn: (engine: Awaited<ReturnType<typeof createDuckDBEngine>>) => Promise<T>,
): Promise<T> {
  const engine = await createDuckDBEngine();
  try {
    return await fn(engine);
  } finally {
    await engine.close();
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdRender(args: string[]): Promise<number> {
  let specPath: string | undefined;
  let outPath: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--output") {
      outPath = args[++i];
    } else if (a === "--json") {
      json = true;
    } else if (!specPath && a) {
      specPath = a;
    }
  }
  if (!specPath) {
    process.stderr.write("glyph render: missing <spec.json>\n");
    return 1;
  }
  const spec = resolveSourcePaths(readSpec(specPath), specPath);

  // PR67 — hierarchy data bypasses DuckDB.
  let svg: string;
  if (spec.data?.hierarchy) {
    svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
  } else {
    svg = await withEngine(async (engine) => {
      const m = await materializeSpec(engine, spec);
      const scene = compileSpec({ spec, rows: m.result.rows, schema: m.handle.schema });
      return renderSvg(scene);
    });
  }

  if (outPath) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, svg, "utf8");
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: true, output: outPath })}\n`);
    } else {
      process.stdout.write(`Wrote ${outPath}\n`);
    }
  } else {
    process.stdout.write(svg);
  }
  return 0;
}

async function cmdDescribe(args: string[]): Promise<number> {
  let dataPath: string | undefined;
  let json = false;
  for (const a of args) {
    if (a === "--json") json = true;
    else if (!dataPath) dataPath = a;
  }
  if (!dataPath) {
    process.stderr.write("glyph describe: missing <data-file>\n");
    return 1;
  }

  const summary = await withEngine(async (engine) => {
    await engine.register({ source: resolve(dataPath) }, "src");
    return engine.describe("src");
  });

  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`${summary.rowCount} rows\n`);
    for (const c of summary.columns) {
      process.stdout.write(
        `  ${c.name.padEnd(24)} ${c.type.padEnd(16)} ${c.suggestedType.padEnd(13)} ~${c.distinct} distinct\n`,
      );
    }
  }
  return 0;
}

async function cmdQuery(args: string[]): Promise<number> {
  const [specPath, ...rest] = args;
  const sql = rest.join(" ").trim();
  if (!specPath || !sql) {
    process.stderr.write("glyph query: usage: glyph query <spec.json> <sql>\n");
    return 1;
  }
  const spec = resolveSourcePaths(readSpec(specPath), specPath);
  const result = await withEngine(async (engine) => {
    const m = await materializeSpec(engine, spec);
    return engine.queryHandle(m.handle, sql);
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        columns: result.columns.map((c) => c.name),
        rowCount: result.rowCount,
        rows: result.rows,
      },
      bigIntReplacer,
      2,
    )}\n`,
  );
  return 0;
}

/** JSON.stringify replacer that converts BigInt → Number (DuckDB BIGINT columns). */
function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

async function cmdCheck(args: string[]): Promise<number> {
  const [specPath, baselinePath] = args;
  if (!specPath || !baselinePath) {
    process.stderr.write("glyph check: usage: glyph check <spec.json> <baseline.svg>\n");
    return 1;
  }
  const spec = resolveSourcePaths(readSpec(specPath), specPath);
  const baseline = readFileSync(resolve(baselinePath), "utf8");
  const svg = await withEngine(async (engine) => {
    const m = await materializeSpec(engine, spec);
    const scene = compileSpec({ spec, rows: m.result.rows, schema: m.handle.schema });
    return renderSvg(scene);
  });
  if (svg === baseline) {
    process.stdout.write("OK — byte-identical\n");
    return 0;
  }
  process.stdout.write("DIFF — output does not match baseline\n");
  return 1;
}

// ---------------------------------------------------------------------------
// PR64 / PLAN 2.8 — Spec-as-code CI gate (`glyph diff`)
// ---------------------------------------------------------------------------

/**
 * `glyph diff` — emits a unified diff between the rendered SVG and a
 * baseline SVG checked into the repo. Exit codes match `git diff --exit-code`:
 *   0 = no diff
 *   1 = diff exists; output printed to stdout
 *   2 = invocation error
 *
 * Optional flags:
 *   --threshold N   — accept diffs of <= N changed lines (default 0)
 *   --output html   — emit a self-contained HTML side-by-side report
 *   --output md     — emit a Markdown block GitHub Action friendly
 *
 * Pure text diff; no pixel comparison (Glyph's snapshot byte-identity
 * makes that unnecessary — if the SVG bytes match, the pixels do too).
 */
async function cmdDiff(args: string[]): Promise<number> {
  let specPath: string | undefined;
  let baselinePath: string | undefined;
  let threshold = 0;
  let outputFormat: "diff" | "html" | "md" = "diff";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--threshold") threshold = Number(args[++i]) || 0;
    else if (a === "--output") {
      const v = args[++i];
      if (v === "html" || v === "md" || v === "diff") outputFormat = v;
    } else if (!specPath && a) specPath = a;
    else if (!baselinePath && a) baselinePath = a;
  }
  if (!specPath || !baselinePath) {
    process.stderr.write(
      "glyph diff: usage: glyph diff <spec.json> <baseline.svg> [--threshold N] [--output html|md|diff]\n",
    );
    return 2;
  }
  const spec = resolveSourcePaths(readSpec(specPath), specPath);
  const baseline = readFileSync(resolve(baselinePath), "utf8");
  const svg = await withEngine(async (engine) => {
    const m = await materializeSpec(engine, spec);
    const scene = compileSpec({ spec, rows: m.result.rows, schema: m.handle.schema });
    return renderSvg(scene);
  });
  if (svg === baseline) {
    process.stdout.write("OK — no diff\n");
    return 0;
  }
  const diff = unifiedDiff(baseline, svg, baselinePath, "rendered");
  const changedLines = diff
    .split("\n")
    .filter((l) => l.startsWith("+") || l.startsWith("-")).length;
  if (changedLines <= threshold) {
    process.stdout.write(`OK — ${changedLines} line(s) changed, within threshold ${threshold}\n`);
    return 0;
  }
  if (outputFormat === "html") {
    process.stdout.write(renderHtmlDiff(baseline, svg, baselinePath));
  } else if (outputFormat === "md") {
    process.stdout.write(
      `## Glyph chart diff: \`${baselinePath}\`\n\n\`\`\`diff\n${diff}\n\`\`\`\n`,
    );
  } else {
    process.stdout.write(diff);
  }
  return 1;
}

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
  // O(NM) DP. For SVG line diffs (a few hundred lines) this is fine.
  const n = a.length;
  const m = b.length;
  // Flat-indexed (n+1)×(m+1) DP grid; idx(i,j) = i*(m+1)+j.
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
// Dispatcher
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  switch (cmd) {
    case "render":
      return cmdRender(rest);
    case "describe":
      return cmdDescribe(rest);
    case "query":
      return cmdQuery(rest);
    case "check":
      return cmdCheck(rest);
    case "diff":
      return cmdDiff(rest);
    default:
      process.stderr.write(`glyph: unknown command '${cmd}'\n${HELP}`);
      return 1;
  }
}
