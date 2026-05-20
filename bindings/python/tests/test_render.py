"""End-to-end tests for the high-level ``glyph.render`` API.

These spin up a real MCP subprocess via the shared singleton runtime. The
``rides_csv_path`` fixture is defined in conftest.py.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import glyph
from glyph._runtime import shutdown_runtime
from glyph.exceptions import SpecValidationError


@pytest.fixture(autouse=True)
def _ensure_dev_mcp_bin() -> None:
    """Skip the module if the monorepo MCP bundle isn't built.

    Mirrors the gating in conftest.py's ``mcp_server_args``. The runtime's
    own resolve path will walk up to ``packages/mcp/dist/bin.js`` — if it's
    missing, the spawn errors out with a Node-side resolution failure, which
    surfaces as a confusing GlyphError. Skipping here keeps the dev signal
    clean.
    """
    repo_root = Path(__file__).resolve().parents[3]
    bin_path = repo_root / "packages" / "mcp" / "dist" / "bin.js"
    if not bin_path.exists():
        pytest.skip(f"MCP server not built: {bin_path}")


@pytest.fixture(autouse=True)
def _isolate_runtime() -> None:
    """Tear down the singleton between tests.

    Without this, state leaks across cases — e.g. a spec_validation error in
    one test could leave the loop in a stale state for the next. Cheap to
    respawn (≤1 s per test on a warm cache).
    """
    yield
    shutdown_runtime()


def test_render_returns_svg_string(rides_csv_path: Path) -> None:
    """render() returns a RenderResult whose .svg is a well-formed SVG string."""
    result = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]},
        source=str(rides_csv_path),
    )
    assert isinstance(result, glyph.RenderResult)
    assert result.svg.startswith("<svg")
    assert "</svg>" in result.svg


def test_render_returns_handle(rides_csv_path: Path) -> None:
    """The result includes a non-empty local handle id for follow-up queries.

    The handle is a session-local id (e.g. ``h_<hash>``), not a ``gdf://``
    URI — the latter only appears after :func:`glyph.publish` (lands later).
    """
    result = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]},
        source=str(rides_csv_path),
    )
    assert isinstance(result.handle, str)
    assert result.handle  # non-empty
    # Sanity: handles in S1 are not yet promoted to gdf:// — assert that so a
    # future change in shape that breaks this assumption is loud.
    assert not result.handle.startswith("gdf://")


def test_render_byte_identical(rides_csv_path: Path) -> None:
    """Same spec + same data → byte-identical SVG.

    This is Glyph's core determinism contract. If it ever fails, something
    in the render pipeline gained non-determinism (timestamps, IDs, etc.).
    """
    spec = {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]}
    r1 = glyph.render(spec, source=str(rides_csv_path), audit=False)
    r2 = glyph.render(spec, source=str(rides_csv_path), audit=False)
    assert r1.svg == r2.svg


def test_render_validation_error_is_typed() -> None:
    """Invalid specs raise SpecValidationError, not generic GlyphError.

    ``layers`` must be a non-empty array; passing a string triggers the
    spec parser before any data access, so we don't need a real CSV here.
    """
    with pytest.raises(SpecValidationError):
        glyph.render({"layers": "not-a-list"}, source="nonexistent.csv")
