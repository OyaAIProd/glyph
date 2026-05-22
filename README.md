# Glyph

> Deterministic charts for AI agents. Embedded DuckDB. 50 MCP verbs. Byte-stable SVG.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-679%20passing-brightgreen.svg)](#status)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](#requirements)
[![No telemetry](https://img.shields.io/badge/telemetry-none-brightgreen.svg)](#license)

A TypeScript chart-and-compute library where charts are JSON specs an LLM can author, diff, and patch. Compilation is a pure function. SVG output is identical across runs, OSes, and Node versions. The 50-verb MCP server is the primary API.

**[Try Glyph in your browser →](https://seanhanca.github.io/glyph/play/)** — paste a CSV, edit a spec, watch the chart + audit findings + trust score update live. Share via URL or GitHub Gist. No install.

**[Quickstart](#quickstart)** · **[Playground](https://seanhanca.github.io/glyph/play/)** · **[Interactive docs](./site/index.html)** · **[Examples](#examples)** · **[Comparison](#comparison)** · **[Packages](#packages)**

> 🌐 **Want the full tour?** Open [`site/index.html`](./site/index.html) in your browser — it's a single static page with a playground, 8 animated demos, 9 visualized innovations, a 16-row comparison matrix, and side-by-side Claude / Codex setup. No build step, no server. See [Interactive docs](#interactive-docs) below for one-line ways to open it.

## Joy of Math — one MCP call → an animated math story your kid can watch

This is what an LLM agent can ship today, in one call, from a single sentence of intent:

> **You:** "Show me a sine wave for an 8-year-old."
>
> **Claude:** _calls `glyph_story({ intent: "show me a sine wave", audience: "kid" })`_

What comes back is not prose. It's a self-contained animated SVG — composed deterministically, no LLM in the render loop. The curve draws itself. A traveling dot follows it. A peak gets labeled. Captions fade in. The same prompt, run a year from now, produces the same bytes:

<p align="center">
<img alt="Sine wave for an 8-year-old — animated SVG composed by glyph_story" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/story/sine-wave-for-an-8yo.svg" width="640">
</p>

> ↑ This is a live SMIL-animated SVG. **GitHub renders the animation in your browser as you scroll past it** — no JS, no CDN, no embed code. Same artifact a Claude Desktop user gets back from `glyph_story`. [View raw](https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/story/sine-wave-for-an-8yo.svg) · [JSON spec](./packages/core/__fixtures__/story/sine-wave-for-an-8yo.json)

### Eight more, all rendered by the same pipeline

Every image below is a real fixture in this repo, locked at byte-identity by tests in CI. Click any image to open the raw animated SVG.

<table>
<tr>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/timeline/circle-circumference.svg">
    <img alt="Circle → 2πr unwrap (E3 timeline)" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/timeline/circle-circumference.svg" width="100%">
  </a>
  <br><sub><b>Multi-scene timeline (E3)</b><br>Circle → radius → 2πr unwrap</sub>
</td>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/traveler/sine-traveler.svg">
    <img alt="Sine wave with traveling dot (E2 traveler)" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/traveler/sine-traveler.svg" width="100%">
  </a>
  <br><sub><b>Traveler mark (E2)</b><br>SMIL <code>animateMotion</code> dot</sub>
</td>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/draw-in-spiral.svg">
    <img alt="Archimedean spiral drawing itself (A2 draw-in)" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/draw-in-spiral.svg" width="100%">
  </a>
  <br><sub><b>Pen-draw animation (A2)</b><br>Archimedean spiral, dash-offset trick</sub>
</td>
</tr>
<tr>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/streamline-rotation.svg">
    <img alt="Vector field streamlines via RK4 (A3)" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/streamline-rotation.svg" width="100%">
  </a>
  <br><sub><b>Streamlines (A3)</b><br>RK4-integrated <code>dx/dt=-y, dy/dt=x</code></sub>
</td>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/bezier-cubic.svg">
    <img alt="Cubic Bezier with de Casteljau construction (A5)" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/bezier-cubic.svg" width="100%">
  </a>
  <br><sub><b>Bezier construction (A5)</b><br>De Casteljau overlay at <code>t=0.5</code></sub>
</td>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/lissajous.svg">
    <img alt="Lissajous curve (math.shape: trajectory)" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/math/lissajous.svg" width="100%">
  </a>
  <br><sub><b>Parametric curve</b><br>Lissajous: <code>x=sin(3t), y=cos(2t)</code></sub>
</td>
</tr>
<tr>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/annotation/peak-callout.svg">
    <img alt="Peak callout annotation (E1)" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/annotation/peak-callout.svg" width="100%">
  </a>
  <br><sub><b>Annotation mark (E1)</b><br>Pin a chart fact with a labeled arrow</sub>
</td>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/brand/threeblueone-brown.svg">
    <img alt="3Blue1Brown-style chalkboard preset (E4)" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/brand/threeblueone-brown.svg" width="100%">
  </a>
  <br><sub><b>BrandKit preset (E4)</b><br><code>theme: "3b1b"</code> — chalkboard + Cardo</sub>
</td>
<td width="33%" valign="top" align="center">
  <a href="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/brand/playground-preset.svg">
    <img alt="Playground kid preset (E4)" src="https://raw.githubusercontent.com/seanhanca/glyph/main/packages/core/__fixtures__/brand/playground-preset.svg" width="100%">
  </a>
  <br><sub><b>BrandKit preset (E4)</b><br><code>theme: "playground"</code> — kid-bright</sub>
</td>
</tr>
</table>

### Try it from Claude in 30 seconds

```bash
claude mcp add glyph -- npx -y @glyph/mcp
```

Then ask Claude:

> Use glyph_story to show me a sine wave for an 8-year-old. Save the SVG to ./sine.svg.

Open `sine.svg` in any browser. Curve draws, dot travels, caption fades, annotation lands — all from one MCP call, all deterministic, all in a single self-contained file you can email to a kid.

The same `glyph_story` verb supports 5 recipes today (`sine`, `cosine`, `circle`, `parabola`, `vector field`) and 3 audiences (`kid`, `high-school`, `adult`). Adding a recipe is one object literal in [`packages/core/src/story/compose.ts`](./packages/core/src/story/compose.ts) — no architectural surface, no LLM in the render loop, no surprise behavior in CI.

**→ Full kid landing page** with sliders + prompt portal + the same demos in 3D via three.js: [`site/forkids.html`](./site/forkids.html) — open the file directly, or [view it inline via htmlpreview](https://htmlpreview.github.io/?https://github.com/seanhanca/glyph/blob/main/site/forkids.html). _([Live URL once GitHub Pages is enabled](https://seanhanca.github.io/glyph/forkids.html) — repo admin: **Settings → Pages → Source: GitHub Actions** to flip it on.)_

## Quickstart

### 1. Use it with Claude Code

```bash
claude mcp add glyph -- npx -y @glyph/mcp
```

Open Claude Code and ask:

> Render a bar chart of rides.csv by hour.

The agent calls `glyph_describe`, then `glyph_render`. You get back an SVG, a queryable handle, and a one-line summary.

### 2. Use it with Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.glyph]
command = "npx"
args = ["-y", "@glyph/mcp"]
```

Works the same for Cursor, Copilot CLI, and Gemini CLI — anything that speaks MCP.

### 3. Use it as a TypeScript library

```bash
npm install @glyph/core @glyph/duckdb
```

```ts
import { compileSpec, renderSvg } from "@glyph/core";
import { createDuckDBEngine, materializeSpec } from "@glyph/duckdb";

const engine = await createDuckDBEngine();
const m = await materializeSpec(engine, {
  data: { source: "rides.csv", format: "csv" },
  layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
});

const scene = compileSpec({
  spec: m.effectiveSpec,
  rows: m.result.rows,
  schema: m.handle.schema,
});

const svg = renderSvg(scene); // identical bytes, every time
```

## Interactive docs

The README covers the essentials. For the rich version — playground, animated demos, full comparison matrix — open the single-file HTML site:

```bash
# Open it directly (macOS)
open site/index.html

# Open it directly (Linux)
xdg-open site/index.html

# Or serve it locally on http://localhost:8000
python3 -m http.server -d site
#   or
npx -y serve site
```

It's a single static HTML file. No build step, no server required for `file://` opening. Deploys to GitHub Pages, Vercel, Netlify, or any static host with zero config.

What's there that isn't here:

| Section in [`site/index.html`](./site/index.html) | What you'll find |
| ------------------------------------------------- | ---------------- |
| **Playground**       | 5 preset charts (bar/line/area/scatter/pie). Click to swap the spec and the compiled SVG. |
| **8 visual demos**   | Streamgraph morph, cross-agent lineage, chart+table+narrative triptych, racing bars, chart auditor, JSON Patch live edit, geo map + anomaly overlay, causal DAG with cycle refusal. All animated SVG, no JS. |
| **Examples gallery** | 15 chart types side-by-side with their specs: heatmap, choropleth, treemap, sunburst, force graph, contour, radial line, ... |
| **Use cases**        | 6 agent-native scenarios with verb snippets: analysis loop, multi-agent collab, audit-grade reporting, reproducible research, interactive notebooks, PR review for data. |
| **9 innovation cards** | Visualized: byte-stability, uncertainty rendering, spec diff/patch, streaming progress, disambiguation, local-only telemetry, handle TTL + reaper, macro replay, LLM-pluggable story agent. |
| **55-capability matrix** | Full taxonomy of what Glyph ships that nobody else does, by tier (Architectural / Capability / Ergonomics). |
| **Comparison**       | Same matrix as below, expanded to 16 rows with legend + notes. |

## Why

Charting libraries were built for humans writing code. When agents use them, three things break:

1. **Imperative APIs (D3, Plotly)** — the LLM writes 200 lines of JS and ships bugs.
2. **Non-deterministic output** — browser float drift means snapshot tests are flaky.
3. **No analytic verb surface** — anomaly, forecast, audit are separate libraries the agent has to glue together.

Glyph collapses these:

- The spec is canonical JSON. Agents diff it, patch it, version-control it.
- The pipeline is a pure function. Same spec produces the same SVG bytes.
- Every analytic primitive is an MCP verb. `render`, `drill`, `query`, `audit`, `anomaly`, `forecast`, `decompose`, `explain`, `story_plan`, `whyboard`, `spec_diff`, `spec_patch`, `morph_render`, `macro_replay`, ...

## Features

- **11 mark types**: `bar`, `line`, `point`, `area`, `rule`, `arc`, `treemap`, `sunburst`, `force`, `contour`, `text`
- **4 data shapes**: tabular, hierarchy, graph, grid
- **2 renderers**: SVG (server) and Canvas (browser), sharing one scene graph
- **50 MCP verbs** for agents to chain
- **Embedded DuckDB** — query a chart's underlying view without a server round-trip
- **Built-in chart auditor** — 8 rules catching deceptive charts at compile time (truncated axes, dual-y mismatch, log-zero, small-n, ...)
- **Uncertainty rendering** — low-n samples auto-hatch and ship a confidence badge
- **Cross-process lineage** via `gdf://` URIs — agents hand off charts with full provenance
- **Spec diff / patch (RFC 6902)** — review chart changes as JSON in a PR
- **Animation as a spec field** — `stage`, `stage-stagger`, `race`, `morph` all compile to SMIL, no JS at runtime
- **679 snapshot tests** across a 6-cell CI matrix (Node 20/22 × Linux/macOS/Windows)
- **Apache 2.0** — no telemetry, runs entirely on your machine

## Examples

### Audit a chart while you render it

```ts
const { svg, audit, trust } = await glyph_audit({ spec });
// audit.findings: [
//   { rule: "truncated_y_axis", severity: "error", fix: "set y.zero = true" },
//   { rule: "small_sample",     severity: "warn",  ... }
// ]
// trust.score: 47 / 100
```

### Cross-agent collaboration

```ts
// Process A
const { uri } = await glyph_render(spec); // → "gdf://abc/src"

// Process B (different process, possibly a different LLM)
await glyph_subscribe(uri);
const { uri: drilled } = await glyph_drill(uri, { field: "z", from: 3, to: 99 });

// Process C
const narrative = await glyph_explain(drilled);
// glyph_lineage(narrative.uri) walks back to "uri" in 3 hops
```

### Animation as a spec field

```json
{
  "data": { "source": "gdp.parquet" },
  "layers": [{ "mark": "bar", "encoding": { "x": "gdp", "y": "country" } }],
  "animation": { "kind": "race", "frame_field": "year", "duration_ms": 8000 }
}
```

Compiles to a single SVG with SMIL `<animate>` per mark. Works in email, GitHub README previews, slides, and PDF.

### Spec diff and patch

```ts
const patch = await glyph_spec_diff(a, b);
// [
//   { op: "replace", path: "/layers/0/mark",     value: "area" },
//   { op: "add",     path: "/encoding/opacity",  value: 0.75 }
// ]

const next = await glyph_spec_patch(a, patch);
await glyph_morph_render({ spec_a: a, spec_b: next, duration_ms: 5000 });
```

### Reproducible figures in CI

```bash
$ vitest run
✓ 679 snapshot tests, byte-identical across Node 20/22 × Linux/macOS/Windows
```

Check the spec into git. Snapshot the SVG. Years later, rerun and the bytes match.

## How it works

```
                ┌──────────────┐
                │  JSON spec   │
                └──────┬───────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   materializer    compiler        auditor
   (DuckDB)       (pure fn)       (8 rules)
        │              │              │
        └──────────────┼──────────────┘
                       ▼
              ┌────────────────┐
              │  scene graph   │  (immutable IR)
              └───────┬────────┘
                      │
              ┌───────┴───────┐
              ▼               ▼
          SVG (server)    Canvas (browser)
```

Every box is a pure function: same input, same output, no global state. The MCP server wraps the pipeline in an addressable handle protocol (`gdf://`) so handles flow between processes with full lineage.

## Comparison

| Feature                            | D3            | Vega-Lite | Plotly  | Tableau     | Power BI    | Glyph         |
| ---------------------------------- | ------------- | --------- | ------- | ----------- | ----------- | ------------- |
| Deterministic byte-stable output   | no            | partial   | no      | no          | no          | **yes**       |
| Embedded SQL engine                | no            | no        | no      | proprietary | proprietary | **DuckDB**    |
| MCP server (agent-native)          | no            | no        | no      | no          | no          | **50 verbs**  |
| Built-in chart auditor             | no            | no        | no      | no          | no          | **8 rules**   |
| Uncertainty rendering by default   | no            | no        | bars    | no          | no          | **yes**       |
| Cross-process chart lineage        | no            | no        | no      | in-product  | in-product  | **gdf://**    |
| Spec diff / patch (RFC 6902)       | no            | no        | no      | no          | no          | **yes**       |
| Animation as a declarative spec    | no            | no        | partial | partial     | partial     | **4 kinds**   |
| Mark types built in                | primitives    | 14        | 30+     | 25+         | 30+         | 11            |
| License                            | BSD-3         | BSD-3     | MIT     | Proprietary | Proprietary | **Apache 2.0**|

Full 16-row matrix at [`site/index.html#compare`](./site/index.html).

## Packages

| Package                  | What it does                                    | npm                          |
| ------------------------ | ----------------------------------------------- | ---------------------------- |
| `@glyph/core`            | Compiler, scene graph, SVG renderer             | `npm i @glyph/core`          |
| `@glyph/duckdb`          | DuckDB-backed materializer                      | `npm i @glyph/duckdb`        |
| `@glyph/canvas`          | Canvas renderer (same scene graph as SVG)       | `npm i @glyph/canvas`        |
| `@glyph/mcp`             | MCP server, 50 verbs                            | `npx -y @glyph/mcp`          |
| `@glyph/cli`             | `glyph diff` and friends                        | `npm i -g @glyph/cli`        |
| `@glyph/live`            | Browser-side hydration for interactive specs    | `npm i @glyph/live`          |
| `@glyph/preview-server`  | Local preview for Cursor / Jupyter              | `npm i @glyph/preview-server`|

## Documentation

**Primary**: [`site/index.html`](./site/index.html) — the full interactive docs. Run `open site/index.html` or `npx -y serve site`. See [Interactive docs](#interactive-docs) above for what's in there.

**Specs and reference**:

- [`INNOVATION.md`](./INNOVATION.md) — the 18 shipped innovations
- [`D3-COMPARISON.md`](./D3-COMPARISON.md) — architectural comparison with D3
- [`AUDIT.md`](./AUDIT.md) — competitive scorecard
- [`ROADMAP.md`](./ROADMAP.md) — what's next
- [`skills/`](./skills) — IDE skill files for Claude, Cursor, Copilot CLI, Gemini

## Status

- v0.0.20 on `main`
- 679 tests passing
- 50 MCP verbs
- 7 packages
- 11 mark types, 4 data shapes
- Linux / macOS / Windows × Node 20 / 22 — green on every push

## Requirements

- Node ≥ 20
- For the DuckDB engine: macOS (Apple Silicon or Intel), Linux x64, or Windows x64

## Contributing

PRs welcome. The project uses pnpm workspaces, Biome for linting, and vitest for tests.

```bash
git clone https://github.com/seanhanca/glyph
cd glyph
pnpm install
pnpm test
```

See [`ROADMAP.md`](./ROADMAP.md) for what's planned, and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow.

## License

[Apache 2.0](./LICENSE). No telemetry. No phone-home. Self-hostable. Audit-safe by default.
