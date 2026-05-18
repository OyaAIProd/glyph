/**
 * Tiny RFC 6902 JSON Patch applier — PR62 / PLAN item 1.8.
 *
 * Pure function. Deterministic. Throws on malformed patches.
 *
 * Supported operations:
 *   - add     (insert into array at index, or set a key on an object)
 *   - remove  (delete an array index or an object key)
 *   - replace (overwrite the value at path)
 *   - copy    (copy the value at `from` to `path`)
 *   - move    (rename / relocate; remove + add)
 *   - test    (no-op when equal; throws when not)
 *
 * No `op` outside the RFC list is accepted. The patch is applied to a
 * deep-cloned copy of the document, leaving the original untouched.
 *
 * Why not pull in fast-json-patch from npm?
 *   - 0 deps invariant for @glyph/core.
 *   - We only need the core ops, no JSON Patch RFC test-runner.
 *   - Determinism: a minimal in-tree impl gives byte-stable output.
 */

export type JsonPatchOp =
  | { readonly op: "add"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "replace"; readonly path: string; readonly value: unknown }
  | { readonly op: "copy"; readonly from: string; readonly path: string }
  | { readonly op: "move"; readonly from: string; readonly path: string }
  | { readonly op: "test"; readonly path: string; readonly value: unknown };

/** Apply an RFC 6902 patch array to `doc` and return the patched document. */
export function applyJsonPatch(doc: unknown, patches: ReadonlyArray<JsonPatchOp>): unknown {
  let current = deepClone(doc);
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    // Reject null / undefined ops loudly — silently skipping them masks
    // construction bugs (H6 from PR review).
    if (p == null) {
      throw new Error(`JSON Patch op[${i}] is null or undefined`);
    }
    try {
      current = applyOne(current, p);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`JSON Patch op[${i}] (${p.op} ${"path" in p ? p.path : ""}): ${msg}`);
    }
  }
  return current;
}

function applyOne(doc: unknown, op: JsonPatchOp): unknown {
  switch (op.op) {
    case "add":
      return setAtPath(doc, op.path, op.value, "add");
    case "replace":
      return setAtPath(doc, op.path, op.value, "replace");
    case "remove":
      return removeAtPath(doc, op.path);
    case "copy": {
      const v = getAtPath(doc, op.from);
      return setAtPath(doc, op.path, deepClone(v), "add");
    }
    case "move": {
      const v = getAtPath(doc, op.from);
      const removed = removeAtPath(doc, op.from);
      return setAtPath(removed, op.path, v, "add");
    }
    case "test": {
      const v = getAtPath(doc, op.path);
      if (!deepEqual(v, op.value)) {
        throw new Error(`test failed: value at ${op.path} differs from expected`);
      }
      return doc;
    }
  }
}

function parsePath(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw new Error(`path must start with "/": ${path}`);
  return path
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function getAtPath(doc: unknown, path: string): unknown {
  const parts = parsePath(path);
  let cur: unknown = doc;
  for (const k of parts) {
    if (Array.isArray(cur)) {
      const idx = Number.parseInt(k, 10);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
        throw new Error(`array index out of range: ${k}`);
      }
      cur = cur[idx];
    } else if (isPlainObject(cur)) {
      if (!(k in (cur as Record<string, unknown>))) {
        throw new Error(`key not found: ${k}`);
      }
      cur = (cur as Record<string, unknown>)[k];
    } else {
      throw new Error(`cannot traverse into non-container at "${k}"`);
    }
  }
  return cur;
}

function setAtPath(doc: unknown, path: string, value: unknown, mode: "add" | "replace"): unknown {
  const parts = parsePath(path);
  if (parts.length === 0) {
    // Root replacement.
    return value;
  }
  const root = doc;
  let cur: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i] as string;
    if (Array.isArray(cur)) {
      const idx = Number.parseInt(k, 10);
      cur = cur[idx];
    } else if (isPlainObject(cur)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      throw new Error(`cannot traverse into non-container at "${k}"`);
    }
    if (cur === undefined) throw new Error(`missing intermediate at "${k}"`);
  }
  const last = parts[parts.length - 1] as string;
  if (Array.isArray(cur)) {
    if (last === "-") {
      // Append.
      cur.push(value);
    } else {
      const idx = Number.parseInt(last, 10);
      if (!Number.isInteger(idx) || idx < 0) throw new Error(`invalid array index: ${last}`);
      if (mode === "add") {
        if (idx > cur.length) throw new Error(`add index out of range: ${idx}`);
        cur.splice(idx, 0, value);
      } else {
        if (idx >= cur.length) throw new Error(`replace index out of range: ${idx}`);
        cur[idx] = value;
      }
    }
  } else if (isPlainObject(cur)) {
    if (mode === "replace" && !(last in (cur as Record<string, unknown>))) {
      throw new Error(`cannot replace nonexistent key "${last}"`);
    }
    (cur as Record<string, unknown>)[last] = value;
  } else {
    throw new Error(`cannot set on non-container at "${last}"`);
  }
  return root;
}

function removeAtPath(doc: unknown, path: string): unknown {
  const parts = parsePath(path);
  if (parts.length === 0) return undefined;
  let cur: unknown = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i] as string;
    if (Array.isArray(cur)) cur = cur[Number.parseInt(k, 10)];
    else if (isPlainObject(cur)) cur = (cur as Record<string, unknown>)[k];
    else throw new Error(`cannot traverse into non-container at "${k}"`);
  }
  const last = parts[parts.length - 1] as string;
  if (Array.isArray(cur)) {
    const idx = Number.parseInt(last, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
      throw new Error(`remove index out of range: ${last}`);
    }
    cur.splice(idx, 1);
  } else if (isPlainObject(cur)) {
    const o = cur as Record<string, unknown>;
    if (!(last in o)) throw new Error(`key not found for remove: ${last}`);
    delete o[last];
  } else {
    throw new Error(`cannot remove on non-container at "${last}"`);
  }
  return doc;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepClone<T>(v: T): T {
  // structuredClone is in Node 17+; safe for our minimum (Node 20).
  return structuredClone(v);
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
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}
