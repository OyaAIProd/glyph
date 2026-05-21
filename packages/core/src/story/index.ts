/**
 * Joy of Math PR E5 — barrel export for the `glyph_story` composer.
 *
 * The MCP server (`packages/mcp`) imports `composeStory` + its types
 * from `@glyph/core`. Keeping the export confined to a single barrel
 * file lets us evolve the internal layout (e.g. split recipes into
 * their own modules later) without touching downstream consumers.
 */
export {
  composeStory,
  type ComposeStoryInput,
  type ComposeStoryResult,
  type StoryAudience,
  type StoryCaption,
} from "./compose.js";
