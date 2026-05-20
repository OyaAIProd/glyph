"""Public types returned by the high-level API.

These are stable across the 0.x line; new fields will be additive. Internal
shapes returned by ``glyph._mcp_client`` are mapped onto these dataclasses by
``glyph.render``/``glyph.describe`` so callers never see raw MCP envelopes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

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
    otherwise it's an empty list.
    """

    svg: str
    handle: str
    audit: list[AuditFinding] = field(default_factory=list)
    row_count: int | None = None
    view_name: str | None = None

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
