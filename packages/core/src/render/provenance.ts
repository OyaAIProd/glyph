/**
 * Build the <metadata> block embedded in every rendered SVG.
 *
 * Why this exists: Glyph's byte-identity contract makes the rendered
 * SVG a content-addressable artifact, but verifying that a chart was
 * really produced by a given spec + data requires a separate signal.
 * This module computes that signal once at render time.
 *
 * The block carries:
 *   - specHash       — SHA-256 of the canonicalized JSON spec
 *   - dataHash       — SHA-256 of the materialized rows + schema
 *                      (null when no input data — function / hierarchy /
 *                      graph / grid shapes synthesize rows server-side)
 *   - libraryVersion — @glyph/core package version
 *   - rowCount       — number of rows the renderer received
 *   - scaleDigest    — SHA-256 of the resolved {xScale, yScale} signature
 *   - format         — schema version of the provenance block itself
 *   - generatedAt    — opt-in ISO 8601 timestamp (default: omitted so
 *                      determinism + byte-stability hold)
 *
 * Consumers re-render the spec on the same data and compare hashes to
 * prove integrity. This is the foundation of the
 * "AI-generated-content trust" moat — no other chart library ships a
 * verifiable provenance seal.
 *
 * Format: `glyph-provenance/1` — versioned so future additions don't
 * break consumers parsing the block.
 */

import { createHash } from "node:crypto";
import type { CompileFieldInfo } from "../compiler/compile.js";
import type { GlyphSpec } from "../spec/types.js";

/** Schema version of the provenance block. */
export const PROVENANCE_FORMAT = "glyph-provenance/1" as const;

/** The cryptographic provenance seal embedded in every rendered SVG. */
export interface ProvenanceBlock {
  readonly format: typeof PROVENANCE_FORMAT;
  readonly specHash: string;
  readonly dataHash: string | null;
  readonly libraryVersion: string;
  readonly rowCount: number;
  readonly scaleDigest: string;
  /** Opt-in ISO 8601 timestamp. Omitted by default so SVG bytes stay stable. */
  readonly generatedAt?: string;
}

/**
 * Resolved scale signature captured in the seal. The compiler passes
 * whatever it has — band domains are string arrays, linear domains are
 * number tuples; faceted / hierarchy / graph / contour paths have no
 * shared y scale, in which case the field is simply omitted.
 *
 * `undefined` is admitted explicitly (rather than via optional `?`) so
 * the type composes cleanly under `exactOptionalPropertyTypes: true` —
 * compile paths that can't resolve a scale just pass `undefined`.
 */
export interface ProvenanceScales {
  readonly xDomain: ReadonlyArray<unknown> | undefined;
  readonly yDomain: ReadonlyArray<number> | undefined;
}

/** Input to `computeProvenance`. */
export interface ProvenanceInput {
  readonly spec: GlyphSpec;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  readonly schema: ReadonlyArray<CompileFieldInfo>;
  readonly scales: ProvenanceScales;
  readonly libraryVersion: string;
  readonly includeTimestamp: boolean;
}

/**
 * Canonical JSON stringification: recursively sorts object keys before
 * serializing so semantically-equal objects (same keys + values, any
 * order) produce identical strings. Arrays preserve order — order is
 * semantically meaningful for an array.
 *
 * `bigint` values are serialized as `"N:<digits>"` so the encoding
 * round-trips and never collides with a plain numeric string. `undefined`
 * keys are dropped (matching JSON.stringify). NaN / ±Infinity surface
 * as `null` (also matching JSON.stringify).
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return JSON.stringify(`N:${value.toString()}`);
  // Numbers go through a precision-clamp before JSON.stringify so the
  // hash output is identical across platforms. JavaScript `Math.sin`,
  // `Math.cos`, `Math.exp`, etc. are NOT bit-exact across libm
  // implementations (IEEE 754 specifies arithmetic operations but not
  // transcendental functions), so `sin(x)` on macOS can differ in the
  // last 2–3 bits from `sin(x)` on Linux for the same `x`. That bit-
  // level drift never reaches the rendered SVG path (the renderer
  // rounds to 8 decimals via `roundPx`) but it WOULD propagate into the
  // dataHash if we hashed the raw f64. Clamping to 14 significant
  // digits keeps every visually-meaningful precision bit while
  // discarding the platform-dependent tail. NaN / ±Infinity surface as
  // `null` to match JSON.stringify; integers and short decimals are
  // unaffected (toPrecision is a no-op when the input already has
  // fewer significant digits than the precision argument).
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    if (Number.isInteger(value)) return JSON.stringify(value);
    return JSON.stringify(Number(value.toPrecision(14)));
  }
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => canonicalStringify(v));
    return `[${parts.join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

/** SHA-256 hex digest of `s`. */
function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Compute the provenance seal for a (spec, rows, schema, scales) tuple.
 * Pure function — same inputs → same hashes. Timestamps are opt-in
 * exactly so this contract holds by default.
 */
export function computeProvenance(input: ProvenanceInput): ProvenanceBlock {
  const { spec, rows, schema, scales, libraryVersion, includeTimestamp } = input;
  const specHash = sha256Hex(canonicalStringify(spec));
  const dataHash = rows.length === 0 ? null : sha256Hex(canonicalStringify({ rows, schema }));
  const scaleDigest = sha256Hex(
    canonicalStringify({
      xDomain: scales.xDomain ?? null,
      yDomain: scales.yDomain ?? null,
    }),
  );
  const rowCount = rows.length;
  const base: ProvenanceBlock = {
    format: PROVENANCE_FORMAT,
    specHash,
    dataHash,
    libraryVersion,
    rowCount,
    scaleDigest,
  };
  if (includeTimestamp) {
    return { ...base, generatedAt: new Date().toISOString() };
  }
  return base;
}

/**
 * Render the provenance as a JSON-encoded `<metadata>` child of the SVG
 * root. Browsers ignore it; consumers parse it via DOMParser or by regex
 * against the raw SVG bytes. Wrapped in CDATA so JSON's special chars
 * (`<`, `>`, `&`) never break SVG parsing.
 *
 * We never embed user-derived text here — every field is either a hex
 * digest, a numeric count, or a literal constant — so the JSON payload
 * is XML-safe even without the CDATA wrapper. The CDATA is defense in
 * depth in case the schema grows.
 */
export function renderProvenanceMetadata(block: ProvenanceBlock): string {
  return `<metadata id="glyph-provenance"><![CDATA[${JSON.stringify(block)}]]></metadata>`;
}

/**
 * Extract a `ProvenanceBlock` from a rendered SVG. Returns `null` when
 * the SVG carries no provenance metadata (e.g. SVGs produced by another
 * renderer or a pre-moat Glyph build).
 *
 * Used by the `glyph_verify` MCP verb to compare a rendered SVG against
 * a re-rendered spec.
 */
export function extractProvenanceFromSvg(svg: string): ProvenanceBlock | null {
  const m = svg.match(/<metadata id="glyph-provenance"><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/);
  if (!m || !m[1]) return null;
  try {
    const parsed = JSON.parse(m[1]) as ProvenanceBlock;
    if (parsed && typeof parsed === "object" && parsed.format === PROVENANCE_FORMAT) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Compare two provenance blocks field-by-field. Returns the list of
 * mismatched fields, with expected (from `a`, treated as the canonical
 * re-rendered seal) vs actual (from `b`, the seal embedded in the SVG
 * under test). An empty list means the seals match.
 *
 * The `generatedAt` field is excluded — it's an opt-in timestamp, not a
 * cryptographic claim, and comparing it would defeat the determinism
 * contract.
 */
export function diffProvenance(
  expected: ProvenanceBlock,
  actual: ProvenanceBlock,
): Array<{ field: string; expected: string; actual: string }> {
  const fields: ReadonlyArray<keyof ProvenanceBlock> = [
    "format",
    "specHash",
    "dataHash",
    "libraryVersion",
    "rowCount",
    "scaleDigest",
  ];
  const mismatches: Array<{ field: string; expected: string; actual: string }> = [];
  for (const f of fields) {
    const e = expected[f];
    const a = actual[f];
    if (e !== a) {
      mismatches.push({
        field: f,
        expected: e === null ? "null" : String(e),
        actual: a === null ? "null" : String(a),
      });
    }
  }
  return mismatches;
}
