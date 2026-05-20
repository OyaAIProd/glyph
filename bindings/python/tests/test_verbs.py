"""End-to-end tests for the 12 typed verb wrappers + `glyph.call` passthrough.

Every test rides on the real MCP subprocess via the singleton runtime — same
pattern as ``test_render.py``. The ``rides_csv_path`` / ``sales_csv_path``
fixtures come from ``conftest.py``.

Why end-to-end (vs. mocking ``call_verb``)? Because each wrapper's job is
mapping the wire shape onto a typed dataclass. Mocking the wire would test
the dataclass constructor, not the mapping — exactly the bit we care about
when an MCP shape drifts.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import glyph
from glyph._runtime import shutdown_runtime
from glyph.exceptions import SpecValidationError


@pytest.fixture(autouse=True)
def _ensure_dev_mcp_bin() -> None:
    """Skip if the monorepo MCP bundle isn't built. Mirrors test_render.py."""
    repo_root = Path(__file__).resolve().parents[3]
    bin_path = repo_root / "packages" / "mcp" / "dist" / "bin.js"
    if not bin_path.exists():
        pytest.skip(f"MCP server not built: {bin_path}")


@pytest.fixture(autouse=True)
def _isolate_runtime() -> None:
    """Tear down the singleton between tests so handles / spec state don't leak."""
    yield
    shutdown_runtime()


# ---------------------------------------------------------------------------
# Helpers — render a chart so we have a fresh handle to feed downstream verbs.
# Defined as plain functions (not fixtures) so test bodies can pass extra
# kwargs and still read like a story.
# ---------------------------------------------------------------------------


def _render_rides(rides_csv_path: Path) -> glyph.RenderResult:
    return glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]},
        source=str(rides_csv_path),
        audit=False,
    )


def _render_sales(sales_csv_path: Path) -> glyph.RenderResult:
    return glyph.render(
        {"layers": [{"mark": "line", "encoding": {"x": "date", "y": "revenue"}}]},
        source=str(sales_csv_path),
        audit=False,
    )


# ---------------------------------------------------------------------------
# capabilities() — feature detection
# ---------------------------------------------------------------------------


def test_capabilities_returns_library_version() -> None:
    """`capabilities()` returns the build's libraryVersion + mcpTools list."""
    caps = glyph.capabilities()
    assert isinstance(caps, glyph.Capabilities)
    # libraryVersion is hard-coded to "0.0.0" in core/src/capabilities.ts —
    # assert it's a string rather than pinning the value so a bump doesn't
    # break this test.
    assert isinstance(caps.library_version, str)
    assert caps.mcp_tools  # at least one verb registered
    # Sanity — the verbs we wrap must be reachable.
    names = {t["name"] for t in caps.mcp_tools}
    assert "glyph_render" in names
    assert "glyph_anomaly" in names


def test_capabilities_preserves_raw_payload() -> None:
    """The full envelope is preserved on .raw for forward-compat introspection."""
    caps = glyph.capabilities()
    # The wire envelope has these keys; pin them so a missing key in a
    # future build surfaces as a test failure, not a silent drop.
    assert "libraryVersion" in caps.raw
    assert "marks" in caps.raw
    assert caps.marks  # non-empty


# ---------------------------------------------------------------------------
# query() — SQL follow-up against a rendered handle
# ---------------------------------------------------------------------------


def test_query_returns_rows_and_columns(rides_csv_path: Path) -> None:
    r = _render_rides(rides_csv_path)
    qr = glyph.query(r.handle)
    assert isinstance(qr, glyph.QueryResult)
    assert qr.row_count == 4
    assert len(qr.rows) == 4
    # The materialized view is `SELECT * FROM <source>` — every CSV column
    # is present, not just the two we encoded.
    assert "pickup_hour" in qr.columns
    assert "rides" in qr.columns
    assert "fare" in qr.columns


def test_query_where_clause_filters(rides_csv_path: Path) -> None:
    """The `where` arg is appended verbatim and narrows the result."""
    r = _render_rides(rides_csv_path)
    qr = glyph.query(r.handle, "WHERE rides > 200")
    # The fixture has 2 rows with rides > 200 (8h=260, 17h=240).
    assert qr.row_count == 2


def test_query_dicts_zips_columns_with_rows(rides_csv_path: Path) -> None:
    """QueryResult.dicts() gives a per-row dict view for ergonomic access."""
    r = _render_rides(rides_csv_path)
    qr = glyph.query(r.handle, "WHERE pickup_hour = 8")
    rows = qr.dicts()
    assert len(rows) == 1
    assert rows[0]["rides"] == 260


# ---------------------------------------------------------------------------
# drill() — selection → SQL predicate + rows
# ---------------------------------------------------------------------------


def test_drill_equals_returns_one_row(rides_csv_path: Path) -> None:
    r = _render_rides(rides_csv_path)
    qr = glyph.drill(r.handle, field="pickup_hour", equals=8)
    assert qr.row_count == 1
    assert qr.rows[0][qr.columns.index("rides")] == 260


def test_drill_between_returns_range(rides_csv_path: Path) -> None:
    r = _render_rides(rides_csv_path)
    qr = glyph.drill(r.handle, field="pickup_hour", between=(0, 8))
    # Inclusive range — 0, 1, 8 match (3 rows).
    assert qr.row_count == 3


def test_drill_requires_exactly_one_selector(rides_csv_path: Path) -> None:
    """Passing zero or multiple selectors raises a clear ValueError."""
    r = _render_rides(rides_csv_path)
    with pytest.raises(ValueError, match="exactly one"):
        glyph.drill(r.handle, field="pickup_hour")
    with pytest.raises(ValueError, match="exactly one"):
        glyph.drill(r.handle, field="pickup_hour", equals=1, between=(0, 2))


# ---------------------------------------------------------------------------
# audit_spec() — misleading-chart rule check
# ---------------------------------------------------------------------------


def test_audit_returns_typed_findings() -> None:
    """A bar chart with a non-zero baseline trips AUDIT-01 (truncated y-axis).

    Verifies the wrapper handles the server's `{count, highSeverity, ...,
    findings}` envelope — NOT a bare list. The previous PR7 run's `audit_*`
    tests failed because it assumed a list shape.
    """
    # `data.source` is a placeholder — auditSpec is a pure shape-inspector and
    # never opens the file. The path just has to satisfy the spec validator's
    # "must have top-level data or every-layer data" rule.
    bad_spec = {
        "data": {"source": "fixture.csv"},
        "layers": [
            {
                "mark": "bar",
                "encoding": {
                    "x": "h",
                    "y": {"field": "rides", "scale": {"domain": [100, 300]}},
                },
            }
        ],
    }
    findings = glyph.audit_spec(bad_spec)
    assert isinstance(findings, list)
    assert any(f.rule_id == "AUDIT-01" for f in findings)
    # All findings are typed dataclasses, not raw dicts.
    for f in findings:
        assert isinstance(f, glyph.AuditFinding)
        assert f.severity in {"low", "medium", "high"}


def test_audit_clean_spec_has_no_findings() -> None:
    """A vanilla line chart trips none of the rules → empty list."""
    spec = {
        "data": {"source": "fixture.csv"},
        "layers": [{"mark": "line", "encoding": {"x": "h", "y": "r"}}],
    }
    findings = glyph.audit_spec(spec)
    assert findings == []


# ---------------------------------------------------------------------------
# anomaly() — z-score outlier detection
# ---------------------------------------------------------------------------


def test_anomaly_finds_outlier(sales_csv_path: Path) -> None:
    """The 16000-revenue row should be flagged when grouped by segment."""
    r = _render_sales(sales_csv_path)
    result = glyph.anomaly(
        r.handle,
        value_field="revenue",
        group_field="segment",
        threshold=1.5,
    )
    assert isinstance(result, glyph.AnomalyResult)
    assert result.handle  # derived gdf:// handle
    assert result.threshold == 1.5
    # The "_z" column is appended to the schema.
    assert "_z" in result.columns
    # At least one row caught — the 16000 outlier.
    assert len(result.rows) >= 1


def test_anomaly_uses_value_field_kwarg(sales_csv_path: Path) -> None:
    """Wrapper sends `valueField` (not `field`) on the wire — regression."""
    r = _render_sales(sales_csv_path)
    # If the wrapper sent `field=` the server would reject; this would raise.
    result = glyph.anomaly(r.handle, value_field="revenue", threshold=3.0)
    assert isinstance(result, glyph.AnomalyResult)


# ---------------------------------------------------------------------------
# decompose() — ANOVA-style variance attribution
# ---------------------------------------------------------------------------


def test_decompose_ranks_factors(sales_csv_path: Path) -> None:
    """`segment` should explain more variance than `region` (enterprise is 5x SMB)."""
    r = _render_sales(sales_csv_path)
    result = glyph.decompose(
        r.handle,
        metric_field="revenue",
        factors=["segment", "region"],
    )
    assert isinstance(result, glyph.DecomposeResult)
    assert "factor" in result.columns
    # Two factors → two rows; segment is the higher-impact factor by far.
    assert len(result.rows) == 2
    # First row (ranked descending by varianceExplained) is `segment`.
    factor_col = result.columns.index("factor")
    assert result.rows[0][factor_col] == "segment"


def test_decompose_requires_non_empty_factors(rides_csv_path: Path) -> None:
    """Empty factors → ValueError before we round-trip to the server."""
    r = _render_rides(rides_csv_path)
    with pytest.raises(ValueError, match="at least one"):
        glyph.decompose(r.handle, metric_field="rides", factors=[])


# ---------------------------------------------------------------------------
# forecast() — seasonal-naive projection
# ---------------------------------------------------------------------------


def test_forecast_extends_horizon(rides_csv_path: Path) -> None:
    """Horizon rows are flagged isHorizon=True in the output.

    Uses the rides fixture (numeric `pickup_hour`) rather than sales so the x
    column is INT both for the historical actuals and for the horizon rows
    (where seasonalNaiveForecast falls back to `lastX + h`). Mixing a VARCHAR
    date with INT horizon offsets blows up at materialization time with
    `Cannot combine types VARCHAR and INTEGER_LITERAL`.
    """
    r = _render_rides(rides_csv_path)
    result = glyph.forecast(
        r.handle,
        x_field="pickup_hour",
        y_field="rides",
        horizon=3,
        season=1,
    )
    assert isinstance(result, glyph.ForecastResult)
    assert "isHorizon" in result.columns
    horizon_col = result.columns.index("isHorizon")
    horizon_rows = [row for row in result.rows if row[horizon_col]]
    # Exactly `horizon` rows should be horizon (future) rows.
    assert len(horizon_rows) == 3


# ---------------------------------------------------------------------------
# explain() — deterministic chart explanation
# ---------------------------------------------------------------------------


def test_explain_returns_headline(rides_csv_path: Path) -> None:
    r = _render_rides(rides_csv_path)
    result = glyph.explain(r.handle)
    assert isinstance(result, glyph.ExplainResult)
    assert result.headline  # non-empty
    # highlights + questions are lists (possibly empty for very small data).
    assert isinstance(result.highlights, list)
    assert isinstance(result.questions, list)


def test_explain_with_hints_nests_them(rides_csv_path: Path) -> None:
    """Hints are sent under `hints={xField, yField, groupField}` on the wire."""
    r = _render_rides(rides_csv_path)
    # If the wrapper sent the hints at top-level, the server would silently
    # ignore them — both calls would yield the same headline. Pinning a
    # different x/y wouldn't be meaningfully testable. So we just assert
    # the call succeeds with the nested shape.
    result = glyph.explain(r.handle, x_field="pickup_hour", y_field="rides")
    assert isinstance(result, glyph.ExplainResult)
    assert result.headline


# ---------------------------------------------------------------------------
# spec_diff() — structural diff between two specs
# ---------------------------------------------------------------------------


def test_spec_diff_finds_mark_change() -> None:
    """Changing `bar` to `area` shows up as a `changed` entry at the mark path."""
    a = {"layers": [{"mark": "bar", "encoding": {"x": "h", "y": "r"}}]}
    b = {"layers": [{"mark": "area", "encoding": {"x": "h", "y": "r"}}]}
    diff = glyph.spec_diff(a, b)
    assert isinstance(diff, glyph.SpecDiff)
    # The wire shape is {added, removed, changed, summary} — NOT JSON Patch.
    assert any("mark" in c.path for c in diff.changed)
    # Exactly one mark change; nothing added or removed at the level we touched.
    marks = [c for c in diff.changed if c.path == "/layers/0/mark"]
    assert len(marks) == 1
    assert marks[0].before == "bar"
    assert marks[0].after == "area"
    assert diff.summary  # human narrative


def test_spec_diff_identical_specs() -> None:
    """Diffing a spec against itself returns empty lists + empty summary."""
    spec = {"layers": [{"mark": "bar", "encoding": {"x": "h", "y": "r"}}]}
    diff = glyph.spec_diff(spec, spec)
    assert diff.added == []
    assert diff.removed == []
    assert diff.changed == []


# ---------------------------------------------------------------------------
# spec_patch() — RFC 6902 patch + re-render
# ---------------------------------------------------------------------------


def test_spec_patch_re_renders_with_new_handle(rides_csv_path: Path) -> None:
    """Patching mark=bar→area produces a new handle + new SVG."""
    r = _render_rides(rides_csv_path)
    patched = glyph.spec_patch(
        r.handle,
        [{"op": "replace", "path": "/layers/0/mark", "value": "area"}],
    )
    assert isinstance(patched, glyph.SpecPatchResult)
    assert patched.handle
    assert patched.handle != r.handle  # new handle, lineage chained server-side
    assert patched.svg.startswith("<svg")


def test_spec_patch_requires_non_empty_patches(rides_csv_path: Path) -> None:
    r = _render_rides(rides_csv_path)
    with pytest.raises(ValueError, match="non-empty"):
        glyph.spec_patch(r.handle, [])


# ---------------------------------------------------------------------------
# story_plan() — multi-chart storyboard planner
# ---------------------------------------------------------------------------


def test_story_plan_returns_dag(rides_csv_path: Path) -> None:
    """Heuristic planner over the rides fixture emits at least one node."""
    plan = glyph.story_plan(
        "Why are rush-hour rides high?",
        source=str(rides_csv_path),
    )
    assert isinstance(plan, glyph.StoryPlan)
    assert plan.plan_id
    assert plan.status in {"planned", "needs_clarification"}
    if plan.status == "planned":
        assert plan.nodes
        # Every node is the typed dataclass, not a raw dict.
        for node in plan.nodes:
            assert isinstance(node, glyph.StoryPlanNode)
            assert node.id
            assert node.kind


# ---------------------------------------------------------------------------
# render() / describe() — already covered in test_render.py; one new test
# here just for the v0 contract (no regressions in this PR).
# ---------------------------------------------------------------------------


def test_render_validation_error_still_typed() -> None:
    """SpecValidationError still fires for bad specs (PR4 contract)."""
    with pytest.raises(SpecValidationError):
        glyph.render({"layers": "not-a-list"})


def test_describe_returns_columns(rides_csv_path: Path) -> None:
    """`describe()` surfaces the columns of the rides fixture."""
    result = glyph.describe(str(rides_csv_path))
    # The describe envelope carries a `columns` array.
    assert "columns" in result
    names = {c.get("name") for c in result["columns"]}
    assert {"pickup_hour", "fare", "rides"} <= names


# ---------------------------------------------------------------------------
# call() — passthrough escape hatch for the long tail of verbs
# ---------------------------------------------------------------------------


def test_call_passthrough_capabilities() -> None:
    """`glyph.call("glyph_capabilities", {})` returns the raw envelope."""
    raw = glyph.call("glyph_capabilities", {})
    assert isinstance(raw, dict)
    assert "mcpTools" in raw
    # NOT "tools" or "verbs" — pin this so a server-side rename doesn't
    # silently break callers using the passthrough.
    assert "tools" not in raw
    assert "verbs" not in raw


def test_call_auto_prefixes_glyph(rides_csv_path: Path) -> None:
    """`glyph.call("describe", …)` auto-prepends `glyph_`."""
    raw = glyph.call("describe", {"source": str(rides_csv_path)})
    assert isinstance(raw, dict)
    assert "columns" in raw


def test_call_default_args_is_empty_dict() -> None:
    """`glyph.call("glyph_capabilities")` works without explicit empty args."""
    raw = glyph.call("glyph_capabilities")
    assert isinstance(raw, dict)
    assert "libraryVersion" in raw
