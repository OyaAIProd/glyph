# Example specs

Reference specs that double as starting templates for new contributors.
Each one parses cleanly against the current `@glyph/core` schema and
demonstrates a specific pattern.

> **Audit-on-PR is not wired up yet.** The earlier plan was to dogfood
> `seanhanca/glyph-audit-action` on every PR here, but the action's
> `v0.1.0` only renders diffs — it doesn't yet surface
> `auditSpec()` findings. Once the action grows an audit step, a
> follow-up PR can add the workflow back. Until then these files are
> just examples and validation seeds.

## What's here

- **`rides-by-hour.glyph.json`** — clean bar chart (hour vs ride
  count). Zero findings against `auditSpec()`; Trust score ≈ 100.
  Copy as a baseline when adding a new bar chart.
- **`sales-trend.glyph.json`** — clean line chart over time. Also
  clean; copy when adding a temporal series.
- **`intentional-truncated.glyph.json`** — bar chart with
  `y.scale.domain: [100, 200]`. Deliberately trips **AUDIT-01**
  (truncated y-axis) when audited — useful for testing rule output
  by hand. **Don't "fix" it.** Once the dogfood workflow lands this
  is the canary that proves the audit pipeline is alive.

## Validating a new spec

```bash
pnpm --filter @glyph/core build
node -e "
  const { safeParseSpec } = require('./packages/core/dist/spec/parse.js');
  const { auditSpec } = require('./packages/core/dist/audit/index.js');
  const fs = require('fs');
  const spec = JSON.parse(fs.readFileSync('examples/charts/YOUR-FILE.glyph.json', 'utf8'));
  const r = safeParseSpec(spec);
  console.log(r.ok ? 'parse OK' : 'parse FAIL: ' + r.error.message);
  if (r.ok) console.log('audit:', auditSpec({ spec: r.spec }).map(f => f.rule_id).join(', ') || '(clean)');
"
```

Once the CLI ships to npm a friendlier `pnpm glyph check
examples/charts/YOUR-FILE.glyph.json` shorthand will replace the
inline node invocation above.

## Adding a new example

1. Drop a `*.glyph.json` file in this directory.
2. Add a `"title"` so it reads cleanly when audited.
3. Run the validation snippet above. Specs MUST parse; whether they
   trip audit rules is your call (truncated-y, log-scale-without-title,
   excessive-aggregation, and friends are all fine to demonstrate).
4. Add a one-line entry to the "What's here" list above.
