"""Tests for Jupyter / IPython display integration.

Covers the display hooks on :class:`RenderResult` plus the worker-thread
sync→async bridge that makes ``glyph.render(...)`` callable from inside a
running event loop (Jupyter cells, ``asyncio.run(...)``, anyio tasks).

The worker-loop assertion is the one that *previously* xfailed: PR4's
``run_until_complete`` design couldn't re-enter an active loop. PR6's
worker-thread design routes the call to a separate loop, so it now passes.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

import glyph
from glyph._runtime import shutdown_runtime


@pytest.fixture(autouse=True)
def _ensure_dev_mcp_bin() -> None:
    """Skip if the JS workspaces haven't been built yet.

    Mirrors the guard in ``test_render.py`` — without ``packages/mcp/dist/
    bin.js`` the runtime can't spawn the MCP server, so the tests would fail
    with a confusing "node returned non-zero" stack trace instead of a clean
    skip.
    """
    repo_root = Path(__file__).resolve().parents[3]
    bin_path = repo_root / "packages" / "mcp" / "dist" / "bin.js"
    if not bin_path.exists():
        pytest.skip(f"MCP server not built: {bin_path}")


@pytest.fixture(autouse=True)
def _isolate_runtime() -> None:
    """Drop the singleton between cases.

    Each test exercises a slightly different async context (top-level sync,
    inside ``asyncio.run``). Sharing a singleton would let a prior test's
    worker thread mask bugs in startup ordering.
    """
    yield
    shutdown_runtime()


def test_render_result_repr_svg(rides_csv_path: Path) -> None:
    """``_repr_svg_`` returns the raw SVG string.

    This is the single-mime hook that older Jupyter consumers (vscode's
    notebook preview, GitHub's .ipynb renderer) honour. Asserting on the
    exact return value would couple the test to the SVG byte stream, so we
    only check the structural invariants — starts with ``<svg``, ends with
    a closing tag — that callers actually depend on.
    """
    result = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]},
        source=str(rides_csv_path),
    )
    svg = result._repr_svg_()
    assert isinstance(svg, str)
    assert svg.startswith("<svg")
    assert "</svg>" in svg
    # Single-mime hook must mirror the .svg attribute exactly. Drift here
    # would mean two display paths show different bytes, breaking the byte-
    # identity contract Glyph promises across surfaces.
    assert svg == result.svg


def test_render_result_repr_mimebundle(rides_csv_path: Path) -> None:
    """``_repr_mimebundle_`` returns ``(bundle, metadata)`` with both mimes."""
    result = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]},
        source=str(rides_csv_path),
    )
    bundle, metadata = result._repr_mimebundle_()
    assert isinstance(bundle, dict)
    assert isinstance(metadata, dict)
    # SVG path is the primary mime — IPython picks it over text/plain
    # automatically in notebook contexts. The text/plain fallback ensures
    # terminal REPLs / `nbconvert --to script` still show something.
    assert "image/svg+xml" in bundle
    assert bundle["image/svg+xml"] == result.svg
    assert "text/plain" in bundle
    assert "RenderResult" in bundle["text/plain"]
    assert result.handle in bundle["text/plain"]


def test_render_works_inside_asyncio_run(rides_csv_path: Path) -> None:
    """``glyph.render`` is callable from inside a running event loop.

    PR4's runtime raised ``GlyphError`` here because ``loop.run_until_complete``
    can't re-enter an active loop. PR6 routes the call onto a worker thread's
    own loop via ``run_coroutine_threadsafe``, so the caller blocks on a
    sync ``concurrent.futures.Future`` instead. This test is the canonical
    Jupyter / asyncio.run case — if it ever regresses, notebook users will
    be stuck again.
    """
    spec = {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]}

    async def _render_inside_loop() -> glyph.RenderResult:
        # Calling glyph.render from inside a coroutine MUST work. Note we
        # call it directly (not via to_thread) — the worker-loop bridge
        # handles the cross-thread dispatch internally.
        return glyph.render(spec, source=str(rides_csv_path), audit=False)

    result = asyncio.run(_render_inside_loop())
    assert isinstance(result, glyph.RenderResult)
    assert result.svg.startswith("<svg")


def test_jupyter_display_without_ipython_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """``glyph.jupyter.display`` raises ImportError if IPython is missing.

    The dev venv has IPython installed (it's in the ``[dev]`` extra), so we
    simulate the headless case by stubbing the import to raise. This keeps
    the test useful in environments where IPython happens to be installed.
    """
    import builtins
    import sys

    # Drop any cached IPython modules so the simulated ImportError takes
    # effect on the next `from IPython.display import display`.
    for mod in list(sys.modules):
        if mod == "IPython" or mod.startswith("IPython."):
            monkeypatch.delitem(sys.modules, mod, raising=False)

    real_import = builtins.__import__

    def _no_ipython(name: str, *args: object, **kwargs: object) -> object:
        if name == "IPython" or name.startswith("IPython."):
            raise ImportError("simulated: IPython not installed")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _no_ipython)

    from glyph.jupyter import display
    from glyph.types import RenderResult

    fake = RenderResult(svg="<svg/>", handle="h_test")
    with pytest.raises(ImportError, match="IPython"):
        display(fake)


def test_register_ipython_completions_is_noop() -> None:
    """``register_ipython_completions`` is a reserved hook — currently a no-op.

    Future PRs will wire verb / spec-key completion. The function exists today
    so notebook templates can call it unconditionally; we assert the no-op
    contract so the template stays stable until the real implementation
    lands.
    """
    from glyph.jupyter import register_ipython_completions

    assert register_ipython_completions() is None
