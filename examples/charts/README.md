# Example specs (audited on every PR)

Reference specs that every PR's Glyph audit workflow
(`.github/workflows/glyph-audit.yml`) checks via
[`seanhanca/glyph-audit-action`](https://github.com/seanhanca/glyph-audit-action).
They double as starting templates for new contributors.

## What's here

- **`rides-by-hour.glyph.json`** — clean bar chart (hour vs ride count). No
  findings; Trust score ≈ 100. Copy as a baseline when adding a bar chart.
- **`sales-trend.glyph.json`** — clean line chart over time. Also clean; copy
  when adding a temporal series.
- **`intentional-truncated.glyph.json`** — bar chart with
  `y.scale.domain: [100, 200]`. Deliberately trips **AUDIT-01** (truncated
  y-axis) so the dogfood workflow always has at least one finding to surface
  in the sticky PR comment. Don't "fix" it — it's the canary.

## Adding a new example

1. Drop a `*.glyph.json` file in this directory.
2. Add a `"title"` so it reads cleanly in the audit comment.
3. Validate locally:
   ```bash
   pnpm --filter @glyph/core build
   node -e "
     const { safeParseSpec } = require('./packages/core/dist/spec/parse.js');
     const fs = require('fs');
     const r = safeParseSpec(JSON.parse(fs.readFileSync('examples/charts/YOUR-FILE.glyph.json', 'utf8')));
     console.log(r.ok ? 'OK' : r.error.message);
   "
   ```
4. Open a PR — the workflow will audit it automatically.
