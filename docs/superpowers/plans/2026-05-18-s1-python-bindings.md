# S1 — Python bindings (`pip install glyph`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended). Each PR below is one subagent dispatch. Steps use checkbox (`- [ ]`) syntax for tracking. The master PR cycle template lives in `2026-05-18-tier-s-master.md`.

**Goal:** Ship a Python package `glyph` on PyPI that exposes the full Glyph MCP surface (49 verbs) to Python users via a subprocess-to-Node bridge. MVP within 6 weeks; Jupyter + pandas integration included.

**Architecture:** A pure-Python package that, on first call, spawns the bundled-or-system-Node `@glyph/mcp` server as a subprocess, speaks JSON-RPC over stdio, and exposes high-level Python wrappers. No native code, no Rust port (deferred to v1.0). Wheel is platform-independent; user supplies Node ≥ 20.

**Tech stack:**
- Python ≥ 3.10
- `hatch` for packaging (modern, simple, supports trusted publishing)
- `pytest` + `pytest-asyncio` for tests
- `ruff` for lint/format
- `mypy` for type checking
- `pandas` (optional dep) for DataFrame integration
- No required deps for the core path

**Effort:** L (8 PRs, ~6 calendar weeks at 1–2 PRs/week).

**Calendar:** Weeks 1–6.

---

## File structure

```
bindings/python/
├── pyproject.toml              # hatch config, deps, classifiers
├── README.md                   # PyPI front page (different from repo README)
├── LICENSE                     # Apache 2.0 (copy of repo LICENSE)
├── src/
│   └── glyph/
│       ├── __init__.py         # public API: render, describe, query, audit, ...
│       ├── _mcp_client.py      # JSON-RPC stdio client (internal)
│       ├── _node.py            # find Node, spawn @glyph/mcp (internal)
│       ├── _resolve.py         # path resolution for npx vs bundled bin
│       ├── types.py            # public types: RenderResult, Spec, AuditFinding, ...
│       ├── pandas.py           # optional pandas integration
│       ├── jupyter.py          # IPython display helpers (auto-loaded if IPython present)
│       └── exceptions.py       # GlyphError, NodeNotFoundError, ...
├── tests/
│   ├── conftest.py             # pytest fixtures: mcp_client, sample_df
│   ├── test_mcp_client.py
│   ├── test_node.py
│   ├── test_render.py
│   ├── test_pandas.py
│   ├── test_jupyter.py
│   ├── test_verbs.py
│   └── fixtures/
│       └── rides.csv
└── examples/
    ├── 01_hello_chart.ipynb
    ├── 02_pandas_pipeline.ipynb
    └── 03_anomaly_detection.py
```

`bindings/python/` lives at the monorepo root, alongside `packages/`. The CI workflow `.github/workflows/python.yml` runs on its own matrix (Python 3.10/3.11/3.12 × Linux/macOS/Windows).

---

## Task 1: PR1 — Repo scaffolding

**Branch:** `feat/s1-python-scaffold`

**Files:**
- Create: `bindings/python/pyproject.toml`
- Create: `bindings/python/README.md`
- Create: `bindings/python/LICENSE`
- Create: `bindings/python/src/glyph/__init__.py`
- Create: `bindings/python/src/glyph/exceptions.py`
- Create: `bindings/python/tests/conftest.py`
- Create: `bindings/python/tests/test_smoke.py`
- Create: `.github/workflows/python.yml`
- Modify: `.gitignore` (add `bindings/python/dist/`, `__pycache__/`, `*.egg-info/`)

- [ ] **Step 1: Decide PyPI package name**

Check availability:

```bash
curl -s https://pypi.org/pypi/glyph/json | head -3
```

If 200 OK → `glyph` is taken; fall back to `glyph-charts` (preferred), then `pyglyph`, then `agent-glyph`. Use whichever is free. **For this plan: assume `glyph-charts` if `glyph` is taken.** Pivot all `name = "glyph"` references below to the chosen name.

- [ ] **Step 2: Write `pyproject.toml`**

```toml
[build-system]
requires = ["hatchling>=1.21"]
build-backend = "hatchling.build"

[project]
name = "glyph"
version = "0.1.0a1"
description = "Deterministic chart compiler with 49 agent-callable verbs. Python bindings."
readme = "README.md"
license = "Apache-2.0"
requires-python = ">=3.10"
authors = [{ name = "Glyph contributors" }]
keywords = ["charts", "visualization", "mcp", "agents", "duckdb", "svg"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: Apache Software License",
    "Operating System :: OS Independent",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Topic :: Scientific/Engineering :: Visualization",
]
dependencies = []

[project.optional-dependencies]
pandas = ["pandas>=2.0"]
jupyter = ["ipython>=8.0"]
all = ["pandas>=2.0", "ipython>=8.0"]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "ruff>=0.5",
    "mypy>=1.10",
    "pandas>=2.0",
    "ipython>=8.0",
]

[project.urls]
Homepage = "https://github.com/seanhanca/glyph"
Documentation = "https://github.com/seanhanca/glyph#readme"
Repository = "https://github.com/seanhanca/glyph"
Issues = "https://github.com/seanhanca/glyph/issues"

[tool.hatch.build.targets.wheel]
packages = ["src/glyph"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py310"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "SIM", "RUF"]

[tool.mypy]
python_version = "3.10"
strict = true
```

- [ ] **Step 3: Write `src/glyph/__init__.py`**

```python
"""Glyph — deterministic chart compiler. Python bindings."""

from glyph.exceptions import GlyphError, NodeNotFoundError

__version__ = "0.1.0a1"
__all__ = ["GlyphError", "NodeNotFoundError"]
```

- [ ] **Step 4: Write `src/glyph/exceptions.py`**

```python
"""Public exception types."""


class GlyphError(Exception):
    """Base class for all Glyph errors."""


class NodeNotFoundError(GlyphError):
    """Raised when no compatible Node.js runtime is found on PATH."""


class McpProtocolError(GlyphError):
    """Raised when the MCP server returns an unexpected response."""


class SpecValidationError(GlyphError):
    """Raised when a spec fails validation before render."""
```

- [ ] **Step 5: Write the smoke test**

```python
# tests/test_smoke.py
import glyph


def test_version_is_set():
    assert glyph.__version__.startswith("0.")


def test_exceptions_importable():
    from glyph import GlyphError, NodeNotFoundError

    assert issubclass(NodeNotFoundError, GlyphError)
```

- [ ] **Step 6: Write `.github/workflows/python.yml`**

```yaml
name: python

on:
  push:
    branches: [main]
    paths: ["bindings/python/**", ".github/workflows/python.yml"]
  pull_request:
    paths: ["bindings/python/**", ".github/workflows/python.yml"]

jobs:
  test:
    name: py${{ matrix.python }} on ${{ matrix.os }}
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        python: ["3.10", "3.11", "3.12"]

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python }}
      - name: Install
        working-directory: bindings/python
        run: |
          python -m pip install --upgrade pip
          pip install -e ".[dev]"
      - name: Lint
        working-directory: bindings/python
        run: |
          ruff check src tests
          ruff format --check src tests
      - name: Type check
        working-directory: bindings/python
        run: mypy src
      - name: Test
        working-directory: bindings/python
        run: pytest -q
```

- [ ] **Step 7: Write `bindings/python/README.md`**

This is the PyPI landing page. Keep it short and code-first. Use the same style as the repo README's Quickstart but Python-focused.

```markdown
# Glyph — Python bindings

Deterministic chart compiler. 49 agent-callable verbs. Embedded DuckDB. Byte-stable SVG.

## Install

```bash
pip install glyph
```

Requires Node.js ≥ 20 on PATH (the package shells out to the bundled MCP server).

## Quickstart

```python
import pandas as pd
import glyph

df = pd.read_csv("rides.csv")
result = glyph.render({
    "layers": [{"mark": "bar", "encoding": {"x": "hour", "y": "rides"}}],
}, data=df)

result.svg            # bytes-identical SVG string
result.handle         # gdf://... — pass to query/audit/explain
result.audit          # list of AuditFinding
```

In Jupyter, `result` renders inline.

## More

- Full docs: https://github.com/seanhanca/glyph
- 49-verb API: `glyph.describe`, `glyph.query`, `glyph.audit`, `glyph.anomaly`, `glyph.forecast`, `glyph.story_plan`, `glyph.whyboard`, ...

Apache 2.0 · no telemetry · self-hostable
```

- [ ] **Step 8: Run the standard PR cycle**

See `2026-05-18-tier-s-master.md` → `[PR-CYCLE]`.

Acceptance for PR1:
- `pip install -e ".[dev]"` succeeds
- `pytest -q` shows 2 passing tests
- `ruff check src tests` is clean
- `mypy src` is clean
- CI workflow runs green on all 9 matrix cells

---

## Task 2: PR2 — MCP stdio client

**Branch:** `feat/s1-mcp-client`

**Files:**
- Create: `bindings/python/src/glyph/_mcp_client.py`
- Create: `bindings/python/tests/test_mcp_client.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_mcp_client.py
import asyncio
import json
import pytest
from glyph._mcp_client import McpClient


@pytest.mark.asyncio
async def test_initialize_returns_capabilities(mcp_server_args):
    """The client can perform the MCP initialize handshake."""
    async with McpClient.spawn(mcp_server_args) as client:
        result = await client.initialize()
        assert result["serverInfo"]["name"] == "glyph-mcp"
        assert "tools" in result["capabilities"]


@pytest.mark.asyncio
async def test_list_tools_returns_full_surface(mcp_server_args):
    """All 49 verbs are exposed."""
    async with McpClient.spawn(mcp_server_args) as client:
        await client.initialize()
        tools = await client.list_tools()
        names = [t["name"] for t in tools]
        assert "glyph_render" in names
        assert "glyph_audit_spec" in names
        assert len(names) >= 49


@pytest.mark.asyncio
async def test_call_describe_round_trip(mcp_server_args, rides_csv_path):
    """A real describe call works end-to-end."""
    async with McpClient.spawn(mcp_server_args) as client:
        await client.initialize()
        result = await client.call_tool(
            "glyph_describe", {"source": str(rides_csv_path)}
        )
        assert "schema" in result or "fields" in result  # one of these


@pytest.mark.asyncio
async def test_protocol_error_raises(mcp_server_args):
    """Unknown verbs raise McpProtocolError, not generic Exception."""
    from glyph.exceptions import McpProtocolError

    async with McpClient.spawn(mcp_server_args) as client:
        await client.initialize()
        with pytest.raises(McpProtocolError):
            await client.call_tool("glyph_does_not_exist", {})
```

- [ ] **Step 2: Add fixtures to `conftest.py`**

```python
# tests/conftest.py
from pathlib import Path
import pytest


@pytest.fixture
def mcp_server_args() -> list[str]:
    """Args to spawn the locally-built MCP server."""
    repo_root = Path(__file__).resolve().parents[3]  # bindings/python/tests → repo
    bin_path = repo_root / "packages" / "mcp" / "dist" / "bin.js"
    if not bin_path.exists():
        pytest.skip(f"MCP server not built: {bin_path}")
    return ["node", str(bin_path)]


@pytest.fixture
def rides_csv_path(tmp_path) -> Path:
    """A small fixture CSV identical to the one in sandbox/."""
    p = tmp_path / "rides.csv"
    p.write_text(
        "pickup_hour,fare,rides\n"
        "0,12.50,42\n"
        "1,11.20,38\n"
        "8,18.20,260\n"
        "17,16.30,240\n"
    )
    return p
```

- [ ] **Step 3: Run the test to confirm failure**

```bash
cd bindings/python
pytest tests/test_mcp_client.py -v
```

Expected: `ImportError: cannot import name 'McpClient' from 'glyph._mcp_client'`.

- [ ] **Step 4: Implement `_mcp_client.py`**

```python
# src/glyph/_mcp_client.py
"""MCP stdio JSON-RPC client. Internal."""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from glyph.exceptions import McpProtocolError, GlyphError

PROTOCOL_VERSION = "2024-11-05"


class McpClient:
    """Async JSON-RPC client over stdio. Spawn one, initialize, call tools."""

    def __init__(self, proc: asyncio.subprocess.Process) -> None:
        self._proc = proc
        self._next_id = 0
        self._initialized = False

    @classmethod
    @asynccontextmanager
    async def spawn(cls, args: list[str]) -> AsyncIterator["McpClient"]:
        """Spawn the MCP server, yield a client, terminate on exit."""
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        client = cls(proc)
        try:
            yield client
        finally:
            try:
                proc.terminate()
                await asyncio.wait_for(proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()

    async def initialize(self) -> dict[str, Any]:
        result = await self._request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "clientInfo": {"name": "glyph-py", "version": "0.1.0"},
                "capabilities": {},
            },
        )
        # Send the required initialized notification.
        await self._send_notification("notifications/initialized", {})
        self._initialized = True
        return result

    async def list_tools(self) -> list[dict[str, Any]]:
        assert self._initialized, "call initialize() first"
        result = await self._request("tools/list", {})
        return result["tools"]

    async def call_tool(self, name: str, args: dict[str, Any]) -> Any:
        assert self._initialized, "call initialize() first"
        try:
            result = await self._request(
                "tools/call", {"name": name, "arguments": args}
            )
        except McpProtocolError:
            raise
        # MCP returns {content: [{type: "text", text: "..."}]}; parse if JSON.
        content = result.get("content", [])
        if content and content[0].get("type") == "text":
            text = content[0]["text"]
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return text
        return result

    async def _request(self, method: str, params: dict[str, Any]) -> Any:
        self._next_id += 1
        req_id = self._next_id
        await self._send({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})
        while True:
            msg = await self._recv()
            if msg.get("id") == req_id:
                if "error" in msg:
                    err = msg["error"]
                    raise McpProtocolError(f"{method}: {err.get('message')} ({err.get('code')})")
                return msg["result"]
            # Notifications and other ids: ignore for the simple client. The
            # full implementation will dispatch notifications/progress to a
            # callback (PR-7).

    async def _send_notification(self, method: str, params: dict[str, Any]) -> None:
        await self._send({"jsonrpc": "2.0", "method": method, "params": params})

    async def _send(self, msg: dict[str, Any]) -> None:
        line = (json.dumps(msg) + "\n").encode()
        assert self._proc.stdin is not None
        self._proc.stdin.write(line)
        await self._proc.stdin.drain()

    async def _recv(self) -> dict[str, Any]:
        assert self._proc.stdout is not None
        line = await self._proc.stdout.readline()
        if not line:
            stderr = ""
            if self._proc.stderr is not None:
                stderr = (await self._proc.stderr.read()).decode("utf-8", errors="replace")
            raise GlyphError(f"MCP server closed stdout. stderr:\n{stderr}")
        return json.loads(line.decode("utf-8"))
```

- [ ] **Step 5: Run the tests, fix until green**

```bash
pytest tests/test_mcp_client.py -v
```

Expected: 4 tests passing.

- [ ] **Step 6: Commit + open PR**

Follow `[PR-CYCLE]`. PR title: `feat(python): MCP stdio client (PR2/8)`.

Acceptance for PR2:
- Client can spawn + initialize + list 49 tools + call describe + error on unknown verb
- All 4 tests green on the 9-cell CI matrix
- `mypy src` clean
- No `Any` returns from public methods (use `TypedDict` where it tightens up later)

---

## Task 3: PR3 — Node resolution + spawn

**Branch:** `feat/s1-node-resolve`

**Files:**
- Create: `bindings/python/src/glyph/_node.py`
- Create: `bindings/python/src/glyph/_resolve.py`
- Create: `bindings/python/tests/test_node.py`
- Modify: `bindings/python/src/glyph/_mcp_client.py` (use `_node.resolve_mcp_args()` for default args)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_node.py
import pytest
from glyph._node import find_node, NodeNotFoundError, resolve_mcp_args


def test_find_node_returns_path_when_available():
    """Node is on PATH in CI; find_node returns it."""
    path = find_node()
    assert path is not None
    assert path.exists()


def test_find_node_raises_when_missing(monkeypatch):
    """When PATH is empty, find_node raises NodeNotFoundError."""
    monkeypatch.setenv("PATH", "")
    with pytest.raises(NodeNotFoundError) as exc_info:
        find_node()
    assert "20" in str(exc_info.value)  # error message mentions required version


def test_resolve_mcp_args_uses_npx_by_default():
    """Default: spawn `npx -y @glyph/mcp`."""
    args = resolve_mcp_args()
    assert args[0].name in {"node", "npx", "npx.cmd"}
    # If npx: args should be ["npx", "-y", "@glyph/mcp"]


def test_resolve_mcp_args_respects_env_override(monkeypatch, tmp_path):
    """GLYPH_MCP_BIN overrides default resolution."""
    custom = tmp_path / "custom-bin.js"
    custom.write_text("// stub")
    monkeypatch.setenv("GLYPH_MCP_BIN", str(custom))
    args = resolve_mcp_args()
    assert str(custom) in args
```

- [ ] **Step 2: Implement `_node.py`**

```python
# src/glyph/_node.py
"""Resolve a Node.js runtime + the path to the MCP server."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from glyph.exceptions import NodeNotFoundError

REQUIRED_NODE_MAJOR = 20


def find_node() -> Path:
    """Return the path to a node binary on PATH, or raise NodeNotFoundError."""
    candidate = shutil.which("node")
    if candidate is None:
        raise NodeNotFoundError(
            f"Glyph requires Node.js ≥ {REQUIRED_NODE_MAJOR}, but `node` is not on PATH. "
            "Install from https://nodejs.org or set the GLYPH_MCP_BIN environment variable "
            "to point at a pre-built bin.js."
        )
    return Path(candidate).resolve()


def find_npx() -> Path | None:
    candidate = shutil.which("npx")
    return Path(candidate).resolve() if candidate else None


def resolve_mcp_args() -> list[str]:
    """Return the argv to spawn the MCP server.

    Resolution order:
      1. $GLYPH_MCP_BIN — explicit path to a bin.js
      2. ./node_modules/@glyph/mcp/dist/bin.js (monorepo dev)
      3. npx -y @glyph/mcp (production default)
    """
    # 1. Env override
    env_bin = os.environ.get("GLYPH_MCP_BIN")
    if env_bin:
        node = find_node()
        return [str(node), env_bin]

    # 2. Monorepo dev (relative to this file, walk up)
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "packages" / "mcp" / "dist" / "bin.js"
        if candidate.exists():
            return [str(find_node()), str(candidate)]

    # 3. Production: npx -y @glyph/mcp
    npx = find_npx()
    if npx is None:
        raise NodeNotFoundError(
            "Neither GLYPH_MCP_BIN nor `npx` are available. "
            f"Install Node.js ≥ {REQUIRED_NODE_MAJOR}."
        )
    return [str(npx), "-y", "@glyph/mcp"]
```

- [ ] **Step 3: Wire `_mcp_client.py` to use `resolve_mcp_args` as default**

In `McpClient.spawn`, change the signature so `args` defaults to `None` and falls back to `resolve_mcp_args()`:

```python
@classmethod
@asynccontextmanager
async def spawn(
    cls, args: list[str] | None = None
) -> AsyncIterator["McpClient"]:
    from glyph._node import resolve_mcp_args
    if args is None:
        args = resolve_mcp_args()
    # ... rest unchanged
```

Update the existing `test_mcp_client.py` calls — they pass explicit `mcp_server_args`, which still works.

- [ ] **Step 4: Run tests, fix until green**

```bash
pytest tests/test_node.py tests/test_mcp_client.py -v
```

- [ ] **Step 5: Commit + open PR**

PR title: `feat(python): resolve Node + MCP binary (PR3/8)`.

Acceptance for PR3:
- `find_node()` returns a path on dev machines; raises a clear error if missing
- `resolve_mcp_args()` finds the dev binary in the monorepo when called from the dev checkout
- `GLYPH_MCP_BIN` override works (documented in `_node.py` docstring)
- All tests green on 9 cells

---

## Task 4: PR4 — High-level `render()` API

**Branch:** `feat/s1-render-api`

**Files:**
- Create: `bindings/python/src/glyph/types.py`
- Modify: `bindings/python/src/glyph/__init__.py` (export render + types)
- Create: `bindings/python/src/glyph/_runtime.py` (singleton client)
- Create: `bindings/python/tests/test_render.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_render.py
import pytest
import glyph


def test_render_returns_svg_string(rides_csv_path):
    """render() returns a RenderResult with an SVG string."""
    result = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]},
        source=str(rides_csv_path),
    )
    assert result.svg.startswith("<svg")
    assert "</svg>" in result.svg


def test_render_returns_handle(rides_csv_path):
    """The result includes a gdf:// handle for follow-up queries."""
    result = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]},
        source=str(rides_csv_path),
    )
    assert result.handle.startswith("gdf://")


def test_render_byte_identical(rides_csv_path):
    """Same spec + same data → byte-identical SVG."""
    spec = {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]}
    r1 = glyph.render(spec, source=str(rides_csv_path))
    r2 = glyph.render(spec, source=str(rides_csv_path))
    assert r1.svg == r2.svg


def test_render_validation_error_is_typed():
    """Invalid specs raise SpecValidationError, not generic GlyphError."""
    from glyph.exceptions import SpecValidationError

    with pytest.raises(SpecValidationError):
        glyph.render({"layers": "not-a-list"}, source="nonexistent.csv")
```

- [ ] **Step 2: Implement `types.py`**

```python
# src/glyph/types.py
"""Public types returned by the high-level API."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass(frozen=True)
class AuditFinding:
    rule: str
    severity: Literal["error", "warning", "info"]
    message: str
    fix: str | None = None


@dataclass(frozen=True)
class RenderResult:
    svg: str
    handle: str
    audit: list[AuditFinding] = field(default_factory=list)
    rows_processed: int | None = None
    truncated: bool = False

    def _repr_svg_(self) -> str:
        """IPython display hook — renders the SVG inline in Jupyter."""
        return self.svg

    def save_svg(self, path: str) -> None:
        from pathlib import Path
        Path(path).write_text(self.svg, encoding="utf-8")
```

- [ ] **Step 3: Implement `_runtime.py` (singleton subprocess pool)**

```python
# src/glyph/_runtime.py
"""Singleton MCP client. Spawned on first use, cached for the process lifetime.

For test code that wants isolation, call shutdown_runtime() between cases.
"""
from __future__ import annotations

import asyncio
import threading
from typing import Any

from glyph._mcp_client import McpClient

_client: McpClient | None = None
_loop: asyncio.AbstractEventLoop | None = None
_lock = threading.Lock()


def _get_loop() -> asyncio.AbstractEventLoop:
    global _loop
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
    return _loop


async def _ensure_client() -> McpClient:
    global _client
    if _client is None:
        ctx = McpClient.spawn()
        _client = await ctx.__aenter__()  # we own teardown via shutdown_runtime
        await _client.initialize()
    return _client


def call_verb(name: str, args: dict[str, Any]) -> Any:
    """Synchronous entrypoint. Runs the async call on the runtime loop."""
    with _lock:
        loop = _get_loop()

        async def _go() -> Any:
            client = await _ensure_client()
            return await client.call_tool(name, args)

        return loop.run_until_complete(_go())


def shutdown_runtime() -> None:
    """Tear down the singleton client. Called atexit + on demand from tests."""
    global _client, _loop
    with _lock:
        if _client is not None and _loop is not None:
            try:
                _loop.run_until_complete(_client._proc.wait_closed())  # type: ignore[attr-defined]
            except Exception:
                pass
            _client = None
        if _loop is not None:
            _loop.close()
            _loop = None


import atexit

atexit.register(shutdown_runtime)
```

(Note: the `_proc.wait_closed` placeholder above is wrong for asyncio subprocesses — replace with `_proc.terminate(); await _proc.wait()` in the actual impl. The test must verify clean shutdown.)

- [ ] **Step 4: Implement `__init__.py` public API**

```python
# src/glyph/__init__.py
"""Glyph — deterministic chart compiler. Python bindings."""
from __future__ import annotations

from typing import Any, Mapping

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
    "render",
    "describe",
]


def render(
    spec: Mapping[str, Any],
    *,
    source: str | None = None,
    data: Any = None,  # accepts pandas.DataFrame; coerced via glyph.pandas (PR5)
    audit: bool = True,
) -> RenderResult:
    """Render a chart spec to SVG.

    Args:
        spec: The chart specification (a JSON-shaped dict).
        source: Path or URL to a data file (CSV / Parquet / JSON). Mutually
            exclusive with ``data``.
        data: An inline DataFrame or list-of-dicts. Mutually exclusive with
            ``source``.
        audit: When True (default), run the 8 audit rules on the spec.

    Returns:
        RenderResult with .svg, .handle, .audit findings.

    Raises:
        SpecValidationError: spec is malformed.
        NodeNotFoundError: Node.js is not installed.
    """
    if source is not None and data is not None:
        raise ValueError("Pass exactly one of `source` or `data`")

    full_spec = dict(spec)
    if source is not None:
        full_spec.setdefault("data", {})["source"] = source
    elif data is not None:
        from glyph.pandas import dataframe_to_inline_data  # lazy import
        full_spec["data"] = dataframe_to_inline_data(data)

    try:
        raw = call_verb("glyph_render", {"spec": full_spec})
    except McpProtocolError as e:
        if "validation" in str(e).lower() or "spec" in str(e).lower():
            raise SpecValidationError(str(e)) from e
        raise

    findings_raw = []
    if audit:
        audit_raw = call_verb("glyph_audit_spec", {"spec": full_spec})
        findings_raw = audit_raw.get("findings", [])

    return RenderResult(
        svg=raw["svg"],
        handle=raw["handle"],
        audit=[
            AuditFinding(
                rule=f["rule"],
                severity=f["severity"],
                message=f["message"],
                fix=f.get("fix"),
            )
            for f in findings_raw
        ],
        rows_processed=raw.get("rows_processed"),
        truncated=raw.get("truncated", False),
    )


def describe(source: str) -> dict[str, Any]:
    """Describe a data source — schema, suggested encodings, row count."""
    return call_verb("glyph_describe", {"source": source})
```

- [ ] **Step 5: Run tests, fix until green**

```bash
pytest tests/test_render.py -v
```

Acceptance for PR4:
- `glyph.render(spec, source=...)` returns a `RenderResult` with SVG + handle
- Byte-identity assertion holds (same input → exact same bytes)
- Validation errors are typed (`SpecValidationError`)
- `glyph.describe(path)` works

PR title: `feat(python): high-level render + describe (PR4/8)`.

---

## Task 5: PR5 — pandas integration

**Branch:** `feat/s1-pandas`

**Files:**
- Create: `bindings/python/src/glyph/pandas.py`
- Create: `bindings/python/tests/test_pandas.py`

- [ ] **Step 1: Failing test**

```python
# tests/test_pandas.py
import pytest

pd = pytest.importorskip("pandas")

import glyph
from glyph.pandas import dataframe_to_inline_data


def test_dataframe_to_inline_data_roundtrip():
    df = pd.DataFrame({"hour": [0, 1, 2], "rides": [42, 38, 30]})
    inline = dataframe_to_inline_data(df)
    assert inline["values"] == [
        {"hour": 0, "rides": 42},
        {"hour": 1, "rides": 38},
        {"hour": 2, "rides": 30},
    ]


def test_render_accepts_dataframe():
    df = pd.DataFrame({"hour": [0, 1, 2, 3], "rides": [42, 38, 30, 50]})
    result = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "hour", "y": "rides"}}]},
        data=df,
    )
    assert result.svg.startswith("<svg")


def test_render_handles_nan_columns():
    """NaN values are emitted as null and the renderer doesn't crash."""
    df = pd.DataFrame({"hour": [0, 1, 2], "rides": [42, float("nan"), 30]})
    result = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "hour", "y": "rides"}}]},
        data=df,
    )
    assert "<svg" in result.svg
```

- [ ] **Step 2: Implement `pandas.py`**

```python
# src/glyph/pandas.py
"""Pandas DataFrame ↔ Glyph data shape."""
from __future__ import annotations

import math
from typing import Any

try:
    import pandas as pd
except ImportError as e:
    raise ImportError(
        "glyph.pandas requires `pandas` — install with `pip install glyph[pandas]`"
    ) from e


def dataframe_to_inline_data(df: pd.DataFrame) -> dict[str, Any]:
    """Convert a DataFrame to Glyph's inline data shape.

    NaN floats are emitted as JSON null. Datetime columns are ISO strings.
    """
    records: list[dict[str, Any]] = []
    for row in df.to_dict(orient="records"):
        clean = {}
        for k, v in row.items():
            if isinstance(v, float) and math.isnan(v):
                clean[k] = None
            elif isinstance(v, pd.Timestamp):
                clean[k] = v.isoformat()
            else:
                clean[k] = v
        records.append(clean)
    return {"values": records}
```

- [ ] **Step 3: Run tests, fix until green**

Acceptance for PR5:
- DataFrame round-trip works for ints, floats, NaN, dates
- `glyph.render(spec, data=df)` works end-to-end
- Optional dep — importing `glyph` without pandas installed still succeeds

PR title: `feat(python): pandas integration (PR5/8)`.

---

## Task 6: PR6 — Jupyter display

**Branch:** `feat/s1-jupyter`

**Files:**
- Create: `bindings/python/src/glyph/jupyter.py`
- Modify: `bindings/python/src/glyph/types.py` (already has `_repr_svg_`; add `_repr_mimebundle_`)
- Create: `bindings/python/tests/test_jupyter.py`
- Create: `bindings/python/examples/01_hello_chart.ipynb`

- [ ] **Step 1: Failing test**

```python
# tests/test_jupyter.py
import glyph


def test_render_result_repr_svg(rides_csv_path):
    """_repr_svg_ returns the SVG string for IPython display."""
    result = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]},
        source=str(rides_csv_path),
    )
    svg = result._repr_svg_()
    assert svg.startswith("<svg")


def test_render_result_repr_mimebundle(rides_csv_path):
    """_repr_mimebundle_ returns multiple mime types for rich display."""
    result = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]},
        source=str(rides_csv_path),
    )
    bundle, _metadata = result._repr_mimebundle_()
    assert "image/svg+xml" in bundle
    assert "text/plain" in bundle  # graceful fallback
```

- [ ] **Step 2: Update `types.py`**

```python
# Add to RenderResult in src/glyph/types.py
def _repr_mimebundle_(
    self, include: object = None, exclude: object = None
) -> tuple[dict[str, str], dict[str, str]]:
    bundle = {
        "image/svg+xml": self.svg,
        "text/plain": f"<RenderResult handle={self.handle!r} audit_n={len(self.audit)}>",
    }
    return bundle, {}
```

- [ ] **Step 3: Write the example notebook**

```python
# examples/01_hello_chart.ipynb
# Cell 1
import pandas as pd
import glyph

df = pd.DataFrame({
    "hour": list(range(24)),
    "rides": [40, 35, 30, 28, 30, 60, 120, 200, 260, 180, 130, 110,
              100, 105, 110, 130, 200, 260, 240, 180, 130, 100, 70, 50],
})
df.head()

# Cell 2
result = glyph.render(
    {"layers": [{"mark": "bar", "encoding": {"x": "hour", "y": "rides"}}]},
    data=df,
)
result  # → renders inline in Jupyter

# Cell 3
for f in result.audit:
    print(f"[{f.severity}] {f.rule}: {f.message}")
```

Save as `.ipynb` format using nbformat.

Acceptance for PR6:
- `_repr_svg_` and `_repr_mimebundle_` return the right shapes
- Notebook executes top-to-bottom on `jupyter nbconvert --execute`
- CI workflow runs `jupyter nbconvert --execute examples/01_hello_chart.ipynb` and fails on error

PR title: `feat(python): Jupyter display + example notebook (PR6/8)`.

---

## Task 7: PR7 — Full verb surface

**Branch:** `feat/s1-full-verbs`

**Files:**
- Modify: `bindings/python/src/glyph/__init__.py`
- Create: `bindings/python/tests/test_verbs.py`

- [ ] **Step 1: Identify verbs worth wrapping (vs. raw passthrough)**

49 verbs total. Wrap these 12 with typed signatures (they have the highest user value):

```
render, describe, query, audit_spec, anomaly, decompose, forecast,
explain, drill, spec_diff, spec_patch, story_plan
```

The rest are accessible via `glyph.call("glyph_xxx", args)` — a thin passthrough.

- [ ] **Step 2: Failing test**

```python
# tests/test_verbs.py
import glyph


def test_query_against_handle(rides_csv_path):
    """A handle from render() can be queried with SQL."""
    r = glyph.render(
        {"layers": [{"mark": "bar", "encoding": {"x": "pickup_hour", "y": "rides"}}]},
        source=str(rides_csv_path),
    )
    rows = glyph.query(r.handle, "SELECT pickup_hour, rides FROM materialized ORDER BY rides DESC LIMIT 3")
    assert len(rows) == 3


def test_anomaly_detection(rides_csv_path):
    r = glyph.render(
        {"layers": [{"mark": "point", "encoding": {"x": "pickup_hour", "y": "rides"}}]},
        source=str(rides_csv_path),
    )
    anomalies = glyph.anomaly(r.handle, field="rides", method="zscore")
    assert "outliers" in anomalies


def test_spec_diff_returns_jsonpatch():
    a = {"layers": [{"mark": "bar", "encoding": {"x": "h", "y": "r"}}]}
    b = {"layers": [{"mark": "area", "encoding": {"x": "h", "y": "r"}}]}
    patch = glyph.spec_diff(a, b)
    assert any(op["op"] == "replace" for op in patch)


def test_passthrough_works(rides_csv_path):
    """Unwrapped verbs work via glyph.call()."""
    result = glyph.call("glyph_capabilities", {})
    assert "tools" in result or "verbs" in result
```

- [ ] **Step 3: Implement the verbs in `__init__.py`**

Add explicit functions for the 12 high-value verbs + a `call(name, args)` passthrough. Each function has a typed signature with docstring referencing the MCP verb name.

```python
# Sample shape — repeat for each
def query(handle: str, sql: str, *, limit: int | None = 1000) -> list[dict[str, Any]]:
    """Run SQL against a materialized chart handle. Maps to glyph_query."""
    args = {"handle": handle, "sql": sql}
    if limit is not None:
        args["limit_rows"] = limit
    result = call_verb("glyph_query", args)
    return result["rows"]


def anomaly(handle: str, *, field: str, method: str = "zscore") -> dict[str, Any]:
    """Detect outliers in a field. Maps to glyph_anomaly."""
    return call_verb("glyph_anomaly", {"handle": handle, "field": field, "method": method})


def call(verb: str, args: dict[str, Any]) -> Any:
    """Escape hatch — call any of the 49 MCP verbs by name."""
    if not verb.startswith("glyph_"):
        verb = "glyph_" + verb
    return call_verb(verb, args)
```

Acceptance for PR7:
- 12 typed wrappers + 1 passthrough
- All wrappers have docstrings naming the MCP verb they map to
- Test for each high-value verb (4 in the failing-test list above, plus 4 more added during impl)

PR title: `feat(python): full verb surface (PR7/8)`.

---

## Task 8: PR8 — Publish to TestPyPI then PyPI

**Branch:** `chore/s1-release`

**Files:**
- Create: `.github/workflows/python-release.yml`
- Modify: `bindings/python/pyproject.toml` (bump to `0.1.0`)
- Modify: `README.md` (root — change install line from `pip install <package>` placeholder to real)
- Modify: `site/index.html` (Python tab in get-started)

- [ ] **Step 1: Configure trusted publishing on PyPI**

In the PyPI web UI: project → publishing → add GitHub OIDC entry for `seanhanca/glyph`, workflow `python-release.yml`, environment `release`.

(Hand-step; document in CONTRIBUTING.md.)

- [ ] **Step 2: Write the release workflow**

```yaml
# .github/workflows/python-release.yml
name: python-release

on:
  push:
    tags: ["python-v*"]

jobs:
  release:
    runs-on: ubuntu-latest
    environment: release
    permissions:
      id-token: write   # PyPI trusted publishing
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - name: Build
        working-directory: bindings/python
        run: |
          python -m pip install --upgrade pip build
          python -m build
      - name: Publish to TestPyPI (release-candidate tags only)
        if: contains(github.ref, '-rc')
        uses: pypa/gh-action-pypi-publish@release/v1
        with:
          packages-dir: bindings/python/dist
          repository-url: https://test.pypi.org/legacy/
      - name: Publish to PyPI (final tags)
        if: ${{ !contains(github.ref, '-rc') }}
        uses: pypa/gh-action-pypi-publish@release/v1
        with:
          packages-dir: bindings/python/dist
```

- [ ] **Step 3: Smoke-test on TestPyPI first**

```bash
# Tag a release candidate
git tag python-v0.1.0-rc1
git push origin python-v0.1.0-rc1
# Wait for workflow → installable from test.pypi.org
pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ glyph==0.1.0rc1
python -c "import glyph; print(glyph.__version__)"
```

- [ ] **Step 4: If RC clean, tag the final release**

```bash
git tag python-v0.1.0
git push origin python-v0.1.0
```

- [ ] **Step 5: Update README + site**

In `README.md`, replace placeholder install lines with the verified `pip install glyph`. In `site/index.html`, add a Python tab to the "Use it as a TypeScript library / MCP server" section.

- [ ] **Step 6: Run the standard PR cycle for the docs PR**

PR title: `chore(release): publish glyph@0.1.0 to PyPI (PR8/8)`.

Acceptance for PR8:
- `pip install glyph` works from a clean venv with Node 20 installed
- README + site mention pip install
- Tag `python-v0.1.0` exists on `main`

---

## Acceptance criteria for S1 overall

- [ ] `pip install glyph` on PyPI (or `glyph-charts` if that name pivot was needed)
- [ ] Works on Python 3.10/3.11/3.12 × Linux/macOS/Windows (9-cell matrix green)
- [ ] Covers 12 high-value verbs as typed Python functions + a passthrough for the rest
- [ ] Renders inline in Jupyter (svg mime bundle)
- [ ] Round-trips pandas DataFrames
- [ ] README + landing site updated with Python install instructions
- [ ] Launch post: HN Show HN, r/Python, r/dataisbeautiful

---

## Self-review

**Spec coverage:**
- ✅ Ships `pip install glyph` (or near-name) within 90 days
- ✅ MVP via subprocess-to-Node, not Rust port
- ✅ Unlocks Python data ecosystem (pandas + Jupyter as first-class)

**No placeholders:** every PR has file paths, function signatures, test code, and acceptance criteria. The `_proc.wait_closed` note in PR4 is the only nit and is flagged inline.

**Type consistency:**
- `RenderResult` defined PR4, used PR5/6/7 ✓
- `AuditFinding` defined PR4, used PR4/7 ✓
- `McpClient.spawn(args)` signature: extended PR2 → defaulted PR3; tests in both updated together ✓
