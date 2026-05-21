"""Glyph — deterministic chart compiler. Python bindings."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Literal

from glyph._runtime import call_verb
from glyph.exceptions import (
    GlyphError,
    McpProtocolError,
    NodeNotFoundError,
    SpecValidationError,
)
from glyph.types import (
    AnomalyResult,
    AuditFinding,
    Capabilities,
    ChartTypeAlternative,
    ChartTypeRationale,
    DataSourceRef,
    DecomposeResult,
    ExplainResult,
    ForecastResult,
    KeyInsight,
    PotentialMisreading,
    QueryResult,
    RenderResult,
    SpecDiff,
    SpecDiffChange,
    SpecDiffEntry,
    SpecPatchResult,
    StoryPlan,
    StoryPlanNode,
    StructuredExplanation,
    SuggestedFollowup,
)

__version__ = "0.1.0a1"

__all__ = [
    "AnomalyResult",
    "AuditFinding",
    "Capabilities",
    "ChartTypeAlternative",
    "ChartTypeRationale",
    "DataSourceRef",
    "DecomposeResult",
    "ExplainResult",
    "ForecastResult",
    "GlyphError",
    "KeyInsight",
    "McpProtocolError",
    "NodeNotFoundError",
    "PotentialMisreading",
    "QueryResult",
    "RenderResult",
    "SpecDiff",
    "SpecDiffChange",
    "SpecDiffEntry",
    "SpecPatchResult",
    "SpecValidationError",
    "StoryPlan",
    "StoryPlanNode",
    "StructuredExplanation",
    "SuggestedFollowup",
    "__version__",
    "anomaly",
    "audit_spec",
    "call",
    "capabilities",
    "decompose",
    "describe",
    "drill",
    "explain",
    "forecast",
    "query",
    "render",
    "spec_diff",
    "spec_patch",
    "story_plan",
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
        raw=raw,
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


# ---------------------------------------------------------------------------
# Typed wrappers for the 12 highest-value verbs (PR7).
#
# Design: each wrapper takes a clean Python signature, dispatches to the
# matching MCP verb via `call_verb`, and projects the result onto a frozen
# dataclass from `glyph.types`. The dataclasses are the public contract;
# they're additive across the 0.x line so callers can rely on them.
#
# Verbs the user might want but we don't wrap directly (memory, metrics,
# subscribe, lineage, …) are reachable via `glyph.call()` — see below.
# ---------------------------------------------------------------------------


def _expect_dict(verb: str, result: Any) -> dict[str, Any]:
    """Type-narrow an MCP response or raise a clear protocol error."""
    if not isinstance(result, dict):
        raise McpProtocolError(f"{verb}: expected object result, got {type(result).__name__}")
    return result


def query(handle: str, where: str | None = None, *, limit: int | None = None) -> QueryResult:
    """Run follow-up SQL against the view backing a rendered chart.

    Maps to the ``glyph_query`` MCP verb.

    Args:
        handle: Handle id from :func:`render` (NOT a ``gdf://`` URI).
        where: SQL suffix appended to ``SELECT * FROM <view>`` — typically
            starts with ``WHERE`` and may include ``ORDER BY`` / ``LIMIT``.
            Pass ``None`` to fetch every row.
        limit: Server-side row cap. Maps to ``limit_rows`` and surfaces a
            ``truncated`` flag on the result when the underlying set was
            larger.

    Returns:
        :class:`QueryResult` with ``columns``, ``rows`` (list-of-lists),
        ``row_count`` (the underlying total), and ``truncated``.
        Call :meth:`QueryResult.dicts` for a per-row dict view.
    """
    args: dict[str, Any] = {"handle_id": handle}
    if where is not None:
        args["where"] = where
    if limit is not None:
        args["limit_rows"] = limit
    raw = _expect_dict("glyph_query", call_verb("glyph_query", args))
    truncated = bool(raw.get("truncated", False))
    # `total` and `returned` are only emitted when the row cap fires (see the
    # `glyph_query` handler in packages/mcp/src/server.ts). When they're
    # absent, leave them as None so callers can distinguish "uncapped" from
    # "capped at 0".
    total = int(raw["total"]) if isinstance(raw.get("total"), int) else None
    returned = int(raw["returned"]) if isinstance(raw.get("returned"), int) else None
    return QueryResult(
        columns=list(raw.get("columns", []) or []),
        rows=[list(r) for r in raw.get("rows", []) or []],
        row_count=int(raw.get("rowCount", 0) or 0),
        truncated=truncated,
        total=total,
        returned=returned,
        raw=raw,
    )


def audit_spec(
    spec: Mapping[str, Any],
    *,
    row_count: int | None = None,
    color_cardinality: int | None = None,
) -> list[AuditFinding]:
    """Audit a spec for common misleading-chart patterns.

    Maps to the ``glyph_audit_spec`` MCP verb. Returns a list (possibly
    empty when the spec passes every rule). The server's envelope —
    ``{count, highSeverity, mediumSeverity, lowSeverity, findings}`` — is
    unwrapped to just the ``findings`` list since callers can derive the
    counts themselves.

    Args:
        spec: The Glyph spec JSON.
        row_count: Optional underlying row count (drives AUDIT-04 —
            excessive-aggregation).
        color_cardinality: Optional distinct color count (drives AUDIT-06).
    """
    args: dict[str, Any] = {"spec": dict(spec)}
    if row_count is not None:
        args["rowCount"] = row_count
    if color_cardinality is not None:
        args["colorCardinality"] = color_cardinality
    raw = _expect_dict("glyph_audit_spec", call_verb("glyph_audit_spec", args))
    findings: list[AuditFinding] = []
    for f in raw.get("findings", []) or []:
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
    return findings


def anomaly(
    handle: str,
    *,
    value_field: str,
    group_field: str | None = None,
    label_field: str | None = None,
    threshold: float | None = None,
    limit: int | None = None,
) -> AnomalyResult:
    """Z-score outlier detection on a rendered chart.

    Maps to the ``glyph_anomaly`` MCP verb. Returns rows whose ``|z|``
    exceeds ``threshold`` (default 2 sigma) from their segment mean. Pass
    ``group_field`` to compute the mean per-bucket instead of globally.

    NOTE: the MCP verb uses ``valueField`` (not ``field``) and has no
    ``method`` selector — only z-score is supported in S1.
    """
    args: dict[str, Any] = {"handle_id": handle, "valueField": value_field}
    if group_field is not None:
        args["groupField"] = group_field
    if label_field is not None:
        args["labelField"] = label_field
    if threshold is not None:
        args["threshold"] = threshold
    if limit is not None:
        args["limit"] = limit
    raw = _expect_dict("glyph_anomaly", call_verb("glyph_anomaly", args))
    # `raw["segments"]` carries per-bucket mean/std stats; we don't model it
    # as a typed field yet, but it stays reachable via `result.raw`.
    return AnomalyResult(
        handle=raw.get("handle_id", ""),
        threshold=float(raw.get("threshold", 0.0) or 0.0),
        columns=list(raw.get("columns", []) or []),
        rows=[list(r) for r in raw.get("rows", []) or []],
        explanation=str(raw.get("explanation", "") or ""),
        raw=raw,
    )


def decompose(
    handle: str,
    *,
    metric_field: str,
    factors: Sequence[str],
) -> DecomposeResult:
    """Rank factors by share of variance explained (one-way ANOVA η²).

    Maps to the ``glyph_decompose`` MCP verb. Each entry in ``factors`` is
    a categorical column to test. No ``period`` arg — the verb is purely
    cross-sectional.
    """
    if not factors:
        raise ValueError("decompose: factors must contain at least one column name")
    raw = _expect_dict(
        "glyph_decompose",
        call_verb(
            "glyph_decompose",
            {
                "handle_id": handle,
                "metricField": metric_field,
                "factors": list(factors),
            },
        ),
    )
    return DecomposeResult(
        handle=raw.get("handle_id", ""),
        grand_mean=float(raw.get("grandMean", 0.0) or 0.0),
        total_sse=float(raw.get("totalSSE", 0.0) or 0.0),
        columns=list(raw.get("columns", []) or []),
        rows=[list(r) for r in raw.get("rows", []) or []],
        explanation=str(raw.get("explanation", "") or ""),
        raw=raw,
    )


def forecast(
    handle: str,
    *,
    x_field: str,
    y_field: str,
    horizon: int | None = None,
    season: int | None = None,
) -> ForecastResult:
    """Seasonal-naive forecast with +/- 2 sigma residual bands.

    Maps to the ``glyph_forecast`` MCP verb. BOTH ``x_field`` and
    ``y_field`` are required — ``x_field`` is the sort key (typically
    temporal), ``y_field`` is the numeric to project.
    """
    args: dict[str, Any] = {
        "handle_id": handle,
        "xField": x_field,
        "yField": y_field,
    }
    if horizon is not None:
        args["horizon"] = horizon
    if season is not None:
        args["season"] = season
    raw = _expect_dict("glyph_forecast", call_verb("glyph_forecast", args))
    return ForecastResult(
        handle=raw.get("handle_id", ""),
        season=int(raw.get("season", 1) or 1),
        residual_std=float(raw.get("residualStd", 0.0) or 0.0),
        columns=list(raw.get("columns", []) or []),
        rows=[list(r) for r in raw.get("rows", []) or []],
        explanation=str(raw.get("explanation", "") or ""),
        raw=raw,
    )


def explain(
    handle: str,
    *,
    x_field: str | None = None,
    y_field: str | None = None,
    group_field: str | None = None,
    format: Literal["legacy", "structured"] = "legacy",
) -> ExplainResult | StructuredExplanation:
    """Deterministic explanation of a chart.

    Maps to the ``glyph_explain`` MCP verb. The role hints are nested
    under ``hints`` on the wire — this wrapper lifts them to top-level
    kwargs so callers don't have to build a nested dict. The verb only
    accepts ``xField``/``yField``/``groupField`` hints (no audience /
    depth / focus).

    Moat PR 2 — pass ``format="structured"`` to get back a typed
    :class:`StructuredExplanation` envelope instead of the legacy
    :class:`ExplainResult`. The structured envelope is agent-consumable
    end-to-end: ``suggested_followups[].suggested_verb`` +
    ``suggested_args`` can be passed straight into another ``glyph.*``
    wrapper. Default stays ``"legacy"`` for back-compat.
    """
    args: dict[str, Any] = {"handle_id": handle}
    hints: dict[str, str] = {}
    if x_field is not None:
        hints["xField"] = x_field
    if y_field is not None:
        hints["yField"] = y_field
    if group_field is not None:
        hints["groupField"] = group_field
    if hints:
        args["hints"] = hints
    if format != "legacy":
        args["format"] = format
    raw = _expect_dict("glyph_explain", call_verb("glyph_explain", args))

    if format == "structured":
        return _parse_structured_explanation(raw)

    return ExplainResult(
        headline=str(raw.get("headline", "") or ""),
        highlights=[str(h) for h in raw.get("highlights", []) or []],
        questions=[str(q) for q in raw.get("questions", []) or []],
        raw=raw,
    )


def _parse_structured_explanation(raw: dict[str, Any]) -> StructuredExplanation:
    """Translate the on-wire camelCase Explanation/1 envelope into the
    snake_case Python dataclass tree. Lenient on missing fields — same
    wire envelope evolves additively across 0.x.
    """
    insights = []
    for k in raw.get("keyInsights", []) or []:
        if not isinstance(k, dict):
            continue
        insights.append(
            KeyInsight(
                insight=str(k.get("insight", "") or ""),
                confidence=str(k.get("confidence", "medium") or "medium"),  # type: ignore[arg-type]
                path=k.get("path"),
            )
        )

    misreadings = []
    for m in raw.get("potentialMisreadings", []) or []:
        if not isinstance(m, dict):
            continue
        misreadings.append(
            PotentialMisreading(
                description=str(m.get("description", "") or ""),
                severity=str(m.get("severity", "low") or "low"),  # type: ignore[arg-type]
                audit_rule_id=m.get("auditRuleId"),
            )
        )

    sources = []
    for s in raw.get("dataSources", []) or []:
        if not isinstance(s, dict):
            continue
        sources.append(
            DataSourceRef(
                field=str(s.get("field", "") or ""),
                value=str(s.get("value", "") or ""),
            )
        )

    rationale_raw = raw.get("chartTypeRationale", {}) or {}
    alternatives = []
    for a in rationale_raw.get("alternatives", []) or []:
        if not isinstance(a, dict):
            continue
        alternatives.append(
            ChartTypeAlternative(
                chart_type=str(a.get("chartType", "") or ""),
                tradeoff=str(a.get("tradeoff", "") or ""),
            )
        )
    rationale = ChartTypeRationale(
        chart_type=str(rationale_raw.get("chartType", "") or ""),
        rationale=str(rationale_raw.get("rationale", "") or ""),
        alternatives=alternatives,
    )

    followups = []
    for fu in raw.get("suggestedFollowups", []) or []:
        if not isinstance(fu, dict):
            continue
        followups.append(
            SuggestedFollowup(
                question=str(fu.get("question", "") or ""),
                suggested_verb=fu.get("suggestedVerb"),
                suggested_args=dict(fu.get("suggestedArgs", {}) or {}),
            )
        )

    return StructuredExplanation(
        headline=str(raw.get("headline", "") or ""),
        key_insights=insights,
        potential_misreadings=misreadings,
        data_sources=sources,
        chart_type_rationale=rationale,
        suggested_followups=followups,
        format=str(raw.get("format", "glyph-explanation/1") or "glyph-explanation/1"),
        raw=raw,
    )


def drill(
    handle: str,
    *,
    field: str,
    equals: str | float | None = None,
    between: tuple[float, float] | None = None,
    in_: Sequence[str | float] | None = None,
) -> QueryResult:
    """Drill into a rendered chart via a selection (click / brush / zoom).

    Maps to the ``glyph_drill`` MCP verb. Exactly one of ``equals``,
    ``between``, or ``in_`` must be set. The verb returns the SQL
    predicate it generated plus the matching rows; we expose the rows in
    the same :class:`QueryResult` shape as :func:`query` for symmetry.

    Args:
        handle: Handle id from :func:`render`.
        field: Column to filter on.
        equals: Single-value equality — analog of a bar click.
        between: ``(min, max)`` inclusive — analog of a brush / zoom.
        in_: Discrete value list — analog of a multi-select brush. The
            trailing underscore avoids shadowing the Python builtin.
    """
    selectors = sum(x is not None for x in (equals, between, in_))
    if selectors != 1:
        raise ValueError("drill: provide exactly one of equals=, between=, in_=")
    args: dict[str, Any] = {"handle_id": handle, "field": field}
    if equals is not None:
        args["equals"] = equals
    if between is not None:
        args["between"] = list(between)
    if in_ is not None:
        args["in"] = list(in_)
    raw = _expect_dict("glyph_drill", call_verb("glyph_drill", args))
    # `glyph_drill` doesn't currently emit a `truncated` flag (unlike
    # `glyph_query`), but we read it defensively so a future server-side
    # truncation knob doesn't make this wrapper silently lie. Same for
    # `total` / `returned`.
    truncated = bool(raw.get("truncated", False))
    total = int(raw["total"]) if isinstance(raw.get("total"), int) else None
    returned = int(raw["returned"]) if isinstance(raw.get("returned"), int) else None
    return QueryResult(
        columns=list(raw.get("columns", []) or []),
        rows=[list(r) for r in raw.get("rows", []) or []],
        row_count=int(raw.get("rowCount", 0) or 0),
        truncated=truncated,
        total=total,
        returned=returned,
        raw=raw,
    )


def spec_diff(spec_a: Mapping[str, Any], spec_b: Mapping[str, Any]) -> SpecDiff:
    """Structural diff between two Glyph specs.

    Maps to the ``glyph_spec_diff`` MCP verb. Returns a :class:`SpecDiff`
    with ``added`` / ``removed`` / ``changed`` lists and a one-sentence
    ``summary``. NOT an RFC 6902 JSON Patch — paths are RFC 6901 pointers
    but the entries are stratified by operation, not flattened.

    Wire param names are ``spec_a`` / ``spec_b`` (NOT ``a`` / ``b``).
    """
    raw = _expect_dict(
        "glyph_spec_diff",
        call_verb("glyph_spec_diff", {"spec_a": dict(spec_a), "spec_b": dict(spec_b)}),
    )
    added = [
        SpecDiffEntry(path=e.get("path", ""), value=e.get("value"))
        for e in raw.get("added", []) or []
        if isinstance(e, dict)
    ]
    removed = [
        SpecDiffEntry(path=e.get("path", ""), value=e.get("value"))
        for e in raw.get("removed", []) or []
        if isinstance(e, dict)
    ]
    changed = [
        SpecDiffChange(
            path=c.get("path", ""),
            before=c.get("before"),
            after=c.get("after"),
        )
        for c in raw.get("changed", []) or []
        if isinstance(c, dict)
    ]
    return SpecDiff(
        added=added,
        removed=removed,
        changed=changed,
        summary=str(raw.get("summary", "") or ""),
        raw=raw,
    )


def spec_patch(handle: str, patches: Sequence[Mapping[str, Any]]) -> SpecPatchResult:
    """Apply RFC 6902 JSON patches to the spec backing an existing handle.

    Maps to the ``glyph_spec_patch`` MCP verb. The server recalls the
    spec from its handle registry — so callers pass a ``handle`` (NOT
    a raw spec). Each patch is a standard RFC 6902 op:
    ``{"op": "replace", "path": "/layers/0/mark", "value": "area"}``.

    Returns the new handle + freshly-rendered SVG.
    """
    if not patches:
        raise ValueError("spec_patch: patches must be non-empty")
    raw = _expect_dict(
        "glyph_spec_patch",
        call_verb(
            "glyph_spec_patch",
            {"handle_id": handle, "patches": [dict(p) for p in patches]},
        ),
    )
    return SpecPatchResult(
        handle=raw.get("handle_id", ""),
        svg=str(raw.get("svg", "") or ""),
        row_count=raw.get("row_count"),
        view_name=raw.get("view_name"),
        raw=raw,
    )


def story_plan(
    intent: str,
    *,
    source: str,
    format: Literal["csv", "parquet", "json"] | None = None,
    domain: str | None = None,
    planner_hint: Literal["heuristic", "llm"] | None = None,
) -> StoryPlan:
    """Plan a multi-chart analytic storyboard from natural-language intent.

    Maps to the ``glyph_story_plan`` MCP verb. ``source`` is REQUIRED —
    the planner needs a data source to inspect for the schema.
    """
    args: dict[str, Any] = {"intent": intent, "source": source}
    if format is not None:
        args["format"] = format
    if domain is not None:
        args["domain"] = domain
    if planner_hint is not None:
        args["planner_hint"] = planner_hint
    raw = _expect_dict("glyph_story_plan", call_verb("glyph_story_plan", args))
    nodes = [
        StoryPlanNode(
            id=str(n.get("id", "")),
            kind=str(n.get("kind", "")),
            label=str(n.get("label", "")),
            depends_on=[str(d) for d in n.get("dependsOn", []) or []],
            status=str(n.get("status", "pending")),
        )
        for n in raw.get("nodes", []) or []
        if isinstance(n, dict)
    ]
    # `clarification_questions` is whatever the wire emitted (camelCase or
    # snake_case depending on planner version) — flatten the list-of-dicts
    # but keep individual entries as raw dicts so callers can adapt to shape
    # drift without us forcing a typed schema we don't yet have confidence in.
    cq_raw: list[Any] = list(
        raw.get("clarificationQuestions", raw.get("clarification_questions", [])) or []
    )
    clarification_questions: list[dict[str, Any]] = [q for q in cq_raw if isinstance(q, dict)]
    return StoryPlan(
        plan_id=str(raw.get("plan_id", raw.get("id", "")) or ""),
        intent=str(raw.get("intent", "") or ""),
        status=str(raw.get("status", "") or ""),
        nodes=nodes,
        domain=raw.get("domain"),
        clarification_questions=clarification_questions,
        raw=raw,
    )


def capabilities() -> Capabilities:
    """Report this Glyph build's capabilities.

    Maps to the ``glyph_capabilities`` MCP verb. Use this once at session
    start to detect feature availability before calling newer tools.

    The wire envelope is ``{libraryVersion, specVersions, marks, stats,
    renderers, engines, mcpTools}`` — NOT ``tools`` / ``verbs``. The full
    payload is preserved on ``Capabilities.raw`` for forward-compat.
    """
    raw = _expect_dict("glyph_capabilities", call_verb("glyph_capabilities", {}))
    return Capabilities(
        library_version=str(raw.get("libraryVersion", "") or ""),
        mcp_tools=[
            {"name": str(t.get("name", "")), "since": str(t.get("since", ""))}
            for t in raw.get("mcpTools", []) or []
            if isinstance(t, dict)
        ],
        spec_versions=[str(v) for v in raw.get("specVersions", []) or []],
        marks=[str(m) for m in raw.get("marks", []) or []],
        stats=[str(s) for s in raw.get("stats", []) or []],
        renderers=[str(r) for r in raw.get("renderers", []) or []],
        engines=[str(e) for e in raw.get("engines", []) or []],
        raw=raw,
    )


# ---------------------------------------------------------------------------
# Passthrough escape hatch for the long tail of verbs (memory, lineage,
# subscribe, metrics, story_*, whyboard, …). We auto-prepend `glyph_` so
# callers can write `glyph.call("describe", {...})` or
# `glyph.call("glyph_describe", {...})` interchangeably.
# ---------------------------------------------------------------------------


def call(verb: str, args: Mapping[str, Any] | None = None) -> Any:
    """Call any of the MCP server's verbs by name. Untyped escape hatch.

    The 12 high-value verbs have typed wrappers above; this is for the
    long tail (memory, metrics, story_*, whyboard, lineage, subscribe,
    …). Prepends ``glyph_`` to ``verb`` when missing.

    Returns the verb's raw JSON-decoded response. No projection onto a
    dataclass — callers handle the shape.
    """
    if not verb.startswith("glyph_"):
        verb = "glyph_" + verb
    return call_verb(verb, dict(args or {}))
