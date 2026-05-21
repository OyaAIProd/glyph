# Intentional audit-rule canary

`intentional-truncated.glyph.json` trips `AUDIT-01` (bar chart with
non-zero baseline) on purpose. It exists so contributors can verify
the audit pipeline against a known-bad spec without having to
construct one from scratch.

**Excluded from the dogfood workflow.** The PR audit at
`.github/workflows/glyph-audit.yml` uses
`spec-pattern: "examples/charts/*.glyph.json"` (no `**`), so this
subdirectory is skipped. Auditing it on every PR would mark CI red
forever, which destroys the dogfood signal.

## Exercising the canary locally

```bash
pnpm --filter @glyph/core build
node -e "
  const { safeParseSpec } = require('./packages/core/dist/spec/parse.js');
  const { auditSpec } = require('./packages/core/dist/audit/index.js');
  const fs = require('fs');
  const spec = JSON.parse(fs.readFileSync(
    'examples/charts/_canary/intentional-truncated.glyph.json',
    'utf8',
  ));
  const r = safeParseSpec(spec);
  console.log(r.ok ? 'parse OK' : 'parse FAIL: ' + r.error.message);
  if (r.ok) {
    const findings = auditSpec({ spec: r.spec });
    console.log('findings:', findings.map(f => f.rule_id).join(', '));
    console.log('AUDIT-01 detected:', findings.some(f => f.rule_id === 'AUDIT-01'));
  }
"
```

Expected:
```
parse OK
findings: AUDIT-01
AUDIT-01 detected: true
```

If `AUDIT-01 detected: false` ever prints, the truncated-y rule has
regressed — that's the canary's job.

## Don't "fix" it

The non-zero `y.scale.domain: [100, 200]` is the point. Removing it
makes the spec clean and useless as a canary. If you want a working
bar chart, copy `examples/charts/rides-by-hour.glyph.json` instead.
