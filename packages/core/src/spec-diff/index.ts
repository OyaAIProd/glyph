export { applyJsonPatch } from "./patch.js";
export type { JsonPatchOp } from "./patch.js";

/**
 * Spec diff — PR60 item 1.7.
 *
 * Pure-fn structural diff between two Glyph specs. Returns:
 *   - added:   JSON paths present in B but not in A
 *   - removed: paths present in A but not in B
 *   - changed: paths in both with different values; carries before + after
 *   - summary: one-sentence human narrative naming the most-impactful diff
 *
 * Used by glyph_spec_diff (MCP verb) and the PR60-batch's spec-as-code CI
 * gate. Deterministic — same inputs → same output, no clock.
 */

export interface SpecDiffChange {
  /** RFC 6901 JSON pointer to the changed value. */
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface SpecDiff {
  readonly added: ReadonlyArray<{ readonly path: string; readonly value: unknown }>;
  readonly removed: ReadonlyArray<{ readonly path: string; readonly value: unknown }>;
  readonly changed: ReadonlyArray<SpecDiffChange>;
  /** One-sentence narrative; "" when the specs are identical. */
  readonly summary: string;
}

/** Compute a structural diff between two Glyph specs. */
export function diffSpecs(a: unknown, b: unknown): SpecDiff {
  const added: Array<{ path: string; value: unknown }> = [];
  const removed: Array<{ path: string; value: unknown }> = [];
  const changed: SpecDiffChange[] = [];
  walk(a, b, "", added, removed, changed);
  const summary = buildSummary(added, removed, changed);
  return { added, removed, changed, summary };
}

function walk(
  a: unknown,
  b: unknown,
  path: string,
  added: Array<{ path: string; value: unknown }>,
  removed: Array<{ path: string; value: unknown }>,
  changed: SpecDiffChange[],
): void {
  if (a === b) return;
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const childPath = `${path}/${escapePointer(k)}`;
      const av = (a as Record<string, unknown>)[k];
      const bv = (b as Record<string, unknown>)[k];
      if (av === undefined && bv !== undefined) {
        added.push({ path: childPath, value: bv });
      } else if (av !== undefined && bv === undefined) {
        removed.push({ path: childPath, value: av });
      } else {
        walk(av, bv, childPath, added, removed, changed);
      }
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      const childPath = `${path}/${i}`;
      if (i >= a.length) added.push({ path: childPath, value: b[i] });
      else if (i >= b.length) removed.push({ path: childPath, value: a[i] });
      else walk(a[i], b[i], childPath, added, removed, changed);
    }
    return;
  }
  // Scalar mismatch (or array vs object).
  if (!deepEqual(a, b)) {
    changed.push({ path: path || "/", before: a, after: b });
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

function escapePointer(s: string): string {
  return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

function buildSummary(
  added: ReadonlyArray<{ path: string }>,
  removed: ReadonlyArray<{ path: string }>,
  changed: ReadonlyArray<SpecDiffChange>,
): string {
  if (added.length === 0 && removed.length === 0 && changed.length === 0) return "";
  const parts: string[] = [];
  // Prioritize the most agent-meaningful diffs first.
  const dataTransformChange = changed.find((c) => c.path.endsWith("/transform"));
  if (dataTransformChange) {
    parts.push(
      `data.transform changed (${truncate(String(dataTransformChange.before))} → ${truncate(String(dataTransformChange.after))})`,
    );
  }
  const sourceChange = changed.find((c) => c.path === "/data/source");
  if (sourceChange) parts.push(`source: ${sourceChange.before} → ${sourceChange.after}`);

  const layerAdds = added.filter((a) => /^\/layers\/\d+$/.test(a.path));
  const layerRemoves = removed.filter((r) => /^\/layers\/\d+$/.test(r.path));
  if (layerAdds.length > 0) parts.push(`${layerAdds.length} layer(s) added`);
  if (layerRemoves.length > 0) parts.push(`${layerRemoves.length} layer(s) removed`);

  const encChanges = changed.filter((c) => c.path.includes("/encoding/"));
  if (encChanges.length > 0) {
    const ch = encChanges[0];
    if (ch)
      parts.push(`${pathTail(ch.path)} encoding ${ch.before === undefined ? "set" : "changed"}`);
  }

  if (parts.length === 0) {
    parts.push(`${added.length} added, ${removed.length} removed, ${changed.length} changed`);
  }
  return `${parts.join("; ")}.`;
}

function pathTail(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function truncate(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
