<!--
Thanks for sending a PR! Glyph is deterministic by contract — same input
should always produce the same SVG bytes — so reviewers focus heavily
on snapshot stability and the determinism path. The template below mirrors
that.

If you've never contributed to Glyph before, read CONTRIBUTING.md first
(it's short).
-->

## What this PR does

<!-- One paragraph. What changed for spec authors / agents / readers? -->

## Why

<!-- Link the Issue / Discussion if there is one. If not, one sentence on
     why this earns its place in the grammar / agent surface. -->

## How it works

<!-- 2–5 bullets on the implementation shape. Where does the new code
     live? What's the public surface? What did you NOT touch?  -->

-
-
-

## Snapshot / determinism check

<!-- Glyph's bytestamp contract: same spec → same SVG bytes, every
     platform, every run. Tick whichever applies. -->

- [ ] **No new behavior** — pure refactor / docs / typo / lint. Confirmed by `git diff` showing zero changes under `__fixtures__/`.
- [ ] **Snapshots intentionally updated** — I ran `pnpm test -- -u`, eyeballed the diff, and the changes match what the PR description says.
- [ ] **New fixture** — added under `packages/core/__fixtures__/<category>/<name>.{json,test.ts,svg}` following the existing pattern; the test asserts byte-identity via `toMatchFileSnapshot`.

## Cross-platform check

<!-- Glyph's determinism is now real across macOS / Linux / Windows. If
     your change touches anything that runs floating-point math or hashes
     row data, confirm the snapshot bytes are the same on the CI matrix. -->

- [ ] My change doesn't affect numeric output (no Math.sin/cos/exp paths, no new f64 arithmetic).
- [ ] My change affects numeric output AND I verified the CI matrix (Ubuntu / macOS / Windows × Node 20 / 22) passes.

## Tests

- [ ] Added unit tests in the same directory as the code I changed.
- [ ] Added a fixture test if the change is user-visible (a new mark, a new audit rule, …).
- [ ] All existing tests still pass: `pnpm test` from the repo root.
- [ ] Lint clean: `pnpm lint` exits 0.

## Docs

- [ ] Updated the JSDoc on the touched function / class.
- [ ] Updated `docs/MATH.md` / `docs/LEARN.md` / `README.md` if a user-facing surface changed.
- [ ] Added an entry to `CHANGELOG.md` under the `[Unreleased]` heading (if you're not sure where, leave a comment and a maintainer will move it).

## For reviewers

<!-- Anything you'd like a reviewer to look at especially closely. "I'm
     not sure the float comparison tolerance is right" beats "lgtm". -->
