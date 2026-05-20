"""Shared pytest fixtures. Expanded in later PRs."""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def mcp_server_args() -> list[str]:
    """Args to spawn the locally-built MCP server.

    Walks up from ``bindings/python/tests/conftest.py`` (3 parents) to the
    monorepo root, then points at ``packages/mcp/dist/bin.js``. If the bundle
    is missing the test is skipped — CI ensures the JS workspaces build before
    Python tests run.
    """
    repo_root = Path(__file__).resolve().parents[3]
    bin_path = repo_root / "packages" / "mcp" / "dist" / "bin.js"
    if not bin_path.exists():
        pytest.skip(f"MCP server not built: {bin_path}")
    return ["node", str(bin_path)]


@pytest.fixture
def rides_csv_path(tmp_path: Path) -> Path:
    """A small fixture CSV used by describe / render round-trips."""
    p = tmp_path / "rides.csv"
    p.write_text(
        "pickup_hour,fare,rides\n"
        "0,12.50,42\n"
        "1,11.20,38\n"
        "8,18.20,260\n"
        "17,16.30,240\n"
    )
    return p
