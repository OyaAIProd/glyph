# @glyph/mcp

Glyph MCP server — 49 verbs for deterministic chart rendering, query, audit, anomaly, forecast, decompose, explain, story planning, and Whyboard analytics.

Listed in the official [MCP Registry](https://registry.modelcontextprotocol.io/?search=glyph) as `io.github.seanhanca/glyph`.

## Install

```bash
npx -y @glyph/mcp
```

Register with Claude Code:

```bash
claude mcp add glyph -- npx -y @glyph/mcp
```

Register with Codex CLI — add to `~/.codex/config.toml`:

```toml
[mcp_servers.glyph]
command = "npx"
args = ["-y", "@glyph/mcp"]
```

## Identifiers

- **npm**: [`@glyph/mcp`](https://www.npmjs.com/package/@glyph/mcp)
- **MCP Registry**: `io.github.seanhanca/glyph`
- **Transport**: stdio

## The 49 verbs

A representative slice — get the full list via `glyph_capabilities`:

| Category | Verbs |
|---|---|
| Data + render | `glyph_describe`, `glyph_render`, `glyph_query`, `glyph_drill`, `glyph_import` |
| Analysis | `glyph_anomaly`, `glyph_forecast`, `glyph_decompose`, `glyph_drift`, `glyph_regression`, `glyph_causal_graph` |
| Audit + trust | `glyph_audit_spec`, `glyph_trust`, `glyph_audit_log` |
| Story + narrative | `glyph_story_plan`, `glyph_story_execute`, `glyph_explain`, `glyph_whyboard`, `glyph_whyboard_diff` |
| Spec editing | `glyph_spec_diff`, `glyph_spec_patch`, `glyph_suggest_scale`, `glyph_morph_render` |
| Memory + state | `glyph_memory_save`, `glyph_memory_recall`, `glyph_handles`, `glyph_publish`, `glyph_subscribe`, `glyph_lineage` |

## What makes it different

- **Deterministic** — same spec → byte-identical SVG, every time
- **Embedded DuckDB** — charts are queryable; click → SQL
- **No LLM at runtime** — every verb is a pure function
- **Apache 2.0**, no telemetry

Full docs: [github.com/seanhanca/glyph](https://github.com/seanhanca/glyph)
