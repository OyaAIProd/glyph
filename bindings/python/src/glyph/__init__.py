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
    data: Any = None,
    audit: bool = True,
) -> RenderResult:
    """Render a Glyph spec to SVG.

    Args:
        spec: The chart specification (a JSON-shaped mapping).
        source: Path or URL to a data file (CSV / Parquet / JSON). When
            provided, ``spec.data.source`` is overridden with this value so
            callers don't have to mutate the spec themselves. Mutually
            exclusive with ``data``.
        data: An inline ``pandas.DataFrame`` to chart without writing it to
            disk. The rows are serialized via
            :func:`glyph.pandas.dataframe_to_inline_data` (lazy-imported), then
            registered with the MCP server's ``glyph_import`` verb so the
            resulting view name can be threaded back into ``spec.data.source``.
            Mutually exclusive with ``source``. Requires the optional
            ``pandas`` extra to be installed.
        audit: When True (default), run the 8 audit rules and attach
            findings to ``result.audit``. Set False to skip the extra MCP
            round-trip for hot loops.

    Returns:
        :class:`RenderResult` with ``svg``, ``handle``, and ``audit`` fields.

    Raises:
        SpecValidationError: spec failed schema validation server-side.
        NodeNotFoundError: Node.js ≥ 20 is not available.
        McpProtocolError: any other server-side failure.
        ValueError: both ``source`` and ``data`` were passed, or ``data`` was
            not a pandas DataFrame.
    """
    if source is not None and data is not None:
        raise ValueError("Pass exactly one of `source=` or `data=`, not both")

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
    elif data is not None:
        # Lazy-import the pandas adapter so the core path stays pandas-free.
        # Doing this here (rather than at module load) keeps `import glyph`
        # cheap and avoids a hard dep on the optional extra. If pandas isn't
        # installed, this import already raises ImportError with the
        # "install glyph[pandas]" hint — see glyph/pandas.py module header.
        # Runtime type-check via a local pandas reference. We can't rely on
        # a TYPE_CHECKING guard because the public signature accepts ``Any``
        # (the alternative — exposing ``pd.DataFrame`` in the signature —
        # would force pandas onto every user importing glyph). A clear
        # ValueError is much friendlier than the cryptic AttributeError that
        # an .to_dict() call would produce on a non-DataFrame argument.
        import pandas as _pd  # type: ignore[import-untyped]

        from glyph.pandas import dataframe_to_inline_data

        if not isinstance(data, _pd.DataFrame):
            raise ValueError(f"data= must be a pandas.DataFrame, got {type(data).__name__}")

        inline = dataframe_to_inline_data(data)
        # The TypeScript-side DataSourceSchema is `strict()` and only accepts
        # source / hierarchy / graph / grid — *not* `values`. So we can't just
        # drop the inline envelope into the spec; we have to register the
        # rows server-side via `glyph_import` first and then thread the
        # returned view name in as `data.source`. This is one extra round-trip
        # but keeps the Python ergonomics (`data=df`) cheap.
        import_result = call_verb(
            "glyph_import",
            {"payload": {"kind": "json-rows", "rows": inline["values"]}},
        )
        if not isinstance(import_result, dict) or "name" not in import_result:
            raise McpProtocolError(
                f"glyph_import: unexpected payload shape: {type(import_result).__name__}"
            )
        registered_name = import_result["name"]

        # Merge into any existing data block so the caller can still pin
        # format hints or transforms even when feeding inline data.
        data_block = full_spec.get("data")
        if isinstance(data_block, dict):
            data_block = {**data_block, "source": registered_name}
        else:
            data_block = {"source": registered_name}
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
