# Example specs

Reference specs that double as starting templates for new contributors.
Each one parses cleanly against the current `@glyph/core` schema and
demonstrates a specific pattern.

> **Audit-on-PR is wired up.** Every PR runs
> [`seanhanca/glyph-audit-action@v0.2.0`](https://github.com/seanhanca/glyph-audit-action)
> against the specs in this directory and posts a sticky comment with
> the findings. See `.github/workflows/glyph-audit.yml` for the
> workflow. `fail-on: error` means HIGH-severity findings block
> merge — so any new spec here must pass the eight built-in audit
> rules.

## What's here

- **`rides-by-hour.glyph.json`** — clean bar chart (hour vs ride
  count). Zero findings against `auditSpec()`; Trust score ≈ 100.
  Copy as a baseline when adding a new bar chart.
- **`sales-trend.glyph.json`** — clean line chart over time. Also
  clean; copy when adding a temporal series.
- **`_canary/`** — `intentional-truncated.glyph.json` lives here.
  It deliberately trips **AUDIT-01** so contributors can verify the
  audit pipeline against a known-bad spec locally. **Excluded from
  the PR workflow** (the audit's `spec-pattern` is non-recursive)
  so it doesn't gate merges. See `_canary/README.md`.

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
