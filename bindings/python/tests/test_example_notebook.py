"""Smoke-execute the canonical example notebook.

This is the same gate CI will run via ``jupyter nbconvert --execute`` —
encoded as a pytest so local dev catches notebook breakage in the same run
as the unit tests, and so it skips cleanly when nbclient / nbformat aren't
installed (they're only in the ``[jupyter]`` / ``[dev]`` extras).
"""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _ensure_dev_mcp_bin() -> None:
    """Skip when the MCP server bundle isn't built — same gate as test_render."""
    repo_root = Path(__file__).resolve().parents[3]
    bin_path = repo_root / "packages" / "mcp" / "dist" / "bin.js"
    if not bin_path.exists():
        pytest.skip(f"MCP server not built: {bin_path}")


def test_example_notebook_executes_top_to_bottom() -> None:
    """`examples/01_hello_chart.ipynb` runs to completion via nbclient.

    Equivalent to ``jupyter nbconvert --execute --to notebook ...``. We use
    nbclient directly so the test stays in-process (no extra subprocess) and
    so failures surface as Python tracebacks rather than the nbconvert
    wrapper's noisier "An error occurred while executing the following cell"
    output.

    The notebook MUST execute cleanly because it's the first thing a new
    user sees in the README. A regression here = broken first-run UX.
    """
    nbformat = pytest.importorskip("nbformat")
    nbclient = pytest.importorskip("nbclient")

    nb_path = Path(__file__).resolve().parents[1] / "examples" / "01_hello_chart.ipynb"
    assert nb_path.exists(), f"example notebook missing: {nb_path}"

    nb = nbformat.read(str(nb_path), as_version=4)
    # 120s is plenty even on a cold MCP spawn; the actual cell wall-clock is
    # ~2-3s on a warm cache.
    client = nbclient.NotebookClient(nb, timeout=120, kernel_name="python3")
    client.execute()

    # Every code cell must have produced at least one output. A cell that
    # silently runs without yielding output is usually a sign the notebook
    # template drifted from the actual API (e.g. attribute was renamed and
    # the bare-name display fell through).
    code_cells = [c for c in nb.cells if c.cell_type == "code"]
    assert code_cells, "notebook should contain code cells"
    for i, cell in enumerate(code_cells):
        assert cell.outputs, f"code cell {i} produced no output"

    # The render cell (cell index 1 of code cells, index 3 of all cells) must
    # emit an SVG mimebundle — that's the whole point of the integration.
    render_cell = code_cells[1]
    mimes: set[str] = set()
    for out in render_cell.outputs:
        data = out.get("data") or {}
        mimes.update(data.keys())
    assert "image/svg+xml" in mimes, f"render cell did not emit SVG; got mimes={sorted(mimes)}"
