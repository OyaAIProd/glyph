/**
 * Default {@link Evaluator} backed by the `expr-eval` package.
 *
 * expr-eval is a ~9 KB safe expression evaluator — no `eval()`, no
 * `Function()` constructor, no I/O, no clock. Out of the box it ships
 * with a `random()` built-in that wraps `Math.random()`; we delete
 * that binding at module load so the evaluator stays deterministic.
 *
 * A singleton {@link Parser} is shared across calls; parsed ASTs are
 * memoized in a small {@link Map} keyed by source string so that
 * `sampleFunction` doesn't re-parse the expression on every sample
 * (200 samples → 1 parse, 199 cache hits).
 */

import { Parser } from "expr-eval";
import { EvaluationError, type Evaluator } from "./evaluator.js";

/**
 * Singleton parser. expr-eval's Parser is stateless across `.parse()`
 * calls — sharing the instance is safe and gives us a single place to
 * configure the allowed operator set.
 *
 * `assignment: false` blocks `x = 1` style side effects; `factorial`,
 * `concatenate`, and `in` are turned off because they have no meaning
 * for the numeric-output evaluator and would only widen the attack
 * surface for hostile specs.
 */
const parser = new Parser({
  operators: {
    add: true,
    concatenate: false,
    conditional: true,
    divide: true,
    factorial: false,
    multiply: true,
    power: true,
    remainder: true,
    subtract: true,
    logical: true,
    comparison: true,
    in: false,
    assignment: false,
  },
});

/**
 * Remove the non-deterministic and non-numeric built-ins from the
 * shared parser. The operator config above blocks `!` (factorial) at
 * the syntactic level; we additionally delete the named-function
 * versions so callers can't reach the same code via `fac(5)` or
 * sneak in non-numeric helpers (`indexOf`, `join`, …) through a
 * future feature flip. The headline removal is `random` — it wraps
 * `Math.random()` and would silently break byte-identity.
 */
const NON_DETERMINISTIC_FNS = ["random"] as const;
const NON_NUMERIC_FNS = ["fac", "map", "fold", "filter", "indexOf", "join"] as const;
// biome-ignore lint/suspicious/noExplicitAny: expr-eval's types omit the functions bag.
const fns = (parser as unknown as { functions: Record<string, any> }).functions;
for (const name of [...NON_DETERMINISTIC_FNS, ...NON_NUMERIC_FNS]) {
  delete fns[name];
}

/**
 * AST cache. Bounded so a long-running playground/MCP-server process can't
 * be made to OOM by a caller that streams unique expressions. The hot path
 * (same expression repeatedly — the common case for animated parameter
 * sweeps) stays a single-entry hit. When the bound is hit we drop the whole
 * cache rather than implementing an LRU — simpler, and any expression that
 * gets evicted is recomputed once on next use.
 */
const AST_CACHE_MAX = 1024;
const cache = new Map<string, ReturnType<typeof parser.parse>>();

/**
 * Match expr-eval's "undefined variable: foo" error message so we can
 * surface the offending identifier on {@link EvaluationError}.
 */
const UNDEFINED_VAR_RE = /undefined variable:?\s*(\w+)/i;

export const defaultEvaluator: Evaluator = (expr, scope) => {
  let ast = cache.get(expr);
  if (ast === undefined) {
    try {
      ast = parser.parse(expr);
    } catch (e) {
      throw new EvaluationError(`Cannot parse expression: ${(e as Error).message}`, expr);
    }
    if (cache.size >= AST_CACHE_MAX) {
      // Drop everything when we hit the bound. Trades a one-time recompute
      // hit for a constant memory ceiling; preferable to LRU's per-call
      // bookkeeping when the typical workload has high locality.
      cache.clear();
    }
    cache.set(expr, ast);
  }
  let result: unknown;
  try {
    result = ast.evaluate(scope);
  } catch (e) {
    const msg = (e as Error).message;
    const match = UNDEFINED_VAR_RE.exec(msg);
    if (match) {
      throw new EvaluationError(msg, expr, match[1]);
    }
    throw new EvaluationError(msg, expr);
  }
  if (typeof result !== "number" || !Number.isFinite(result)) {
    // NaN / +Infinity / -Infinity surface as null in the materialized row
    // (via sampleFunction's catch), but we never accept them as a valid
    // numeric output from the evaluator itself — the caller decides
    // whether non-finite is a render-time break or a fatal error.
    throw new EvaluationError(`Expression evaluated to non-finite ${String(result)}`, expr);
  }
  return result;
};
