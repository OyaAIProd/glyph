/**
 * Pluggable expression evaluator (math PR1/6).
 *
 * Math PR1 ships an `expr-eval` adapter as the default backend. Future PRs
 * can swap in `mathjs`, a TS-native AST, or a SymPy / Wolfram bridge without
 * touching call sites — the call site only knows about this `Evaluator`
 * function type and the `EvaluationError` class.
 *
 * Determinism contract: an Evaluator MUST be a pure function. Given the same
 * `expr` and the same `scope`, the same numeric result is produced — byte-
 * stable across runs and platforms. No `Date`, no `Math.random`, no I/O.
 */

/**
 * Pluggable expression evaluator. Takes a source expression and a scope
 * mapping identifier names to numeric bindings; returns the result as a
 * JavaScript number.
 *
 * Implementations MUST throw {@link EvaluationError} on parse errors,
 * undefined identifiers, disallowed operations, or non-finite outputs.
 */
export type Evaluator = (expr: string, scope: Record<string, number>) => number;

/**
 * Thrown when an evaluator cannot produce a finite numeric result. Carries
 * the offending expression and, when known, the specific identifier that
 * caused the failure — useful for AUDIT-11 (undefined-identifier rule,
 * math PR5).
 */
export class EvaluationError extends Error {
  readonly expression: string;
  readonly identifier?: string | undefined;

  constructor(message: string, expression: string, identifier?: string) {
    super(message);
    this.name = "EvaluationError";
    this.expression = expression;
    this.identifier = identifier;
  }
}
