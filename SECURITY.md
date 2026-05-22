# Security Policy

Glyph takes security seriously. If you find a vulnerability, please
report it through GitHub's private advisory channel rather than as a
public Issue — that gives the maintainers time to ship a fix before
the details become public.

## Supported versions

| Version | Supported |
|---------|-----------|
| `0.2.x` | ✅ Yes — active development |
| `0.1.x` | ⚠️ Critical fixes only |
| < 0.1.0 | ❌ No |

## Reporting a vulnerability

**Open a private advisory:**
<https://github.com/seanhanca/glyph/security/advisories/new>

Advisories are visible only to repo admins. Include:

- Which package (`@glyph/core`, `@glyph/mcp`, `@glyph/duckdb`,
  `@glyph/live`, `@glyph/preview-server`, `@glyph/cli`).
- The version you reproduced on.
- Steps to reproduce, ideally with a minimal spec or MCP call.
- Impact (what an attacker can do — denial-of-service, code execution,
  data exfiltration via crafted spec, prompt injection through agent
  surfaces, etc.).
- If you have a proposed fix, link the branch / patch.

You'll get an acknowledgement within **5 business days**. If the issue
is confirmed, expect a coordinated fix + advisory within 30 days for
most issues, sooner for severe ones.

## Threat surfaces we particularly care about

Glyph is a library most often invoked by **LLM agents** acting on
behalf of end users. Reports about any of the following are
high-priority:

- **Spec-driven code execution.** A spec is JSON. The `expr-eval`
  evaluator we use for `data.shape: "function"` is sandboxed by design;
  any path that lets a crafted spec execute arbitrary code is a
  critical bug.
- **Provenance forgery.** The cryptographic provenance seal (M1) is a
  trust signal agents and users rely on. Anything that lets a spec
  produce an SVG whose seal claims it came from different inputs is
  critical.
- **Prompt injection via spec-embedded text.** Charts often embed
  user-controlled strings (titles, annotations, axis labels). Anything
  that lets those strings escape into an MCP response in a way that
  influences a downstream agent's reasoning is high-impact.
- **DuckDB query injection.** `data.transform` accepts SQL that runs
  against materialized data; we treat it as trusted spec-author input,
  but anything that lets it reach beyond the materialized scope (e.g.
  arbitrary file reads via DuckDB extensions) is high-impact.
- **Snapshot poisoning.** Determinism is a contract; anything that
  silently changes rendered output across runs (PRNG, clock, env var,
  filesystem path) is a determinism bug AND a security concern.

## What's not in scope

- Bugs in `expr-eval` itself — report to
  [`expr-eval-fork` upstream](https://github.com/silentmatt/expr-eval).
  We'll happily mirror once they ship a fix.
- DuckDB CVEs — track [DuckDB security advisories](https://github.com/duckdb/duckdb/security/advisories)
  upstream; we update on each `@glyph/duckdb` release.
- Issues in third-party MCP clients (Claude Desktop, Codex CLI, etc.).
- Self-DoS via huge specs or unbounded recursion — we'll add limits
  pragmatically, but a 10 MB spec hanging the renderer isn't a
  vulnerability, it's an `Invalid spec` error.

## Responsible disclosure

Please do not file public Issues for security bugs. Public disclosure
is fine *after* a fix is released; we'll coordinate the advisory wording
with you and credit you in the CHANGELOG.
