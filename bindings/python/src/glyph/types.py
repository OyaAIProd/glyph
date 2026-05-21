"""Public types returned by the high-level API.

These are stable across the 0.x line; new fields will be additive. Internal
shapes returned by ``glyph._mcp_client`` are mapped onto these dataclasses by
``glyph.render``/``glyph.describe`` so callers never see raw MCP envelopes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

# Audit severities mirror the TypeScript ``AuditSeverity`` exactly — keep them
# in lockstep with ``packages/core/src/audit/index.ts`` when adding tiers.
AuditSeverity = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class AuditFinding:
    """One finding from ``glyph_audit_spec``.

    Field names mirror the TS ``AuditFinding`` shape one-for-one so the
    Python wrappers don't paper over rule taxonomy that callers may filter on.
    """

    rule_id: str
    severity: AuditSeverity
    message: str
    suggestion: str | None = None
    path: str | None = None


@dataclass(frozen=True)
class RenderResult:
    """The structured payload returned by :func:`glyph.render`.

    ``svg`` is the byte-stable compiled chart. ``handle`` is the local handle
    id (NOT a ``gdf://`` URI — call :func:`glyph.publish` to promote it).
    ``audit`` is populated when ``audit=True`` was passed to ``render``;
    otherwise it's an empty list. ``raw`` preserves the full wire envelope
    so callers can introspect fields we haven't surfaced yet (forward-compat
    parity with :class:`Capabilities`).
    """

    svg: str
    handle: str
    audit: list[AuditFinding] = field(default_factory=list)
    row_count: int | None = None
    view_name: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    def _repr_svg_(self) -> str:
        """IPython display hook — renders the SVG inline in Jupyter.

        Kept alongside :meth:`_repr_mimebundle_` so older readers (vscode
        nbconvert, GitHub's notebook preview) that only honour the
        single-mime ``_repr_svg_`` hook still render correctly.
        """
        return self.svg

    def _repr_mimebundle_(
        self, include: object = None, exclude: object = None
    ) -> tuple[dict[str, str], dict[str, str]]:
        """IPython rich-display hook.

        Returns ``(bundle, metadata)`` where ``bundle`` maps MIME types to
        their payload. We always return both ``image/svg+xml`` and
        ``text/plain`` so consumers that don't understand SVG (terminal
        REPLs, ``jupyter nbconvert --to script``) still see something
        meaningful. The ``include`` / ``exclude`` args are accepted for
        IPython protocol conformance — we ignore them because the bundle
        is small and producing it is free.
        """
        bundle = {
            "image/svg+xml": self.svg,
            "text/plain": (f"<RenderResult handle={self.handle!r} audit_n={len(self.audit)}>"),
        }
        return bundle, {}

    def save_svg(self, path: str | Path) -> None:
        """Write the SVG to ``path``. Creates parents only if they exist —
        callers wanting ``mkdir -p`` semantics should do it themselves so
        accidental typos don't sprinkle directories around the filesystem.
        """
        Path(path).write_text(self.svg, encoding="utf-8")


@dataclass(frozen=True)
class QueryResult:
    """Result of :func:`glyph.query` / :func:`glyph.drill`.

    Maps the wire ``{columns, rows, rowCount, truncated, total?, returned?}``
    envelope onto a Pythonic shape. ``rows`` is the row-of-arrays form
    straight from the server (cheap; no allocation). Iterate via
    :meth:`dicts` for a per-row dict view when callers want named field
    access.

    ``total`` and ``returned`` are populated only when ``truncated=True`` —
    the server emits them on the truncation envelope (``packages/mcp``
    ``glyph_query`` handler) so callers can distinguish "the engine returned
    N rows, all shown" from "the engine returned N rows, only M shown".
    """

    columns: list[str]
    rows: list[list[Any]]
    row_count: int
    truncated: bool = False
    total: int | None = None
    returned: int | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    def dicts(self) -> list[dict[str, Any]]:
        """Zip ``rows`` against ``columns`` into a list of dicts.

        Lazily allocated so callers that only want column-major access don't
        pay for the dict construction.
        """
        cols = self.columns
        return [dict(zip(cols, r, strict=False)) for r in self.rows]


@dataclass(frozen=True)
class SpecDiffChange:
    """One ``changed`` entry inside :class:`SpecDiff`. Path is RFC 6901."""

    path: str
    before: Any
    after: Any


@dataclass(frozen=True)
class SpecDiffEntry:
    """One ``added`` / ``removed`` entry inside :class:`SpecDiff`."""

    path: str
    value: Any


@dataclass(frozen=True)
class SpecDiff:
    """Structural diff between two Glyph specs.

    Mirrors ``packages/core/src/spec-diff`` SpecDiff one-for-one. NOT RFC 6902
    JSON Patch — the server returns ``{added, removed, changed, summary}``
    where paths are RFC 6901 pointers.
    """

    added: list[SpecDiffEntry] = field(default_factory=list)
    removed: list[SpecDiffEntry] = field(default_factory=list)
    changed: list[SpecDiffChange] = field(default_factory=list)
    summary: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AnomalyResult:
    """Result of :func:`glyph.anomaly` — z-score outliers + a derived handle.

    ``rows`` is the row-of-arrays form aligned to ``columns`` (the original
    schema plus a trailing ``_z`` column carrying the z-score). The derived
    ``handle`` is queryable like any other gdf:// handle.

    ``raw`` preserves the full wire envelope including per-segment mean/std
    stats (``raw["segments"]``) which we don't yet model as a typed field.
    """

    handle: str
    threshold: float
    columns: list[str]
    rows: list[list[Any]]
    explanation: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

    def dicts(self) -> list[dict[str, Any]]:
        cols = self.columns
        return [dict(zip(cols, r, strict=False)) for r in self.rows]


@dataclass(frozen=True)
class DecomposeResult:
    """Result of :func:`glyph.decompose` — ANOVA-style variance attribution."""

    handle: str
    grand_mean: float
    total_sse: float
    columns: list[str]
    rows: list[list[Any]]
    explanation: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ForecastResult:
    """Result of :func:`glyph.forecast` — seasonal-naive forecast + bands."""

    handle: str
    season: int
    residual_std: float
    columns: list[str]
    rows: list[list[Any]]
    explanation: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ExplainResult:
    """Result of :func:`glyph.explain` — deterministic chart explanation."""

    headline: str
    highlights: list[str] = field(default_factory=list)
    questions: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SpecPatchResult:
    """Result of :func:`glyph.spec_patch` — patched + re-rendered spec."""

    handle: str
    svg: str
    row_count: int | None = None
    view_name: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class StoryPlanNode:
    """One node in a :class:`StoryPlan`'s DAG."""

    id: str
    kind: str
    label: str
    depends_on: list[str] = field(default_factory=list)
    status: str = "pending"


@dataclass(frozen=True)
class StoryPlan:
    """Result of :func:`glyph.story_plan` — a planned analytic storyboard.

    The clarification-question wire shape is fluid across the 0.x line so
    ``clarification_questions`` is left as ``list[dict[str, Any]]`` — the
    closest thing to "structured but unmodeled". Callers prepared to depend
    on a specific shape can read ``raw["clarificationQuestions"]`` instead.
    """

    plan_id: str
    intent: str
    status: str
    nodes: list[StoryPlanNode] = field(default_factory=list)
    domain: str | None = None
    clarification_questions: list[dict[str, Any]] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Capabilities:
    """Result of :func:`glyph.capabilities` — feature detection.

    The library returns more than ``libraryVersion`` and ``mcpTools`` —
    ``specVersions``, ``marks``, ``stats``, ``renderers``, ``engines`` are
    also present. The full payload is preserved in ``raw`` so callers can
    introspect anything we haven't surfaced yet.
    """

    library_version: str
    mcp_tools: list[dict[str, str]] = field(default_factory=list)
    spec_versions: list[str] = field(default_factory=list)
    marks: list[str] = field(default_factory=list)
    stats: list[str] = field(default_factory=list)
    renderers: list[str] = field(default_factory=list)
    engines: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)
