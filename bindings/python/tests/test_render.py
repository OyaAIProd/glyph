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


def test_render_respawns_after_subprocess_dies(rides_csv_path: Path) -> None:
    """If the MCP subprocess dies between calls, the runtime respawns silently.

    Without dead-subprocess detection the second call would hang on
    ``readline()`` against a closed pipe, then raise a confusing
    ``MCP server closed stdout`` error. The runtime now checks
    ``proc.returncode`` and respawns transparently.
    """
    import glyph._runtime as runtime

    # First render — warm the singleton.
    spec = {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]}
    r1 = glyph.render(spec, source=str(rides_csv_path), audit=False)
    assert r1.svg.startswith("<svg")

    # Forcibly kill the cached subprocess to simulate a crash.
    assert runtime._client is not None
    proc = runtime._client._proc  # type: ignore[attr-defined]
    proc.kill()
    # Drive the loop briefly so the SIGKILL propagates and returncode is set.
    runtime._get_loop().run_until_complete(proc.wait())

    # Next render must respawn rather than hang on the dead pipe.
    r2 = glyph.render(spec, source=str(rides_csv_path), audit=False)
    assert r2.svg.startswith("<svg")
    # Byte identity must hold across the respawn — that's the whole point.
    assert r1.svg == r2.svg


def test_render_rejects_call_from_running_event_loop(rides_csv_path: Path) -> None:
    """Calling glyph.render from inside an async coroutine raises a typed error.

    The current sync→async bridge can't safely re-enter from a running loop
    (Jupyter is the typical place). PR6 will add a worker-thread path; for
    now the call should fail loudly with a clear, actionable message instead
    of an internal RuntimeError.
    """
    import asyncio

    from glyph.exceptions import GlyphError

    async def _attempt_render() -> None:
        glyph.render(
            {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]},
            source=str(rides_csv_path),
        )

    with pytest.raises(GlyphError, match="running asyncio event loop"):
        asyncio.run(_attempt_render())
