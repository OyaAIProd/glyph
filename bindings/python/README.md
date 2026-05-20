# Glyph — Python bindings

Deterministic chart compiler. 49 agent-callable verbs. Embedded DuckDB. Byte-stable SVG.

## Install

```bash
pip install glyph-charts
```

Requires Node.js >= 20 on PATH (the package shells out to the bundled MCP server).

## Quickstart

```python
import pandas as pd
import glyph

df = pd.read_csv("rides.csv")
result = glyph.render({
    "layers": [{"mark": "bar", "encoding": {"x": "hour", "y": "rides"}}],
}, data=df)

result.svg            # bytes-identical SVG string
result.handle         # gdf://... — pass to query/audit/explain
result.audit          # list of AuditFinding
```

In Jupyter, `result` renders inline.

## More

- Full docs: https://github.com/seanhanca/glyph
- 49-verb API: `glyph.describe`, `glyph.query`, `glyph.audit`, `glyph.anomaly`, `glyph.forecast`, `glyph.story_plan`, `glyph.whyboard`, ...

Apache 2.0 · no telemetry · self-hostable
