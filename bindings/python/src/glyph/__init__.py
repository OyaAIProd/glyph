"""Glyph — deterministic chart compiler. Python bindings."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from glyph._runtime import call_verb
from glyph.exceptions import (
    GlyphError,
    McpProtocolError,
    NodeNotFoundError,
    SpecValidationError,
)
from glyph.types import AuditFinding, RenderResult

__version__ = "0.1.0a1"

__all__ = [
    "AuditFinding",
    "GlyphError",
    "McpProtocolError",
    "NodeNotFoundError",
    "RenderResult",
    "SpecValidationError",
    "__version__",
    "describe",
    "render",
]


def render(
    spec: Mapping[str, Any],
    *,
    source: str | None = None,
    audit: bool = True,
) -> RenderResult:
    """Render a Glyph spec to SVG.

    Args:
        spec: The chart specification (a JSON-shaped mapping).
        source: Path or URL to a data file (CSV / Parquet / JSON). When
            provided, ``spec.data.source`` is overridden with this value so
            callers don't have to mutate the spec themselves. PR5 will add
            an inline ``data=`` keyword for ``pandas.DataFrame``.
        audit: When True (default), run the 8 audit rules and attach
            findings to ``result.audit``. Set False to skip the extra MCP
            round-trip for hot loops.

    Returns:
        :class:`RenderResult` with ``svg``, ``handle``, and ``audit`` fields.

    Raises:
        SpecValidationError: spec failed schema validation server-side.
        NodeNotFoundError: Node.js ≥ 20 is not available.
        McpProtocolError: any other server-side failure.
    """
    full_spec: dict[str, Any] = dict(spec)
    if source is not None:
        # Don't clobber a nested data block the caller may have set — merge
        # ``source`` into it. Cast through Any to allow either a dict
        # (typical) or some other shape (we only override the source key).
        data_block = full_spec.get("data")
        if isinstance(data_block, dict):
            data_block = {**data_block, "source": source}
        else:
            data_block = {"source": source}
        full_spec["data"] = data_block

    try:
        raw = call_verb("glyph_render", {"spec": full_spec})
    except McpProtocolError as e:
        # Spec-validation failures from the TS server come from
        # `formatError()` in packages/core/src/spec/parse.ts, which produces
        # messages with one of two stable prefixes:
        #   "Invalid Glyph spec at <path>: <zod issue>"
        #   "Invalid Glyph spec"  (no issues)
        #   "Invalid JSON: <parse error>"  (when spec was a malformed JSON string)
        # Anchoring on those prefixes avoids false positives that the
        # earlier substring-OR check (e.g. matching "expected") would have
        # incorrectly routed. Anything else stays as McpProtocolError.
        msg = str(e)
        # Strip the `glyph_render: ` prefix that _mcp_client.call_tool adds
        # so the prefix match works against the underlying server message.
        body = msg.split(": ", 1)[1] if ": " in msg else msg
        if body.startswith("Invalid Glyph spec") or body.startswith("Invalid JSON"):
            raise SpecValidationError(msg) from e
        raise

    if not isinstance(raw, dict) or "svg" not in raw:
        raise McpProtocolError(f"glyph_render: unexpected payload shape: {type(raw).__name__}")

    findings: list[AuditFinding] = []
    if audit:
        # auditSpec is pure-fn on the server side, so we can call it after
        # the render without re-materializing data. If it errors we let it
        # propagate — silently dropping audit findings would hide bugs.
        audit_raw = call_verb("glyph_audit_spec", {"spec": full_spec})
        if isinstance(audit_raw, dict):
            for f in audit_raw.get("findings", []) or []:
                if not isinstance(f, dict):
                    continue
                findings.append(
                    AuditFinding(
                        rule_id=f.get("rule_id", ""),
                        severity=f.get("severity", "low"),
                        message=f.get("message", ""),
                        suggestion=f.get("suggestion"),
                        path=f.get("path"),
                    )
                )

    return RenderResult(
        svg=raw["svg"],
        handle=raw.get("handle_id", ""),
        audit=findings,
        row_count=raw.get("row_count"),
        view_name=raw.get("view_name"),
    )


def describe(source: str) -> dict[str, Any]:
    """Describe a data source — schema, suggested encodings, row count.

    Thin wrapper over the ``glyph_describe`` MCP verb. Returns the verb's
    raw response dict; the schema lives at ``result["columns"]`` /
    ``result["fields"]`` depending on the data source kind.
    """
    result = call_verb("glyph_describe", {"source": source})
    if not isinstance(result, dict):
        raise McpProtocolError(
            f"glyph_describe: expected object result, got {type(result).__name__}"
        )
    return result
