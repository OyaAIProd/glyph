"""Tests for the optional pandas integration.

Skipped wholesale if pandas isn't installed — keeping the core path
pandas-free is a stated S1 acceptance criterion. The end-to-end render tests
still require the MCP bundle (same gating as ``test_render.py``).
"""

from __future__ import annotations

from pathlib import Path

import pytest

pd = pytest.importorskip("pandas")

import glyph  # noqa: E402 — must import after the pandas guard
from glyph._runtime import shutdown_runtime  # noqa: E402
from glyph.pandas import dataframe_to_inline_data  # noqa: E402


@pytest.fixture(autouse=True)
def _ensure_dev_mcp_bin() -> None:
    """Skip end-to-end tests when the monorepo MCP bundle isn't built.

    Mirrors the gate in ``test_render.py`` — the unit tests on
    ``dataframe_to_inline_data`` don't need the subprocess but we skip the
    whole module for simplicity. Re-evaluate if the unit count grows.
    """
    repo_root = Path(__file__).resolve().parents[3]
    bin_path = repo_root / "packages" / "mcp" / "dist" / "bin.js"
    if not bin_path.exists():
        pytest.skip(f"MCP server not built: {bin_path}")


@pytest.fixture(autouse=True)
def _isolate_runtime() -> None:
    """Tear down the singleton between tests (same rationale as test_render.py)."""
    yield
    shutdown_runtime()


def test_dataframe_to_inline_data_roundtrip() -> None:
    """Plain ints + strings round-trip without coercion."""
    df = pd.DataFrame({"hour": [0, 1, 2], "rides": [42, 38, 30]})
    inline = dataframe_to_inline_data(df)
    assert inline == {
        "values": [
            {"hour": 0, "rides": 42},
            {"hour": 1, "rides": 38},
            {"hour": 2, "rides": 30},
        ]
    }


def test_dataframe_to_inline_data_handles_nan() -> None:
    """float NaN cells become JSON null (Python None)."""
    df = pd.DataFrame({"hour": [0, 1, 2], "rides": [42.0, float("nan"), 30.0]})
    inline = dataframe_to_inline_data(df)
    assert inline["values"][1]["rides"] is None
    # Surrounding rows untouched — coercion is strictly cell-local.
    assert inline["values"][0]["rides"] == 42.0
    assert inline["values"][2]["rides"] == 30.0


def test_dataframe_to_inline_data_handles_timestamps() -> None:
    """pandas.Timestamp serializes to an ISO-8601 string; NaT → None."""
    df = pd.DataFrame(
        {
            "ts": [
                pd.Timestamp("2024-01-01T00:00:00"),
                pd.Timestamp("2024-06-15T12:34:56"),
                pd.NaT,
            ],
            "n": [1, 2, 3],
        }
    )
    inline = dataframe_to_inline_data(df)
    rows = inline["values"]
    assert rows[0]["ts"] == "2024-01-01T00:00:00"
    assert rows[1]["ts"] == "2024-06-15T12:34:56"
    assert rows[2]["ts"] is None


def test_render_accepts_dataframe() -> None:
    """glyph.render(data=df) renders end-to-end via glyph_import."""
    df = pd.DataFrame({"hour": [0, 1, 2, 3], "rides": [42, 38, 30, 50]})
    result = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "hour", "y": "rides"}}]},
        data=df,
    )
    assert isinstance(result, glyph.RenderResult)
    assert result.svg.startswith("<svg")
    assert "</svg>" in result.svg


def test_render_handles_nan_dataframe() -> None:
    """NaN floats survive the pipeline as null and the renderer doesn't crash.

    DuckDB will surface them as SQL NULL when reading the temp CSV
    ``glyph_import`` writes, so the bar for "hour=1" has a missing y. The
    compiler treats that as a skipped sample rather than a hard error.
    """
    df = pd.DataFrame({"hour": [0, 1, 2], "rides": [42.0, float("nan"), 30.0]})
    result = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "hour", "y": "rides"}}]},
        data=df,
    )
    assert result.svg.startswith("<svg")


def test_render_rejects_both_source_and_data() -> None:
    """Passing source= and data= together is a programmer error → ValueError."""
    df = pd.DataFrame({"hour": [0], "rides": [1]})
    with pytest.raises(ValueError, match="exactly one"):
        glyph.render(
            {"layers": [{"mark": "bar", "encoding": {"x": "hour", "y": "rides"}}]},
            source="ignored.csv",
            data=df,
        )


def test_render_rejects_non_dataframe_data() -> None:
    """Non-DataFrame data= argument raises ValueError with a clear message."""
    with pytest.raises(ValueError, match=r"pandas\.DataFrame"):
        glyph.render(
            {"layers": [{"mark": "bar", "encoding": {"x": "hour", "y": "rides"}}]},
            data=[{"hour": 0, "rides": 1}],
        )


@pytest.mark.xfail(
    reason=(
        "Known bug — temporal axis doesn't survive the "
        "pandas → ISO string → glyph_import → CSV → DuckDB round-trip. "
        "Timestamps land as VARCHAR in DuckDB and the chart's "
        '`encoding.x.type = "temporal"` doesn\'t reparse them; the x-axis '
        "shows integer indices (0/40/50) instead of date labels. The fix "
        "is in the TS-side import path (either preserve dtype hints through "
        "glyph_import or auto-coerce ISO strings to TIMESTAMP when the "
        "encoding requests temporal). Tracked as a follow-up — keeping this "
        "test as xfail so the regression catch lights up the moment the "
        "underlying bug is fixed (xfail → xpass would be a strict failure)."
    ),
    strict=True,
)
def test_render_with_timestamp_column_temporal_axis() -> None:
    """End-to-end: pd.Timestamp column → ISO string → DuckDB temporal axis.

    The conversion path is `pandas → ISO string → glyph_import → CSV →
    DuckDB → temporal scale`. This test locks the full round-trip so a
    future change to `dataframe_to_inline_data`'s Timestamp formatting (or
    to the MCP server's CSV materializer) that breaks the temporal axis
    fails loudly here instead of in some unrelated downstream chart.
    """
    df = pd.DataFrame(
        {
            "date": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"]),
            "rides": [42, 38, 50],
        }
    )
    result = glyph.render(
        {
            "layers": [
                {
                    "mark": "line",
                    "encoding": {
                        "x": {"field": "date", "type": "temporal"},
                        "y": "rides",
                    },
                }
            ]
        },
        data=df,
    )
    assert result.svg.startswith("<svg")
    # The x-axis should have rendered tick labels with the date values.
    # Don't lock specific tick text (format may vary by axis-tick algorithm);
    # just confirm "2024" appears so we know the temporal axis didn't fall
    # back to "x=0,1,2" via integer parsing of the ISO string.
    assert "2024" in result.svg


def test_render_with_extension_dtypes() -> None:
    """Pandas' nullable extension dtypes (Int64, boolean) round-trip cleanly.

    The Int64 / boolean dtypes use `pd.NA` for missing values rather than
    NaN. The cell-by-cell coercion in `_coerce` catches `pd.NA` via
    `pd.isna`, so missing extension values surface as None. Non-null
    extension scalars (numpy.int64 / pandas.BooleanDtype-backed) should
    JSON-serialize correctly through the MCP transport.
    """
    df = pd.DataFrame(
        {
            "hour": pd.array([0, 1, 2], dtype="Int64"),
            "active": pd.array([True, pd.NA, False], dtype="boolean"),
            "rides": [10, 20, 30],
        }
    )
    result = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "hour", "y": "rides"}}]},
        data=df,
    )
    assert result.svg.startswith("<svg")


def test_dataframe_to_inline_data_emits_pd_na_as_none() -> None:
    """Sanity-check: pd.NA in an Int64 column becomes JSON null (None)."""
    df = pd.DataFrame({"v": pd.array([1, pd.NA, 3], dtype="Int64")})
    inline = dataframe_to_inline_data(df)
    assert inline["values"] == [{"v": 1}, {"v": None}, {"v": 3}]
