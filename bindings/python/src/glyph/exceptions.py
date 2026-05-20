"""Public exception types."""


class GlyphError(Exception):
    """Base class for all Glyph errors."""


class NodeNotFoundError(GlyphError):
    """Raised when no compatible Node.js runtime is found on PATH."""


class McpProtocolError(GlyphError):
    """Raised when the MCP server returns an unexpected response."""


class SpecValidationError(GlyphError):
    """Raised when a spec fails validation before render."""
