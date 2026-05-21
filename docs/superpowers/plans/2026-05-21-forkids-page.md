# `site/forkids.html` — Joy of Math kid-facing landing page

> **Execution window:** After Round 14 closes (E5 `glyph_story` + A4 sliders + A5 bezier all merged). Building before then = hollow sections. One PR; one commit; no architectural surface.

## Bar raiser this serves

An 8–15 year old lands on `https://glyph.example/forkids` and **within 3 seconds** sees an animated sine wave drawing itself with a traveling dot and a labeled peak. They click *"Show me something"* and land in the playground with the same spec pre-loaded, where they can drag sliders to reshape it. Then they scroll past a four-tile gallery, past "how does it work?", and hit a **three.js 3D wow break**: the five Platonic solids orbiting in 3D ("Plato thought these were the building blocks of the universe — mathematicians proved there are EXACTLY 5") and a rolling-wave sine surface they can drag-orbit, formula labeled live above. They keep scrolling and see three multi-scene math stories playing inline (circle → 2πr, square roots, pendulum swing). At the bottom they type *"Tell me about Fibonacci"* into a chat-style box and the page generates + renders a new chart inline using `glyph_story`, complete with the JSON recipe so they can see the magic.

This page is the **kid-facing storefront** for everything Joy of Math built. The technical `/site/showcase/` page stays the adult-facing pitch.

## Page sections + dependencies

| § | Section | Joy-of-Math capabilities used | Blocked-on PR |
|---|---------|-------------------------------|---------------|
| 1 | Hero with animated sine | A2 ✅ + E1 ✅ + E2 ✅ + E4 (R13) | E4 |
| 2 | "What can you make?" 4-tile gallery | A1/A3/math fixtures + E4 | E4 |
| 3 | "How does it work?" three-step | Just copy + spec snippets | — |
| 3.5 | **"Math gets weird in 3D" three.js wow demos** | **three.js (vendored, lazy-loaded)** | — |
| 4 | "Show me what's inside" sliders | **A4 (R14)** | A4 |
| 5 | "Stories about numbers" three timelines | **E3 (R13)** + E1 ✅ + E2 ✅ | E3 |
| 6 | "Tell us what to make" prompt portal | **E5 (R14)** | E5 |
| 7 | For parents / teachers footer | Copy only | — |

All eight sections need to compose: §1 visually depends on the E4 BrandKit so the page CSS palette and the embedded chart palette match. §3.5 + §4 + §6 are the JS-enabled sections; everything else is static SVG + CSS. §3.5 is the only WebGL-dependent section; it must degrade to a static SVG fallback when WebGL is unavailable (low-end school iPad, fingerprint-blocking browsers, prefers-reduced-motion).

## Design tokens

The page CSS uses the E4 `playground` BrandKit palette so visual + chart coherence is automatic:
- bg `#fefce8` warm cream, fg `#1f2937` soft black
- primary `#3b82f6`, accent `#facc15`
- font Comic Neue / Segoe Print / system sans
- chunky strokes, generous spacing, large hit targets

## Hard constraints

- **One HTML file** at `site/forkids.html`. **≤ 100 KB** for the page itself (HTML + inline CSS + inline SVGs + the small inline `<script>`).
- All SVG demos **inlined** (rendered from fixtures at build time). Inline CSS.
- One small inline `<script>` (~5 KB) for §4 sliders + §6 prompt portal + §3.5 lazy-loader.
- **No CDN, no build step, no JS framework.** Loads on a school iPad.
- §1–3, §5, §7 work fully without JavaScript. §3.5 + §4 + §6 degrade gracefully (3D falls back to inlined SVG poster frames, sliders fall back to static, prompt portal links to playground with examples).
- **§3.5 three.js exception**: three.js is **vendored** as a separate sibling asset (`site/forkids-3d.js` ≈ **500 KB minified / 128 KB gzipped over the wire** — three.js's WebGLRenderer + material system alone is ~230 KB minified, so the original optimistic 200 KB target was not achievable for two demos that need lighting + orbit controls; the gzipped wire cost is the user-visible number). It is **lazy-loaded** via `IntersectionObserver` only when §3.5 scrolls into view, so the initial paint of the page is unaffected and bandwidth-limited devices that never reach §3.5 never pay the cost. The page proper (forkids.html) stays ≤ 100 KB. **Still no CDN** — the file is self-hosted next to forkids.html.

## Implementation notes

- **§1 hero SVG**: render from a new fixture `__fixtures__/joy/sine-for-an-8yo.svg` produced by the E5 `glyph_story({intent: "sine wave", audience: "kid"})` call. That fixture becomes the canonical "what Joy of Math looks like."
- **§2 gallery tiles**: reuse the existing math fixtures (Lissajous, predator-prey, streamline-rotation, animated-pendulum). Each tile is the .svg file inlined, with a play/restart button via SMIL `<set begin="indefinite">` for kid-controlled replay.
- **§3.5 three.js wow demos**: see "§3.5 detail" below.
- **§5 stories**: each is a new fixture under `__fixtures__/joy/`. Three new fixtures total (`circle-2pi-r.json`, `square-root.json`, `pendulum-swing.json`) — each ~3-5 scenes in the E3 timeline format.
- **§6 prompt portal**: when the page is served standalone (no MCP server), the prompt portal links to the playground with the typed intent pre-filled in the URL hash. When served alongside a running MCP server (e.g. via `glyph dev`), it calls the local `glyph_story` directly and renders inline.

## §3.5 detail — three.js wow demos

**Goal:** Kids who scroll past §3 ("how it works") need a payoff before §4 ("now you try the sliders"). Two short, magnetic 3D demos that say "this math you've been seeing in 2D? Look what it does in 3D." Each demo is **interactive** (drag to orbit) and **labeled** (a HUD shows the math driving it).

### Demo A — "The 5 perfect shapes" (Platonic solids carousel)

**What it shows:** All five Platonic solids — tetrahedron, cube, octahedron, dodecahedron, icosahedron — orbiting on a horizontal circle in 3D, each slowly spinning on its own axis. Tap one and the camera dollies in and the other four fade to 20% opacity. A floating caption reads "**Plato thought these were the building blocks of the universe. Mathematicians later proved there are EXACTLY 5.**" Each solid carries a small label with its face count + the per-face polygon ("8 triangles", "12 pentagons", …).

**Why kids:** Visceral "ancient secret" framing (Plato, Kepler) + a falsifiable claim ("exactly 5") + tactile interaction. The 5-only constraint is the genuine math — Euclid's proof is age-appropriate to gesture at.

**Three.js building blocks:**
- `THREE.TetrahedronGeometry`, `BoxGeometry`, `OctahedronGeometry`, `DodecahedronGeometry`, `IcosahedronGeometry` (one-liners each)
- `MeshStandardMaterial` with the E4 playground palette colors (one slot per solid) + flat shading for that "geometric gem" look
- `DirectionalLight` + `AmbientLight` for soft chalk lighting
- `OrbitControls` for the drag-to-orbit
- Single `requestAnimationFrame` loop driving carousel rotation + per-solid spin
- Click handler raycasts to find the tapped solid; `gsap`-free fade via a 250ms self-rolled CSS-easing lerp on `material.opacity`

**Fallback:** a single static PNG (`site/forkids-3d-platonics.png`) baked from a headless render, inlined as `<img>` when the lazy-loader fails or `prefers-reduced-motion: reduce` is set.

### Demo B — "When math becomes water" (rolling-wave sine surface)

**What it shows:** A 60×60 vertex grid where each vertex's height is `z = sin(r - t) * exp(-r / 10)`, with `r = √(x² + y²)` and `t` advancing 0.04 per frame. The result is concentric ripples radiating outward from the center — mesmerizing, like dropping a stone in still water. The camera slowly orbits at a low angle. A HUD shows the formula with the moving `t` literally counting up, and labels point at "this `r` is distance from the center", "this `sin` makes it wave", "this `exp` makes it fade out as you go further."

**Why kids:** It's the **same `sin` function from the §1 hero**, now in 3D, now visibly making ripples. Connects 2D math to 3D form without a teacher in the loop. Older kids (12+) read the formula and recognize parts of it; younger kids (8–11) just see water.

**Three.js building blocks:**
- `PlaneGeometry(20, 20, 60, 60)` for the vertex grid
- Per-frame: walk `geometry.attributes.position`, update each vertex's z, mark needsUpdate
- `MeshStandardMaterial` with `flatShading: false`, wireframe overlay via a second mesh sharing geometry
- Color via `vertexColors` driven by height (low = playground bg cream, peak = playground primary blue)
- `OrbitControls`; camera starts at a 30° elevation
- HUD is plain HTML overlaid via `position: absolute` — the formula text + a `<span>` for the live `t` value

**Fallback:** static PNG `site/forkids-3d-ripple.png` from a headless render at t=π/2 (a good visual moment).

### Shared infrastructure (`site/forkids-3d.js`)

```js
// site/forkids-3d.js (≤ 200 KB minified, includes vendored three.js)
//
// Self-bootstraps when the §3.5 container becomes visible. Exposes
// two demo modules; each owns its own canvas + animation loop. Both
// pause on `document.visibilitychange` and on `IntersectionObserver`
// leaving viewport to save the school iPad's battery.
//
// Architecture:
//   - `bootForkids3D(rootElement)` — wires both demos
//   - `platonicCarousel(canvas)` — Demo A
//   - `rollingWaveSurface(canvas)` — Demo B
//   - `mountFallback(container, posterUrl, alt)` — used when:
//       * !WebGLRenderingContext (no WebGL)
//       * window.matchMedia('(prefers-reduced-motion: reduce)').matches
//       * scriptload errors
```

### §3.5 page HTML shape

```html
<section id="wow-3d" data-forkids-section="3d">
  <h2>Math gets weird in 3D</h2>
  <div class="demo-card">
    <h3>The 5 perfect shapes</h3>
    <p class="hint">Tap a shape · drag to spin · pinch to zoom</p>
    <div class="demo-canvas" data-demo="platonics">
      <noscript><img src="forkids-3d-platonics.png" alt="..."></noscript>
    </div>
    <p class="caption">Plato thought these were the building blocks of the
      universe. Mathematicians later proved there are <strong>EXACTLY 5.</strong></p>
  </div>
  <div class="demo-card">
    <h3>When math becomes water</h3>
    <p class="hint">Drag to spin · watch the formula change</p>
    <div class="demo-canvas" data-demo="rolling-wave">
      <noscript><img src="forkids-3d-ripple.png" alt="..."></noscript>
    </div>
    <p class="formula">z = sin(r − t) · e<sup>−r/10</sup></p>
  </div>
</section>
<script>
  // Inlined ≤ 1 KB lazy-loader. Loads forkids-3d.js when the section
  // enters viewport. No-WebGL / no-JS falls back to the <noscript> posters.
  (() => {
    const sec = document.getElementById('wow-3d');
    if (!sec || !('IntersectionObserver' in window) || !window.WebGLRenderingContext) return;
    const obs = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      obs.disconnect();
      const s = document.createElement('script');
      s.src = 'forkids-3d.js';
      s.async = true;
      s.onerror = () => sec.dataset.fallback = 'true';
      document.head.appendChild(s);
    }, { rootMargin: '200px' });
    obs.observe(sec);
  })();
</script>
```

### §3.5 acceptance gates

In addition to the page-wide acceptance gates above:

- **Smoke**: open `forkids.html#wow-3d` in Chrome stable, Safari stable, Firefox stable. Both demos render + accept drag-to-orbit.
- **Fallback**: open with `chrome://flags` WebGL disabled OR Safari with "Disable WebGL" — the `<noscript>`/JS error path shows the static PNG and the rest of the page is unaffected.
- **Battery**: scroll past §3.5 and back. The animation loops pause when off-screen (verified by `performance.now()` instrumentation in dev mode).
- **Reduced motion**: with `prefers-reduced-motion: reduce` set, both demos show their static PNG posters and skip the three.js bundle download entirely.
- **Bundle size**: `gzip -9 site/forkids-3d.js | wc -c` ≤ 200 KB. The unrelated `forkids.html` itself is unaffected by §3.5 — diff its size against pre-§3.5 to confirm ≤ 1.2 KB of inline HTML/JS overhead.

### Vendoring three.js

- Vendor a pinned `three@0.169` build into `vendor/three/` at the repo root (NOT a node_modules symlink; we want this self-contained and committed).
- The `forkids-3d.js` build step concatenates: `vendor/three/three.min.js` + `vendor/three/OrbitControls.js` + the two demo modules. Minify with `esbuild --minify --target=es2020 --bundle` (esbuild is already a dev dep; no new dep added).
- No tree-shaking magic — three.js global namespace works fine for two demos. Keeps the build trivial.
- If Track C (`@glyph/three`) ships first and bundles three.js into a workspace package, §3.5 should refactor to consume it instead of vendoring. Until then: vendor.

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
