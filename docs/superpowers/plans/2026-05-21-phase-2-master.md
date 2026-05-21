# Phase 2 — Leading Agent Viz: Master Coordination Plan

> **For agentic workers:** This is the master coordinator for Phase 2. Execution lives in the 3 sub-plans referenced below. Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement each sub-plan task-by-task.

**Goal:** After Math Phase 1 lands (PR1–PR6 from `2026-05-20-math-extensions.md`), close the gaps identified in `docs/MATH-3D-EVALUATION.md` and claim the position of *"the agent-native, deterministic, MCP-callable 3D math + physics + engineering visualization renderer that doesn't exist yet."* Nothing in `awesome-interactive-math` ships that combination today.

**Strategic claim**: Glyph becomes the default 3D-math + scientific-viz tool an LLM agent reaches for, because:

- It's the only tool whose output is **byte-stable** for the same spec.
- It's the only tool whose 3D rendering is **MCP-callable** (single verb, no API key, no SaaS).
- It's the only tool where math + physics + engineering viz **compose with the same grammar** as business charts (race animations, audit rules, lineage, multi-modal output all carry over).

**Four tracks, sequenced with validation gates:**

```
Phase 2:

Track A — Tactical math extensions (~6 PRs)        ┐
  ODE solver, draw-in anim, streamlines, sliders,  │  → showcase gallery A+B
  bezier construction, chalkboard theme            │      ↓
                                                   ├─→ validation gate: does
Track B — Projected 3D in 2D renderer (~3 PRs)     │     anyone use 3D enough
  Isometric/perspective coords, 3D vector field,   │     to justify Track C?
  parametric surfaces                              ┘      ↓
                                                          yes? proceed to
Track C — @glyph/three full WebGL renderer (~10 PRs)  ←──╴
  Three.js + headless GL, Scene3D IR, mesh/sphere/
  surface marks, camera + lighting, browser live,
  3D showcase + docs

Track E — Joy of Math (~5 PRs)                          (NEW, added after
  Annotation mark, traveler mark, timeline animation,    Round 10 — the
  brand presets, glyph_story verb. Targets kid           kid-facing bar
  persona (8-15) using LLMs to explore math.             raiser)
```

**Sub-plans:**

| # | Plan | File | Calendar | Effort | PRs | Gate |
|---|------|------|----------|--------|-----|------|
| A | Tactical math extensions | [`2026-05-21-track-a-tactical-math.md`](./2026-05-21-track-a-tactical-math.md) | weeks 1–4 | M | 6 | none — ships standalone |
| B | Projected 3D | [`2026-05-21-track-b-projected-3d.md`](./2026-05-21-track-b-projected-3d.md) | weeks 2–4 | M | 3 | gates Track C |
| C | `@glyph/three` full renderer | [`2026-05-21-track-c-glyph-three.md`](./2026-05-21-track-c-glyph-three.md) | weeks 6–14 | L | 10 | requires Track B validation + Math Phase 1 complete |
| E | Joy of Math | [`2026-05-21-track-e-joy-of-math.md`](./2026-05-21-track-e-joy-of-math.md) | weeks 4–9 | L | 5 | requires Math Phase 1 + Track A2 (draw-in) + Moat 4 (brand-kit) |

**Total: 24 PRs**, ~14 calendar weeks elapsed (Tracks A + E parallel; B + C sequenced after).

**Track E is the "kid persona" bar raiser.** The premise: an 8-15 year old types a math question into Claude / ChatGPT / Gemini and gets back a chart that's *beautiful, intuitive, and articulates math beauty*. Today's stack hits 1 of the 7 capabilities that experience requires (Track A2's draw-in animation). Track E ships the remaining 6 as additive grammar extensions: `mark: "annotation"`, `mark: "traveler"`, `animation.kind: "timeline"`, two BrandKit presets (`playground`, `3b1b`), and the `glyph_story` MCP verb that ties it together. See the Track E plan for the full grammar + recipe library.

---

## Prerequisites

Before Phase 2 starts:

1. **Math Phase 1 fully merged** (Math PR1–PR6). Specifically:
   - `data.shape: "function"` (scalar + parametric)
   - `mark: "vector-field"`
   - `mark: "math-text"` (KaTeX)
   - Coordinate registry (from Math PR5)
   - Mark registry (from Math PR3)
2. **Tier-S complete or paused.** Reviewer bandwidth needs to handle Phase 2 PRs without stepping on Tier-S follow-ups.
3. **One reviewer agent** (`pr-review-toolkit:code-reviewer`) for each track's PRs — the established cycle pattern.

---

## Validation gates (the non-obvious bit)

Phase 2's value pitch — "leading agent viz" — depends on demand for 3D specifically. Building `@glyph/three` (Track C) is a 10-PR commitment with ~600 KB of new deps (Three.js). The plan validates demand at two checkpoints:

### Gate 1 — After Track A + Track B ship

**Pass condition:** at least two of the following are true:

- Math PR6's site gallery + Track A's chalkboard demos + Track B's isometric Lorenz attractor collectively show ≥ 30% lift in the playground's monthly traffic (Vercel/GH Pages analytics).
- One or more open issues request "real 3D" / "perspective camera moves" with clear use cases (engineering review, molecular structure, physics simulation).
- A specific agent integration partner (e.g. LangChain math notebooks, Claude artifacts) cites 3D as a blocker for their workflow.

**Fail condition:** 6 months after Track A + Track B ship, none of the above. **Stop. Don't build Track C.** Glyph's position is "best-in-class 2D agent math viz" — a solid achievement on its own.

### Gate 2 — After Track C PR1 + PR2

**Pass condition:** the headless GL pipeline (`gl` npm + Three.js) renders the same Scene3D byte-stably across a Linux + macOS + Windows CI matrix (~$0 cost on GitHub-hosted runners). If determinism holds, the rest of Track C is mostly mechanical.

**Fail condition:** snapshot drift > 0 bytes across platforms even on identical inputs. **Stop. Re-evaluate.** Options:
- Pin a single CI runner platform; document that 3D output is byte-stable on that platform only
- Compromise on "visual equivalence" instead of byte-identity for 3D specifically (snapshot tests become tolerance-based pixel diffs)
- Abandon Track C in favor of partnering with MathBox / Plotly / Three.js direct

The byte-identity contract is THE thing that differentiates Glyph from the awesome-interactive-math landscape. Losing it for 3D is a serious decision.

---

## PR cycle template

Same as Tier-S — see `2026-05-18-tier-s-master.md` → `[PR-CYCLE]`. Brief:

1. Branch from main: `feat/<track-letter><pr-number>-<scope>`
2. Implement with TDD where possible
3. Verify: `pnpm install && pnpm -r run build && pnpm -r run test && pnpm lint`
4. Push, open PR via web UI (collaborator block on `gh pr create` is well-established)
5. Dispatch `pr-review-toolkit:code-reviewer` agent
6. Address findings on follow-up commits
7. Wait for green 6-cell CI matrix
8. Squash-merge via web UI or fast-forward via `git merge --ff-only` (the established pattern)
9. Tag if release-worthy (any `packages/*` published change)

---

## Cross-cutting concerns

### Repo conventions (carried over)
- `pnpm` workspaces, biome lint, vitest, TypeScript strict
- Snapshot tests for byte-identity (now 419+ tests on main after Math PR1)
- Per-package `package.json` for any new workspace member
- 6-cell CI matrix unless explicitly extended (Track C may need to pin to Linux for the headless-GL determinism check)

### Determinism contract
- Tracks A + B: full byte-identity (same pure-fn pattern as today)
- Track C: documented exception. Headless GL is deterministic on identical driver versions; snapshot tests run on a fixed CI platform. Browser-side output is **visually equivalent** not byte-identical.

### Agent-native invariant
- **Zero new MCP verbs across all 19 PRs.** Every new capability flows through `glyph_render` (with new `coordinates.type` values, new mark types, new data shapes) or `glyph_audit_spec` (new audit rules).
- The agent that uses Glyph today gets 3D math viz tomorrow with no skill-file revision and no MCP-capability negotiation.

### Bundle size policy
- `@glyph/core` stays under 400 KB minified for the 2D path. Track B keeps this contract.
- `@glyph/three` is a separate package (~600 KB extra) — only pulled when 3D is needed. The marketing line: *"Pay for 3D only when you use it."*

### Marketing surface
Each track lands with a corresponding showcase update:
- Track A → site `#examples` gains 6 math-extension cards
- Track B → new `#math-3d` section with 3 isometric demos
- Track C → new top-level page `site/three/` with 8+ Three.js demos + a live-orbit-camera embed

---

## Risk register

| Risk | Mitigation |
|------|-----------|
| Three.js's WebGL output is not byte-stable across CI runners | Gate 2; fall back to "pixel-tolerance" snapshot tests on a Linux-only CI cell |
| `gl` npm headless WebGL is unmaintained / has CVEs | Track to `@vitalets/headless-three` or rendering via `node-canvas-webgl` as alternates; the renderer interface allows swap |
| Track A's "sliders" add reactive JS to a static SVG renderer | Sliders ship in `@glyph/live`, not `@glyph/core`. The static path stays deterministic. |
| Chalkboard theme's Perlin-noise displacement breaks byte-identity | Seed the noise (`mulberry32` already in `@glyph/core` for force layout); deterministic by construction. |
| Phase 2 dilutes the "deterministic charts for agents" positioning | The README + site README sections continue to lead with that pitch; Phase 2 is positioned as *extension*, not pivot. |
| @glyph/three adoption is low | Gate 1 catches this. If we ship Track C and no one cares, the package can be archived without affecting `@glyph/core`. |
| Manim community sees Track A + B as competition | Position explicitly as "Manim for agents" — different audience, complementary tool. Reach out to Grant Sanderson directly if traction grows. |

---

## Self-review

**Spec coverage** (against `docs/MATH-3D-EVALUATION.md`):
- ✅ §3.1 tactical gaps (ODE solver, draw-in, streamlines, sliders, bezier, chalkboard) → Track A
- ✅ §4.3 phase 2a (projected 3D) → Track B
- ✅ §4.3 phase 2b (Three.js plugin) → Track C
- ✅ §5 sequencing recommendation (A + B parallel, C gated) → encoded in the gate structure above

**No placeholders:** each sub-plan has file paths, code blocks, acceptance criteria. Gates are concrete (signals to look for, not vibes).

**Foundation principles** (inherited from MATH-3D-EVALUATION.md §6):
- ✅ Zero new MCP verbs
- ✅ Determinism explicit (Track C documents the exception)
- ✅ Bundle-size policy (Track C opt-in)
- ✅ Mark registry + coordinate registry from Math PR3/PR5 reused, not re-invented
- ✅ Animation reuse — Track A + B add `animation.kind` variants; no separate animation engine
- ✅ Scene-graph extension (Scene3D in Track C) is additive — existing 2D Scene unchanged

---

## Execution choice

Plan saved across 4 files in `docs/superpowers/plans/2026-05-21-*.md`. Two ways to execute:

**1. Sequential** — finish Track A, then Track B, then evaluate, then maybe Track C. Slow but conservative.

**2. Parallel A + B** (recommended) — both track sub-agents can run alongside each other; Track A doesn't touch Track B's files and vice versa. Same parallel-dispatch + serial-review pattern that worked in Rounds 2–6 of Tier-S.

**3. Hybrid** — kick off Track A inline on the first PR (validate the pattern works end-to-end with the tactical extensions), then dispatch B in parallel for PRs 2+.

Recommendation: **option 2** once Math Phase 1 fully ships. The team has the parallel-dispatch muscle memory now.
