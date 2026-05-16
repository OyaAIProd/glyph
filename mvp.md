# Glyph — MVP Plan

> **One declarative spec. The data engine is in the chart.**
>
> Glyph is a chart-and-compute library where every visualization is a queryable in-memory database. Built on DuckDB and the grammar of graphics. Designed so an AI agent can write one spec, render it, query it back, and refine — without juggling a dataframe library and a chart library.

**Tagline candidates** (ranked by sharpness):
1. *"A chart is a query is a chart."* ← the one
2. *"Write a chart. Query the chart."*
3. *"The grammar of graphics, with the database inside."*

**License:** Apache 2.0. Non-negotiable.

---

## Table of contents

- [0. Why this exists (the wedge)](#0-why-this-exists-the-wedge)
- [1. User stories](#1-user-stories)
- [2. Competitive landscape](#2-competitive-landscape)
- [3. Architecture](#3-architecture)
- [4. Phased delivery](#4-phased-delivery)
- [5. Key goals (acceptance criteria)](#5-key-goals-acceptance-criteria)
- [6. API surface](#6-api-surface)
- [7. Eval, determinism & testing](#7-eval-determinism--testing)
- [8. Risks & mitigations](#8-risks--mitigations)
- [9. North-star metrics](#9-north-star-metrics)
- [10. Non-goals](#10-non-goals)

---

## 0. Why this exists (the wedge)

Today an AI agent doing data analysis juggles **three** tools that don't compose:

1. A dataframe library (pandas / polars / sql)
2. A chart library (matplotlib / vega-lite / plotly)
3. A glue layer (the agent's own code, often wrong)

Every chart trip costs tokens, breaks determinism, and loses state. The agent renders a chart, then to "filter to weekdays" it has to re-export, re-transform, re-render — losing the binding between the chart and the data behind it.

**Glyph collapses these into one artifact.** A `Glyph` is a JSON spec that describes data sources, SQL transforms, and a layered grammar-of-graphics encoding. Rendering it materializes an in-memory DuckDB table *plus* the chart. The chart carries a handle to its underlying view — the agent can query it back without re-uploading data.

That's the wedge. Not "AI-native viz." **Compute and viz in one declarative artifact, with a queryable handle.**

---

## 1. User stories

The MVP must credibly serve at least the first three on day one.

### S1 — Claude Code / Cursor user doing ad-hoc analysis *(primary wedge, biggest star source)*

> *As a developer using an AI coding agent, I want to drop a Parquet/CSV in and ask the agent to explore + chart it, without it shelling out to Python or juggling pandas + a plotting lib.*

**Flow:**
1. User: *"Look at `taxi.parquet` and find anomalies in fare distribution by hour."*
2. Agent calls `glyph.describe("taxi.parquet")` → schema, types, cardinalities, suggested encodings (~200 tokens).
3. Agent writes a Glyph spec → calls `glyph.render(spec)` → chart streams back inline with a query handle.
4. Agent calls `glyph.query(handle, "WHERE rides > 1000")` to drill in for the next turn — no re-upload, no re-compute.

**Why it wins stars:** This is the HyperFrames audience. Largest single source in 2025–2026.

---

### S2 — Notebook polyglot (Jupyter / Marimo / Observable)

> *As a data scientist, I want one chart spec that works in a Python notebook, a JS notebook, and a static report — same input, identical output.*

**Flow:** Same JSON spec rendered by `@glyph/core` (npm), `glyph` (PyPI), or `glyph` CLI. Identical SVG bytes across runtimes (determinism layer). Glyph becomes *the new ggplot for the polyglot era*.

---

### S3 — Agent eval engineer *(credibility wedge — small users, huge leverage)*

> *As an eval engineer, I run "can model X correctly visualize dataset Y" tests. I need deterministic, diffable, snapshot-testable output.*

**Flow:**
- `glyph render spec.json --check baseline.svg` returns 0/1 on byte-identity.
- Pinned DuckDB version, pinned fonts (shipped in-package), pinned toolchain.
- Snapshot corpus ships with every release.

**Why it matters:** Adoption by lab eval teams → citations in eval papers → compounding credibility.

---

### S4 — MCP-ecosystem agent author

> *As someone building an agent, I want a single MCP server that exposes both compute and viz — not 25 closed-taxonomy chart tools.*

**Flow:** Three tools total: `describe`, `render`, `query`. ~500 tokens of definitions. Composes to any chart.

**Why it wins:** antv-mcp plateaued at 4k stars because closed-taxonomy MCPs hit a ceiling. Open-grammar + engine breaks past it.

---

### Deferred (post-MVP)

- **S5** Dashboard / embedded SaaS analytics
- **S6** Data journalist / Observable Plot replacement
- **S7** R bindings, ggplot interop
- **S8** Interactive brushing, animations, geo projections beyond lat/lon

---

## 2. Competitive landscape

Honest table. Cells marked ✅ = wins, ⚠️ = partial, ❌ = doesn't have it. Updated 2026-05-16.

| Project | Stars | Grammar | Engine inside | Agent skills | MCP | Determinism | Library (not app) | License |
|---|---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **Glyph** *(target)* | — | ✅ Wickham layered | ✅ DuckDB | ✅ day-one | ✅ 3-tool | ✅ byte-identical | ✅ | Apache 2.0 |
| Vega-Lite | ~14k | ✅ Wilkinson-ish | ❌ | ❌ | ❌ | ⚠️ | ✅ | BSD-3 |
| ggplot2 | ~6.9k | ✅ Wickham | ❌ (R deps) | ❌ | ❌ | ⚠️ | ✅ | MIT |
| Observable Plot | ~4k | ✅ thin | ❌ | ❌ | ❌ | ❌ | ✅ | ISC |
| Apache ECharts | ~66k | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | Apache 2.0 |
| D3 | ~110k | ❌ (toolkit) | ❌ | ❌ | ❌ | ❌ | ✅ | ISC |
| plotly.js | ~18k | ⚠️ traces | ❌ | ❌ | ❌ | ❌ | ✅ | MIT |
| recharts | ~27k | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | MIT |
| MS Data Formulator | ~15.1k | ✅ (Vega-Lite) | ⚠️ (Python backend) | ❌ | ❌ | ❌ | ❌ *(app)* | MIT |
| finos/Perspective | ~9k | ❌ | ✅ C++ | ❌ | ❌ | ❌ | ✅ | Apache 2.0 |
| antv mcp-server-chart | ~4k | ❌ (25 tools) | ❌ | ⚠️ | ✅ but bloated | ❌ | ✅ | MIT |
| DuckPlot, Mosaic | <3k | ⚠️ | ✅ DuckDB | ❌ | ❌ | ❌ | ✅ | MIT |
| HyperFrames *(non-viz, ref pattern)* | ~15.7k | n/a (HTML→video) | n/a | ✅ | n/a | ✅ | ✅ | Apache 2.0 |

**Cells where competitors beat us at launch (be honest):**
- ECharts has a much wider chart taxonomy than what our MVP grammar will cover.
- Vega-Lite has 7 years of LLM training data — agents already know it.
- D3 wins for bespoke / one-off visualizations.
- Perspective wins for live-streaming pivot tables.

**Where we win (and why nobody else does):**
- Only project that ships **(a) grammar + (b) embedded engine + (c) agent-native skills + (d) MCP-as-library** in one artifact.
- Only project with a **query-back handle** on the rendered chart.

---

## 3. Architecture

### 3.1 Stack decision — TypeScript-first, Rust later

| Phase | Core language | Reason |
|---|---|---|
| **Phase 0–1 (MVP)** | TypeScript | DuckDB-WASM + Arrow-JS are mature; single codebase runs Node + browser; fastest path to wedge demo; lowest contributor friction |
| **Phase 2** | Rust core via `napi-rs` + `wasm-bindgen` | Reach Python; hot-path perf; one binary CLI |

This mirrors the proven Vega → Vega-Lite → vl-convert and Polars (Python-first) → Rust-core trajectories. Ship TS, port hot paths once the spec stabilizes.

### 3.2 Layered overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Distribution surface                                            │
│   Skills (Claude Code, Cursor, Codex, Gemini CLI)               │
│   MCP server  |  CLI  |  npm pkg  |  PyPI (Phase 2)             │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│ Spec (JSON, the only thing agents write)                        │
│   • data: sources, schema, transforms (SQL)                     │
│   • layers: [ { mark, encoding, stat?, position? } ... ]        │
│   • scales, coords, facets, theme  (all inferable; optional)    │
└─────────────────────────────────────────────────────────────────┘
                                │
                  Spec compiler (TS, public AST)
                                │
        ┌──────────────────────┴──────────────────────┐
        │                                              │
┌───────────────────┐                       ┌────────────────────┐
│ Compute pipeline  │  Arrow IPC zero-copy  │ Render pipeline    │
│  DuckDB-WASM      │ ◀───────────────────▶ │  SVG (Phase 0)     │
│  + Arrow JS       │                       │  Canvas (Phase 1)  │
│  in-process       │                       │  WebGL (Phase 2)   │
└───────────────────┘                       └────────────────────┘
                                │
                       Determinism layer
              (pinned versions, snapshot baseline, hash)
```

### 3.3 Key architectural decisions

1. **Embed DuckDB; never write our own engine.** DuckDB-WASM is faster than anything we'd build, has Iceberg/Parquet/JSON/geo extensions, and ships to browser. Glyph is *spec + grammar renderer + thin harness around DuckDB*. The fame is in the spec; the speed is in DuckDB.
2. **Apache Arrow end-to-end.** Zero-copy between DuckDB and the render pipeline. Enables million-row scatter in-browser.
3. **Public spec AST with Zod validators.** JSON → validated AST → (a) Arrow query plan, (b) render scenegraph. Both sides introspectable. The rendered chart carries a `QueryHandle` to its materialized view — that's what enables `glyph.query(handle, ...)`.
4. **Wickham's layered grammar.** Each `layer = { data?, mark, encoding, stat?, position? }`. Layers compose. Scales, coords, facets, themes are top-level. Small enough for an LLM tool description, expressive enough to draw anything.
5. **Multi-renderer behind one scenegraph.**
   - **SVG** (Phase 0) — ≤10k marks, sharp, accessible, snapshot-friendly.
   - **Canvas** (Phase 1) — 10k–500k marks.
   - **WebGL** (Phase 2) — >500k marks, via regl.
   - Same scenegraph, different backends. Server-side SVG works without a headless browser — critical for chat surfaces.
6. **Determinism is a feature.** Pin DuckDB version, pin font files (shipped in-package), pin toolchain. `glyph render --check` enforces byte-identity. Snapshot corpus ships with every release.
7. **MCP server: three tools only.** Total tool-definition payload <600 tokens. Composes to infinite charts via the grammar.

### 3.4 MCP tool surface (the entire library)

| Tool | Purpose | Tokens (target) |
|---|---|---:|
| `glyph.describe(data_ref)` | Returns schema, types, cardinalities, suggested encodings | ~150 |
| `glyph.render(spec)` | Compiles + renders; returns chart artifact + query handle | ~200 |
| `glyph.query(handle, sql)` | Queries rendered chart's view to drill in / extract for next turn | ~120 |

Compare antv-mcp: 26 tools, ~6k tokens, closed taxonomy. We hit ~470 tokens, infinite expressiveness.

### 3.5 Example spec (the wire format)

```json
{
  "data": {
    "source": "taxi.parquet",
    "transform": "SELECT pickup_hour, AVG(fare) AS avg_fare, COUNT(*) AS rides FROM taxi GROUP BY pickup_hour"
  },
  "layers": [
    { "mark": "bar",  "encoding": { "x": "pickup_hour", "y": "rides" } },
    { "mark": "line", "encoding": { "x": "pickup_hour", "y": "avg_fare", "scale": "right" } }
  ]
}
```

Same wire format across Node, browser, CLI. Rendered output carries a query handle.

### 3.6 Repo layout

```
glyph/
├── packages/
│   ├── core/                 # @glyph/core — spec AST, compiler, scenegraph, SVG renderer
│   ├── duckdb/               # @glyph/duckdb — DuckDB-WASM harness, Arrow plumbing
│   ├── cli/                  # @glyph/cli — `glyph render | describe | query | check`
│   ├── mcp/                  # @glyph/mcp — MCP server (3 tools)
│   ├── canvas/               # @glyph/canvas — Canvas renderer (Phase 1)
│   └── webgl/                # @glyph/webgl — WebGL renderer (Phase 2)
├── skills/
│   ├── glyph/                # top-level skill (Claude Code, Cursor, Codex, Gemini)
│   ├── glyph-cli/
│   └── glyph-mcp/
├── examples/                 # ~25 canonical specs (taxi, gapminder, iris, ...)
├── snapshots/                # determinism baseline corpus (.svg)
├── docs/                     # docs site (Astro or Nextra)
├── .claude-plugin/
├── .cursor-plugin/
├── .codex-plugin/
├── .github/workflows/        # CI (lint, test, snapshot, publish)
├── LICENSE                   # Apache 2.0
├── README.md
└── mvp.md                    # this file
```

---

## 4. Phased delivery

| Phase | Window | What ships | Star expectation |
|---|---|---|---:|
| **0 — Wedge demo** | weeks 1–3 | Spec format, DuckDB harness, SVG renderer (bar/line/point/area/rect), CLI, MCP (3 tools), Claude Code skill, snapshot tests, 5 canonical examples, comparison post | 500–2k |
| **1 — Grammar fill-in** | weeks 4–6 | Stats (`bin`, `count`, `mean`, ...), facets, full Vega-Lite-25 coverage, Canvas renderer, Cursor + Codex + Gemini skills | 2k–5k |
| **2 — Reach** | weeks 7–12 | Python bindings via pyodide-bridge or Rust core, WebGL renderer, Jupyter widget, docs site, eval-corpus paper | 5k–10k+ |

---

## 5. Key goals (acceptance criteria)

Each goal is shippable, demoable, honest.

### G1 — Spec format & compiler *(Phase 0)*
- [ ] JSON schema published.
- [ ] Zod-validated AST.
- [ ] Compiler: spec → AST → (Arrow query plan, scenegraph).
- [ ] **Acceptance:** Round-trip 25 example specs without information loss.

### G2 — DuckDB-WASM integration *(Phase 0)*
- [ ] Load Parquet/CSV/JSON sources.
- [ ] Execute SQL transforms.
- [ ] Stream results as Arrow tables.
- [ ] **Acceptance:** `glyph render examples/taxi.json` produces SVG locally in <500 ms on 100k rows.

### G3 — Layered grammar — Phase 0 marks
- [ ] Marks: `bar`, `line`, `point`, `area`, `rect`.
- [ ] Encodings: `x`, `y`, `color`, `size`, `opacity`, `tooltip`.
- [ ] Linear, ordinal, time scales.
- [ ] **Acceptance:** Reproduces top-5 Vega-Lite examples with ≥8× tighter specs.

### G4 — SVG renderer *(Phase 0)*
- [ ] Scenegraph → SVG string.
- [ ] Pure function (no DOM dependency).
- [ ] Pinned font (Inter, shipped in-package).
- [ ] **Acceptance:** Same spec → same bytes on Linux + macOS + Windows × Node + browser.

### G5 — Determinism layer *(Phase 0)*
- [ ] `glyph render --check <spec> <baseline.svg>` returns 0/1.
- [ ] Snapshot corpus ≥5 specs in Phase 0, ≥50 by Phase 2.
- [ ] **Acceptance:** CI matrix (3 OS × Node 20/22) all pass byte-identity.

### G6 — MCP server with three tools *(Phase 0)*
- [ ] `glyph.describe`, `glyph.render`, `glyph.query`.
- [ ] Query handles persist across calls within a session.
- [ ] **Acceptance:** Tool-definition payload <600 tokens; agent loads `taxi.parquet`, describes, renders 3 charts, queries 1 drill-in — all in one MCP session.

### G7 — CLI *(Phase 0)*
- [ ] `glyph render <spec> [-o file]`.
- [ ] `glyph describe <data>`.
- [ ] `glyph query <spec> <sql>`.
- [ ] `glyph check <spec> <baseline>`.
- [ ] **Acceptance:** `npx @glyph/cli render examples/taxi.json` works out of box.

### G8 — Day-one Claude Code skill *(Phase 0)*
- [ ] `skills/glyph/SKILL.md` — when to invoke, spec shape, common patterns, error recovery.
- [ ] Plugin manifest in `.claude-plugin/`.
- [ ] **Acceptance:** Install via `npx @glyph/skills add` works in Claude Code.

### G9 — Launch artifacts *(Phase 0)*
- [ ] Comparison table in README (Section 2 above, kept honest).
- [ ] Landing-page demo: paste CSV → agent authors spec → render → click → `glyph.query` drills in.
- [ ] Launch post: *"We collapsed pandas + Vega-Lite into one artifact."*
- [ ] **Acceptance:** Show HN + X post + skill listing live on the same day.

### G10 — Honesty floor (will NOT claim at MVP)
- Not a full Vega-Lite replacement (no selections, animations, custom themes).
- Not a Tableau replacement (no GUI, no warehouse pushdown beyond DuckDB extensions).
- Not a notebook IDE (integrates, doesn't replace).
- Not a R/ggplot port (planned post-MVP).

---

## 6. API surface

### TypeScript

```ts
import { render, describe, query } from "@glyph/core";

const artifact = await render({
  data: { source: "taxi.parquet", transform: "SELECT ..." },
  layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
});

artifact.svg;          // string
artifact.handle;       // QueryHandle — can be passed to query()
artifact.scenegraph;   // public AST

const rows = await query(artifact.handle, "WHERE rides > 1000");
```

### CLI

```bash
glyph render examples/taxi.json -o taxi.svg
glyph describe taxi.parquet
glyph query examples/taxi.json "WHERE rides > 1000"
glyph check examples/taxi.json snapshots/taxi.svg
```

### MCP

```json
{
  "name": "glyph.render",
  "description": "Compile and render a Glyph spec. Returns SVG + a query handle...",
  "inputSchema": { /* ... */ }
}
```

---

## 7. Eval, determinism & testing

- **Snapshot corpus.** Hand-curated, ≥5 specs Phase 0, ≥50 Phase 2. Each has a baseline `.svg` checked into the repo. CI diffs bytes.
- **Property tests.** Spec round-trip (parse → serialize → parse), AST validity, query handle stability.
- **Eval pack.** A small `glyph-eval` package: feed an LLM a dataset + task, score the resulting spec on (a) parses, (b) renders, (c) answers the task. Run quarterly against Sonnet/Opus/GPT/Gemini.
- **No telemetry.** Period. The library never phones home. Stated explicitly in README. (This earns trust with the eval-engineer audience and lab teams.)

---

## 8. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| MS Data Formulator pivots to a library | medium | high | Move fast; ship MCP + skills Phase 0; lock in agent ecosystem |
| DuckDB-WASM bundle size hurts adoption | medium | medium | Lazy-load engine; offer slim build without engine for "pure spec" use cases |
| Vega-Lite training data gives it permanent agent-default status | high | medium | Ship a Vega-Lite → Glyph compatibility shim in Phase 1 |
| Determinism breaks across platforms (font metrics, locale) | medium | high | Ship our own font; lock locale to `C`; CI on 3 OS |
| "Yet another viz library" perception | high | high | Sharp wedge: *"a chart is a query is a chart"*; demo the query-back moment |
| Closed-source agents add their own viz primitives | medium | medium | MCP-first means we work alongside, not against, vendor primitives |

---

## 9. North-star metrics

| Metric | Phase 0 target | Phase 1 target | Phase 2 target |
|---|---:|---:|---:|
| GitHub stars | 500 | 2,500 | 10,000 |
| Weekly `@glyph/core` downloads | 100 | 1,000 | 10,000 |
| MCP installs (Claude Code skill) | 50 | 500 | 3,000 |
| Snapshot corpus size | 5 | 25 | 50 |
| Vega-Lite-25 coverage | 5/25 | 25/25 | 25/25 + extensions |
| Median spec token count vs Vega-Lite equivalent | 8× tighter | 10× tighter | 10× tighter |

---

## 10. Non-goals

Explicit non-goals — to keep the wedge sharp:

- Not a general-purpose dataframe library (no `pandas` replacement; DuckDB is the engine).
- Not a BI dashboard tool (no auth, no permissions, no scheduled refresh).
- Not a real-time streaming chart (no websocket bindings; Perspective owns that).
- Not a custom DSL (JSON only; no YAML, no Python decorators in core).
- Not an SVG editor (no post-render manipulation; re-render from spec).
- Not a feature-flag platform, not a CMS, not auth. Glyph does one thing.

---

## Bottom-line gating criteria for MVP launch

MVP ships if and only if all five hold:

1. **End-to-end S1 flow works** in a single Claude Code session: `describe → render → query → render-again`.
2. **Comparison table is honest** — every "we win" cell is independently verifiable, every "they win" cell acknowledged.
3. **Determinism holds**: snapshot corpus renders byte-identically across Linux/macOS/Windows × Node 20/22.
4. **Token budget**: MCP tool surface <600 tokens; median spec ≥8× tighter than Vega-Lite equivalent.
5. **License Apache 2.0**; Claude Code skill live on launch day.

If any of these slip, the MVP is not done. The launch window closes fast — HyperFrames showed the slope is ~3 months from launch to 10k stars when the wedge is sharp and the agent-distribution play is executed.
