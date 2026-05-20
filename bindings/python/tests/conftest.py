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
    p.write_text("pickup_hour,fare,rides\n0,12.50,42\n1,11.20,38\n8,18.20,260\n17,16.30,240\n")
    return p


@pytest.fixture
def sales_csv_path(tmp_path: Path) -> Path:
    """Richer fixture for diagnostic verbs.

    14 rows by 2 categorical columns (``region``, ``segment``) + a daily date
    column + a quantitative ``revenue``. Wide enough that decompose has
    factors to rank, anomaly has a clear outlier, and forecast has a
    season-of-7 to lean on.
    """
    p = tmp_path / "sales.csv"
    rows = [
        "date,region,segment,revenue",
        "2024-01-01,us,smb,1000",
        "2024-01-02,us,smb,1020",
        "2024-01-03,us,smb,1010",
        "2024-01-04,us,smb,1030",
        "2024-01-05,us,smb,1040",
        "2024-01-06,us,smb,1015",
        "2024-01-07,us,smb,1025",
        "2024-01-08,us,enterprise,5000",
        "2024-01-09,us,enterprise,5100",
        "2024-01-10,us,enterprise,5050",
        "2024-01-11,eu,smb,800",
        "2024-01-12,eu,smb,820",
        "2024-01-13,eu,smb,810",
        # Anomaly row — 20x the segment's mean.
        "2024-01-14,eu,smb,16000",
    ]
    p.write_text("\n".join(rows) + "\n")
    return p
