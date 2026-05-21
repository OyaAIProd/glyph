# `site/forkids.html` — Joy of Math kid-facing landing page

> **Execution window:** After Round 14 closes (E5 `glyph_story` + A4 sliders + A5 bezier all merged). Building before then = hollow sections. One PR; one commit; no architectural surface.

## Bar raiser this serves

An 8–15 year old lands on `https://glyph.example/forkids` and **within 3 seconds** sees an animated sine wave drawing itself with a traveling dot and a labeled peak. They click *"Show me something"* and land in the playground with the same spec pre-loaded, where they can drag sliders to reshape it. Then they scroll down and see three multi-scene math stories playing inline (circle → 2πr, square roots, pendulum swing). At the bottom they type *"Tell me about Fibonacci"* into a chat-style box and the page generates + renders a new chart inline using `glyph_story`, complete with the JSON recipe so they can see the magic.

This page is the **kid-facing storefront** for everything Joy of Math built. The technical `/site/showcase/` page stays the adult-facing pitch.

## Page sections + dependencies

| § | Section | Joy-of-Math capabilities used | Blocked-on PR |
|---|---------|-------------------------------|---------------|
| 1 | Hero with animated sine | A2 ✅ + E1 ✅ + E2 ✅ + E4 (R13) | E4 |
| 2 | "What can you make?" 4-tile gallery | A1/A3/math fixtures + E4 | E4 |
| 3 | "How does it work?" three-step | Just copy + spec snippets | — |
| 4 | "Show me what's inside" sliders | **A4 (R14)** | A4 |
| 5 | "Stories about numbers" three timelines | **E3 (R13)** + E1 ✅ + E2 ✅ | E3 |
| 6 | "Tell us what to make" prompt portal | **E5 (R14)** | E5 |
| 7 | For parents / teachers footer | Copy only | — |

All seven sections need to compose: §1 visually depends on the E4 BrandKit so the page CSS palette and the embedded chart palette match. §4 + §6 are the JS-enabled sections; everything else is static SVG + CSS.

## Design tokens

The page CSS uses the E4 `playground` BrandKit palette so visual + chart coherence is automatic:
- bg `#fefce8` warm cream, fg `#1f2937` soft black
- primary `#3b82f6`, accent `#facc15`
- font Comic Neue / Segoe Print / system sans
- chunky strokes, generous spacing, large hit targets

## Hard constraints

- **One HTML file** at `site/forkids.html`. ≤ 100 KB.
- All SVG demos **inlined** (rendered from fixtures at build time). Inline CSS.
- One small `<script>` (~5 KB) for §4 sliders + §6 prompt portal.
- **No CDN, no build step, no JS framework.** Loads on a school iPad.
- §1–3, §5, §7 work fully without JavaScript. §4 + §6 degrade gracefully (sliders fall back to static, prompt portal links to playground with examples).

## Implementation notes

- **§1 hero SVG**: render from a new fixture `__fixtures__/joy/sine-for-an-8yo.svg` produced by the E5 `glyph_story({intent: "sine wave", audience: "kid"})` call. That fixture becomes the canonical "what Joy of Math looks like."
- **§2 gallery tiles**: reuse the existing math fixtures (Lissajous, predator-prey, streamline-rotation, animated-pendulum). Each tile is the .svg file inlined, with a play/restart button via SMIL `<set begin="indefinite">` for kid-controlled replay.
- **§5 stories**: each is a new fixture under `__fixtures__/joy/`. Three new fixtures total (`circle-2pi-r.json`, `square-root.json`, `pendulum-swing.json`) — each ~3-5 scenes in the E3 timeline format.
- **§6 prompt portal**: when the page is served standalone (no MCP server), the prompt portal links to the playground with the typed intent pre-filled in the URL hash. When served alongside a running MCP server (e.g. via `glyph dev`), it calls the local `glyph_story` directly and renders inline.

## Acceptance gates

Tested cold with a real 8–15 year old + a parent:

1. **Under 10 seconds**: viewer can articulate "this is for making math pictures move."
2. **Under 60 seconds without instructions**: viewer plays with a slider OR clicks a story.
3. **Parent gate**: parent says "I'd send my kid here."

If gate 1 fails, the hero is too busy — strip back. If gate 2 fails, the call-to-action hierarchy is wrong — punch up §4. If gate 3 fails, the trust signals in §7 are thin — beef up the open-source/no-telemetry messaging.

## What this is NOT

- Not a tutorial site. Sections are demos + invitations, not lessons.
- Not a textbook. No symbolic algebra, no proofs.
- Not a sandbox. The playground (existing at `/site/play/`) is the sandbox; this page sends kids there.
- Not a replacement for `/site/math/` (technical) or `/site/showcase/` (adult marketing). It's a parallel surface for the kid persona.
