// site/play/glyph-runtime.js
// Thin wrapper around the @glyph/core browser bundle. Exists so the
// playground (and any future browser caller) imports the
// `compileSpec` → `renderSvg` pipeline (plus `auditSpec` from PR5)
// through a single, named entry point instead of reaching into
// glyph-bundle.js directly. Keeping the surface this small is what
// makes the "same inputs → same SVG bytes" claim auditable: there's
// nothing else between the user's spec and the rendered string.
import { auditSpec, compileSpec, renderSvg } from "./glyph-bundle.js";

/**
 * Compile a Glyph spec against rows + schema and return the SVG string.
 *
 * @param {object} spec   Parsed Glyph spec (object, not JSON text).
 * @param {Array<object>} rows  Tabular data, one row per object.
 * @param {Array<{name: string, type: string}>} schema  Column descriptors.
 * @returns {string} SVG markup. Caller is responsible for inserting it.
 */
export function compileAndRender(spec, rows, schema) {
  const scene = compileSpec({ spec, rows, schema });
  return renderSvg(scene);
}

/**
 * Run the static spec auditor and compute a 0-100 trust score.
 *
 * `auditSpec` is the pure-fn linter exported by `@glyph/core` — see
 * `packages/core/src/audit/index.ts`. It returns an array of findings
 * shaped like `{ rule_id, severity: "low"|"medium"|"high", message,
 * suggestion?, path? }`, sorted by severity desc.
 *
 * The trust score is a TEMPORARY playground-only computation: `@glyph/core`
 * does not yet export a `computeTrust` helper. The formula here
 * (100 - Σ weights, clamped to [0, 100]) is documented in the S3
 * playground plan and is expected to be replaced by a core-exported
 * calculator. Follow-up: track in a GH issue + delete this fallback
 * when `@glyph/core` ships `computeTrust`.
 *
 * Note: the MCP verb `glyph_trust` is about provenance/freshness, NOT
 * an audit-findings score — this is a separate concept.
 *
 * @param {object} spec  Parsed Glyph spec.
 * @param {{rowCount?: number, colorCardinality?: number}} [opts]
 * @returns {{findings: ReadonlyArray<object>, trust: number}}
 */
export function runAudit(spec, opts) {
  const findings = auditSpec({
    spec,
    rowCount: opts?.rowCount,
    colorCardinality: opts?.colorCardinality,
  });
  const trust = computeTrustFallback(findings);
  return { findings, trust };
}

// TEMP: weights match the S3 PR5 task brief: high=15, medium=7, low=3.
// Delete once `@glyph/core` exports a real `computeTrust(findings)` —
// the reviewer will compare against that. Tracked as a follow-up.
function computeTrustFallback(findings) {
  let penalty = 0;
  for (const f of findings) {
    if (f.severity === "high") penalty += 15;
    else if (f.severity === "medium") penalty += 7;
    else if (f.severity === "low") penalty += 3;
  }
  return Math.max(0, Math.min(100, 100 - penalty));
}
