/**
 * Macro capture & replay — INNOVATION 2.5 (PR70).
 *
 * A **Macro** is a portable JSON document that captures a sequence of
 * MCP verb calls (verb name + args). It can be re-run against new data
 * via `glyph_macro_replay`, substituting `{{params.X}}` placeholders
 * in the args at replay time.
 *
 * Determinism: replay is pure — same macro + same params + same data
 * → same handles + same SVGs. No clock, no PRNG.
 *
 * Scope (v0): replay supports the high-value verbs
 *   - glyph_render
 *   - glyph_query
 *   - glyph_describe
 *   - glyph_explain
 *   - glyph_anomaly
 *   - glyph_forecast
 *   - glyph_drift
 *   - glyph_decompose
 *   - glyph_audit_spec
 *   - glyph_suggest_scale
 *
 * Verbs that mutate registries (metrics_register, memory_save,
 * trust, act) are *not* supported in v0 — they have side effects
 * the user typically doesn't want re-applied on replay. Future
 * work: an explicit `side_effects: "allow"` flag.
 */

/**
 * One step in a macro. The `verb` is the MCP tool name; `args` are
 * verbatim with optional `{{params.X}}` placeholders in string slots.
 */
export interface MacroStep {
  readonly verb: string;
  readonly args: Record<string, unknown>;
  /** Optional human-readable note. Carried through replay; never executed. */
  readonly note?: string | undefined;
}

/** A captured macro. v0 is version 1; future versions may add fields. */
export interface Macro {
  readonly name: string;
  readonly version: 1;
  /** ISO timestamp when the macro was captured; informational only. */
  readonly capturedAt?: string | undefined;
  /** Declared parameters; lets agents know what {{params.X}} placeholders exist. */
  readonly params?: ReadonlyArray<{ readonly name: string; readonly description?: string }>;
  readonly steps: ReadonlyArray<MacroStep>;
}

/** Per-step replay result. */
export interface MacroReplayStepResult {
  readonly step_index: number;
  readonly verb: string;
  readonly ok: boolean;
  /** When ok: verb-specific result JSON. When !ok: an error message. */
  readonly result?: unknown;
  readonly error?: string;
}

export interface MacroReplayResult {
  readonly name: string;
  readonly total_steps: number;
  readonly completed_steps: number;
  readonly steps: ReadonlyArray<MacroReplayStepResult>;
}

/**
 * Verbs whose internal handlers `glyph_macro_replay` knows how to
 * dispatch. v0 scope is the analytic core — render / describe / query.
 * Adding a verb is a single-line change to this list + a case in
 * the dispatcher (see server.ts). Mutating verbs (memory_save,
 * metrics_register, act) are intentionally excluded from v0 because
 * their side effects shouldn't auto-replay.
 */
export const SUPPORTED_REPLAY_VERBS = ["glyph_render", "glyph_describe", "glyph_query"] as const;

export type SupportedReplayVerb = (typeof SUPPORTED_REPLAY_VERBS)[number];

const REPLAY_VERB_SET = new Set<string>(SUPPORTED_REPLAY_VERBS);

export function isSupportedReplayVerb(verb: string): verb is SupportedReplayVerb {
  return REPLAY_VERB_SET.has(verb);
}

/**
 * Validate a macro's shape. Returns an error string or undefined.
 * Catches every failure mode that would make replay non-deterministic
 * or unsafe.
 */
export function validateMacro(macro: unknown): string | undefined {
  if (!macro || typeof macro !== "object") return "macro must be an object";
  const m = macro as Record<string, unknown>;
  if (typeof m.name !== "string" || !m.name) return "macro.name is required";
  if (m.version !== 1) return `macro.version must be 1, got ${JSON.stringify(m.version)}`;
  if (!Array.isArray(m.steps)) return "macro.steps must be an array";
  if (m.steps.length === 0) return "macro.steps must contain at least one entry";
  for (let i = 0; i < m.steps.length; i++) {
    const s = m.steps[i];
    if (!s || typeof s !== "object") return `macro.steps[${i}] must be an object`;
    const step = s as Record<string, unknown>;
    if (typeof step.verb !== "string" || !step.verb) {
      return `macro.steps[${i}].verb is required`;
    }
    if (!isSupportedReplayVerb(step.verb)) {
      return `macro.steps[${i}].verb "${step.verb}" is not in the supported replay set: ${SUPPORTED_REPLAY_VERBS.join(", ")}`;
    }
    if (step.args === undefined || step.args === null || typeof step.args !== "object") {
      return `macro.steps[${i}].args must be an object`;
    }
  }
  return undefined;
}

/**
 * Recursively replace `"{{params.X}}"` placeholder strings with the
 * corresponding param value. Pure function — returns a deep copy with
 * substitutions applied. Throws on a referenced-but-undefined param so
 * the user gets a clear error rather than a `{{params.…}}` literal.
 */
export function substituteParams(value: unknown, params: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    // Exact-match placeholder substitution: `"{{params.X}}"` → params.X.
    // Embedded placeholders inside larger strings are intentionally NOT
    // expanded — too easy to silently break SQL or paths. Use a separate
    // param + a separate string slot.
    const m = value.match(/^\{\{params\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}$/);
    if (m) {
      const key = m[1] as string;
      if (!(key in params)) {
        throw new Error(`Macro replay: param "${key}" referenced but not supplied`);
      }
      return params[key];
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteParams(v, params));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substituteParams(v, params);
    }
    return out;
  }
  return value;
}

/**
 * Collect every `{{params.X}}` placeholder referenced in a macro's
 * step args. Used for documentation + as a pre-flight check so the
 * caller can know what params to supply without running the macro.
 */
export function collectMacroParams(macro: Macro): ReadonlyArray<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      const m = v.match(/^\{\{params\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}$/);
      if (m) out.add(m[1] as string);
      return;
    }
    if (Array.isArray(v)) {
      for (const e of v) walk(e);
      return;
    }
    if (v && typeof v === "object") {
      for (const e of Object.values(v)) walk(e);
    }
  };
  for (const step of macro.steps) walk(step.args);
  return [...out].sort();
}
