# Tier-S Delivery — Master Coordination Plan

> **For agentic workers:** This is the master coordinator. Execution lives in the 4 sub-plans referenced below. Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement each sub-plan task-by-task.

**Goal:** Ship S1+S2+S3+S4 in ~10 calendar weeks via disciplined PR cycles. Net intended outcome: 5–10× the addressable agent ecosystem, top-of-funnel viral surface, dramatic stars uplift.

**Architecture:** Four independent subsystems. They sequence (not depend) on each other to manage review-bandwidth, not technical coupling. Run them in parallel where reviewer attention permits.

**Tech stack:** All four deliverables sit on GitHub free services. Zero third-party hosting accounts.

- S1 — Python 3.10+, `hatch`, `pytest`; subprocess-bridges to the Node MCP binary. Published to **PyPI** (free, trusted publishing via GitHub OIDC).
- S2 — Markdown + a single JSON entry in `modelcontextprotocol/servers`. **GitHub fork → PR.**
- S3 — Vanilla HTML + ES modules + CDN imports (Monaco, DuckDB-wasm). `@glyph/core` pre-bundled via esbuild to a single ESM file. **Hosted on GitHub Pages** at `seanhanca.github.io/glyph/play/`. Share storage via **GitHub Gist API** (anonymous or user-account); discovery via **GitHub Discussions**. Source colocated in `site/play/`, deployed by an Action on every push to `main`.
- S4 — TypeScript GitHub Action (JS, not Docker), `@octokit/rest`, `@glyph/cli`. Published to the **GitHub Marketplace** (free). Uses an orphan branch in the same repo for the rendered SVG images referenced from PR comments.

---

## Sub-plans

| # | Plan | File | Calendar | Effort | PRs |
|---|------|------|----------|--------|-----|
| S2 | Submit to modelcontextprotocol/servers | [`2026-05-18-s2-mcp-servers-registry.md`](./2026-05-18-s2-mcp-servers-registry.md) | Week 1 | S | 1 |
| S1 | Python bindings (`pip install glyph`) | [`2026-05-18-s1-python-bindings.md`](./2026-05-18-s1-python-bindings.md) | Weeks 1–6 | L | 8 |
| S3 | Playground at `glyph.dev/play` | [`2026-05-18-s3-playground.md`](./2026-05-18-s3-playground.md) | Weeks 3–6 | M | 8 |
| S4 | "Chart Audit on PR" GitHub Action | [`2026-05-18-s4-chart-audit-action.md`](./2026-05-18-s4-chart-audit-action.md) | Weeks 7–10 | M | 7 |

Total: **24 PRs**, ~10 weeks elapsed, expected ~6–8 weeks of focused dev time across parallel tracks.

---

## Sequencing rationale

```
Week:    1   2   3   4   5   6   7   8   9   10
S2     ■─┘
S1     ■───────────────────■
S3             ■───────────■
S4                                 ■───────────■
```

- **S2 first.** Pure docs PR with no code risk. Land it week 1 so Glyph shows up in `modelcontextprotocol/servers` while the other tracks are still cooking. Distribution dividend starts paying immediately.
- **S1 in parallel from week 1.** Largest item, longest lead time. Start now so Python landing matches S3 launch.
- **S3 starts week 3.** Once S2 lands you have a Glyph entry in the official registry — playground gives that entry a click destination. Pair them in launch tweet.
- **S4 starts week 7.** Needs `@glyph/cli`'s `glyph diff` solid + a public marketing surface (playground) for the comment images to link to. Ship after S3.

**Dependencies that matter:**
- S1 needs the MCP server binary stable on `main`. Already stable (49 verbs, 679 tests). ✅
- S3 needs `@glyph/core` runnable in browser. Verify week 2 — `vitest --environment jsdom` already exercises this. ✅
- S4 needs `@glyph/cli`'s `glyph diff <a.json> <b.json>` producing markdown output. Verify week 6 before S4 starts.

**No technical deps between sub-plans.** A reviewer working S1 doesn't need to know S3's branch state.

---

## PR cycle template

Every PR across all four sub-plans uses this exact cycle. Sub-plans reference these steps by number.

### `[PR-CYCLE]` Standard PR workflow

- [ ] **Step 1: Create a worktree (optional but recommended)**

```bash
git worktree add ../glyph-<branch-name> -b <type>/<scope>
cd ../glyph-<branch-name>
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`.
Scope examples: `s1-python-mvp`, `s3-playground-csv`, `s4-action-scaffold`.

- [ ] **Step 2: Implement with frequent commits**

Make atomic commits as you go — one logical change per commit. Tests come first (TDD) unless the change is pure docs.

- [ ] **Step 3: Verify locally**

```bash
pnpm install         # if dependencies changed
pnpm -r run build    # all workspaces
pnpm -r run test     # all tests pass
pnpm lint            # biome clean
```

For the Python sub-plan (S1), also: `cd bindings/python && pytest -q && ruff check .`

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin HEAD
gh pr create --title "<concise title>" --body "$(cat <<'EOF'
## Summary
<2–4 bullets>

## Test plan
- [ ] <test 1>
- [ ] <test 2>

## Links
- Closes #<issue if any>
- Sub-plan: <relative path>
EOF
)"
```

- [ ] **Step 5: Self-review**

```bash
gh pr view --web      # eyeball the diff in browser
gh pr checks          # confirm CI is green or pending
```

If the diff has anything you wouldn't want a reviewer to see (debug `console.log`, commented-out code, stray comments) — fix it in a follow-up commit before requesting review.

- [ ] **Step 6: Dispatch reviewer agent**

Use the `pr-review-toolkit:code-reviewer` agent in background, pointed at the PR diff:

```text
Review PR #<n> on seanhanca/glyph. Focus: <S1/S2/S3/S4 sub-plan name>.
Check: tests cover the contract, no silent failures, types align with spec,
naming consistent with existing codebase, no dead code, no AI-tells in
docs.
```

Also dispatch:
- `pr-review-toolkit:silent-failure-hunter` for any PR touching error handling
- `pr-review-toolkit:pr-test-analyzer` for any PR adding test coverage
- `pr-review-toolkit:type-design-analyzer` for any PR adding new types

- [ ] **Step 7: Address findings**

For each finding, either fix it in a new commit or post a reply explaining why you're not. Don't squash — leave the history so reviewers can see what changed. Push, then re-run `gh pr checks` until green.

- [ ] **Step 8: Wait for green CI**

The 6-cell matrix (Node 20/22 × Linux/macOS/Windows) must be green. If it's flaky in one cell, fix the flake — do not rerun until green and ship.

- [ ] **Step 9: Squash-merge**

```bash
gh pr merge --squash --auto --delete-branch
```

Or if `auto-merge` isn't enabled on the repo: `gh pr merge --squash --delete-branch` once CI green and review approved.

- [ ] **Step 10: Tag if release-worthy**

If the PR ships an npm-publishable change (any package in `packages/*`), bump the changelog and tag a release:

```bash
pnpm changeset
git add .changeset && git commit -m "chore: changeset for <scope>"
git push
```

Releases are cut on `main` via the changesets-release workflow.

---

## Cross-cutting concerns

### Repo conventions (already in place)
- `pnpm` workspaces, `pnpm-workspace.yaml` at root
- `biome` for lint + format
- `vitest` for tests; snapshot tests for byte-identity
- `tsconfig.json` extends the root `tsconfig.base.json`
- All public APIs export types from `src/index.ts`
- TypeScript strict mode

### CI matrix
- All sub-plans add their tests to the existing matrix in `.github/workflows/ci.yml`
- New cells (if any) only for S1 Python — see S1 sub-plan for `python.yml` workflow

### Stars / metrics tracking
- Track GitHub stars weekly during this push
- Tag baseline `git tag tier-s-baseline` at start of week 1
- Tag `tier-s-s2-landed`, `tier-s-s3-launched`, etc. as each phase closes
- Weekly snapshot: `gh api repos/seanhanca/glyph | jq '.stargazers_count'` → `docs/metrics/stars.csv`

### Communication / launch
- S2 lands → tweet thread + post in /r/LocalLLaMA + Anthropic Discord
- S1 lands → tweet, Hacker News Show HN, post in r/Python + r/dataisbeautiful
- S3 lands → tweet (with a viral example), submit to BetaList + Product Hunt
- S4 lands → tweet, write a "we automated chart code review" blog post, post in dev.to + Hashnode

Each launch needs:
- 1 demo GIF (record with `tape` or `asciinema-rec`)
- 1 hero screenshot
- 1 cold-open tweet with the punchline numbers ("50 MCP verbs, 0 LLM calls, byte-stable SVG")

### Risk register

| Risk | Mitigation |
|------|-----------|
| S2 maintainers reject the PR | Re-submit with their feedback within 48 hrs. If repeatedly rejected, ship a `glyph-mcp-registry` as a separate community list |
| S1 Python adoption < expected | Ship Jupyter widget in v0.2 to widen the surface |
| GitHub Pages bandwidth (S3) | 100 GB/month soft cap; > 100 visits/sec triggers 429s. Mitigated by CDN imports for Monaco/DuckDB-wasm + only ~50 KB of own assets per visit. If we hit the cap, drop a `site/CNAME` and front with Cloudflare Pages (free, also static) |
| Anonymous Gist rate limit (S3) | ~60 req/hour per IP; "Save to my account" flow drops to GitHub's create-gist UI as a fallback — no rate limit on our side |
| S4 false-positive audits annoy users | Action ships with `severity: warning` threshold by default; users opt in to `severity: error` |
| Reviewer bandwidth exhausted | If queue > 3 PRs across sub-plans, hold the latest until queue drains. Better to ship 24 reviewed PRs than 30 rushed ones |

---

## Self-review

**Spec coverage:**
- ✅ S1 covered by `2026-05-18-s1-python-bindings.md` (8 PRs)
- ✅ S2 covered by `2026-05-18-s2-mcp-servers-registry.md` (1 PR)
- ✅ S3 covered by `2026-05-18-s3-playground.md` (8 PRs)
- ✅ S4 covered by `2026-05-18-s4-chart-audit-action.md` (7 PRs)
- ✅ PR cycle template covers develop → test → review → merge as the user asked

**No placeholders:** none — every PR has files, tests, acceptance criteria.

**Type consistency:** verified across sub-plans — `GlyphSpec` (TS), `Spec` (Py dataclass), `glyph_*` MCP verbs match the current server.

---

## Execution choice

Plan complete and saved across 5 files in `docs/superpowers/plans/2026-05-18-*.md`. Two ways to execute:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per PR. The main session reviews between PRs. Best for keeping context clean over 10 weeks of work.

**2. Inline Execution** — run the PRs sequentially in this session. Good for the first 2–3 PRs (S2, S1-PR1) where you want hands-on involvement before delegating.

A hybrid is fine: run S2 inline (it's 1 PR), then go subagent-driven for S1 + S3 + S4.

**Which approach?**
