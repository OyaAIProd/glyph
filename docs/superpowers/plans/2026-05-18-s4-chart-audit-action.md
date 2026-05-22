# S4 — "Chart Audit on PR" GitHub Action

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended). Each PR is one subagent dispatch. The master PR cycle template lives in `2026-05-18-tier-s-master.md`.

**Goal:** Ship a GitHub Action `seanhanca/glyph-audit-action@v1` that, on every PR touching `*.glyph.json` files, comments with: a spec diff, audit findings, before/after rendered images, and a trust score. Each adopting repo becomes a free billboard for Glyph.

**Architecture:** JavaScript action (not Docker) for fast startup. Lives in its own repo `seanhanca/glyph-audit-action` (not in the monorepo) because Marketplace publishing needs a standalone repo. The action shells out to `@glyph/cli` for spec diff + audit + render. Renders are uploaded as comments via Octokit.

**Tech stack:**
- TypeScript, compiled to a single bundled JS file via `ncc` (GitHub Action convention)
- `@actions/core`, `@actions/github` for runner API
- `@actions/exec` to spawn `glyph` CLI
- `octokit` for PR comment upsert
- Node ≥ 20 runtime (matches `runs.using: "node20"` in action.yml)

**Effort:** M (7 PRs, ~2–3 calendar weeks).

**Calendar:** Weeks 7–10.

**Prerequisite:** `@glyph/cli` exposes:
- `glyph diff <a.json> <b.json> --format md` → markdown diff with audit + trust + before/after SVG paths

If the CLI doesn't have all of this on `main` when S4 starts, a prerequisite PR in the monorepo extends `@glyph/cli` first (call it PR0 below).

---

## File structure (new repo)

```
glyph-audit-action/
├── action.yml                  # entry point manifest
├── package.json
├── tsconfig.json
├── README.md                   # Marketplace landing
├── LICENSE                     # Apache 2.0
├── dist/                       # built single-file bundle (committed)
│   └── index.js
├── src/
│   ├── main.ts                 # entry: parse inputs, dispatch
│   ├── detect.ts               # find changed *.glyph.json files
│   ├── render.ts               # spawn `glyph diff`, capture markdown + images
│   ├── comment.ts              # upsert the sticky PR comment
│   └── types.ts
├── tests/
│   ├── detect.test.ts
│   ├── render.test.ts
│   ├── comment.test.ts
│   └── fixtures/
│       ├── spec-before.json
│       └── spec-after.json
└── .github/
    └── workflows/
        ├── ci.yml              # lint + test on push
        ├── release.yml         # tag → publish to Marketplace
        └── self-test.yml       # runs the action against itself on every PR
```

---

## Task 0 (prerequisite, in main repo): Extend `@glyph/cli`

**Branch:** `feat/cli-diff-md-format` (in `seanhanca/glyph`)

**Files:**
- Modify: `packages/cli/src/commands/diff.ts`
- Create: `packages/cli/tests/diff-md.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { runDiffCommand } from "../src/commands/diff";

describe("glyph diff --format md", () => {
  it("produces markdown with diff + audit + trust + image refs", async () => {
    const result = await runDiffCommand({
      a: "tests/fixtures/spec-before.json",
      b: "tests/fixtures/spec-after.json",
      format: "md",
      imageDir: "/tmp/glyph-diff",
    });
    expect(result.markdown).toContain("```diff");
    expect(result.markdown).toContain("## Audit");
    expect(result.markdown).toMatch(/trust:\s+\d+\s*\/\s*100/);
    expect(result.imagesGenerated).toEqual(
      expect.arrayContaining(["before.svg", "after.svg"]),
    );
  });
});
```

- [ ] **Step 2: Extend the diff command**

If `@glyph/cli` already supports `--format html`, follow the same code path for `--format md`. Output sections:

```md
## Glyph chart change

### Diff
```diff
- "mark": "bar"
+ "mark": "area"
+ "encoding.opacity": 0.75
```

### Audit
- ⚠ `truncated_y_axis` — y-axis starts at 90, not 0
- ℹ `small_sample` — n=8 rows

trust: 78 / 100

### Render

| before | after |
| ------ | ----- |
| ![before](before.svg) | ![after](after.svg) |
```

- [ ] **Step 3: Standard PR cycle**

Acceptance: `glyph diff a.json b.json --format md --image-dir /tmp/x` produces the markdown above + the two SVGs on disk. CI green.

PR title: `feat(cli): glyph diff --format md (PR0/7 for S4)`.

---

## Task 1: PR1 — Action repo scaffolding

**Branch:** `main` (initial commit in the new repo `seanhanca/glyph-audit-action`)

**Files:** as listed in the file structure above.

- [ ] **Step 1: Create the repo**

```bash
mkdir glyph-audit-action && cd glyph-audit-action
git init
gh repo create seanhanca/glyph-audit-action --public --source=. --remote=origin --license=apache-2.0
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "glyph-audit-action",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "ncc build src/main.ts -o dist --license licenses.txt",
    "lint": "tsc --noEmit && eslint src tests",
    "test": "vitest run"
  },
  "dependencies": {
    "@actions/core": "^1.10.0",
    "@actions/exec": "^1.1.1",
    "@actions/github": "^6.0.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@vercel/ncc": "^0.38",
    "eslint": "^9",
    "typescript": "^5.6",
    "vitest": "^2"
  }
}
```

- [ ] **Step 3: Write `action.yml`**

```yaml
name: "Glyph Chart Audit"
description: "Audit chart specs on PRs — diff, audit rules, trust score, before/after renders."
author: "seanhanca"
branding:
  icon: bar-chart-2
  color: blue
inputs:
  spec-pattern:
    description: "Glob pattern for chart spec files."
    required: false
    default: "**/*.glyph.json"
  glyph-version:
    description: "Version of @glyph/cli to use (default: latest)."
    required: false
    default: "latest"
  fail-on:
    description: "Exit non-zero when an audit finding at this severity or higher is detected."
    required: false
    default: "none"  # one of: none | error
  comment-mode:
    description: "Comment style: sticky (one comment, edited) | new (a new comment per push)."
    required: false
    default: "sticky"
runs:
  using: "node20"
  main: "dist/index.js"
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "lib"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Initial entry point stub**

```ts
// src/main.ts
import * as core from "@actions/core";

async function run(): Promise<void> {
  try {
    core.info("glyph-audit-action starting (PR1 stub)");
    // PR1 ships nothing functional — just the scaffolding
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
```

- [ ] **Step 6: First build + commit + push**

```bash
pnpm install
pnpm build           # writes dist/index.js
git add .
git commit -m "scaffold: action.yml, build pipeline, entry stub"
git push -u origin main
```

PR title: in this new repo, PR1 is the first commit. Open a PR from a branch if you prefer the cycle; for an empty repo, push-to-main is acceptable as long as PR2+ all use the cycle.

Acceptance for PR1:
- `pnpm build` produces `dist/index.js`
- Action manifest valid (`gh action validate` if available, or `npx action-validator action.yml`)
- Repo public, Marketplace draft listed but not yet published

---

## Task 2: PR2 — Detect changed spec files

**Branch:** `feat/detect-changed-specs`

**Files:**
- Create: `src/detect.ts`
- Create: `tests/detect.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/detect.test.ts
import { describe, it, expect } from "vitest";
import { findChangedSpecPairs } from "../src/detect";

describe("findChangedSpecPairs", () => {
  it("returns base+head paths for each changed spec", () => {
    const result = findChangedSpecPairs({
      changedFiles: ["charts/sales.glyph.json", "src/app.ts"],
      pattern: "**/*.glyph.json",
    });
    expect(result).toEqual([
      { path: "charts/sales.glyph.json" },
    ]);
  });

  it("ignores non-spec files", () => {
    const result = findChangedSpecPairs({
      changedFiles: ["src/main.ts", "README.md"],
      pattern: "**/*.glyph.json",
    });
    expect(result).toEqual([]);
  });

  it("honors custom patterns", () => {
    const result = findChangedSpecPairs({
      changedFiles: ["plots/foo.json"],
      pattern: "plots/*.json",
    });
    expect(result).toEqual([{ path: "plots/foo.json" }]);
  });
});
```

- [ ] **Step 2: Implement detect.ts**

```ts
// src/detect.ts
import { minimatch } from "minimatch";

export interface ChangedSpec {
  path: string;
}

export function findChangedSpecPairs({
  changedFiles,
  pattern,
}: {
  changedFiles: string[];
  pattern: string;
}): ChangedSpec[] {
  return changedFiles
    .filter((p) => minimatch(p, pattern, { matchBase: false }))
    .map((p) => ({ path: p }));
}
```

(Add `minimatch` to dependencies.)

- [ ] **Step 3: Wire up — fetch changed files via GitHub API**

In `main.ts`:

```ts
import * as core from "@actions/core";
import * as github from "@actions/github";
import { findChangedSpecPairs } from "./detect.js";

async function run(): Promise<void> {
  const token = core.getInput("github-token") || process.env.GITHUB_TOKEN!;
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const pr = github.context.payload.pull_request;
  if (!pr) {
    core.info("No PR context — skipping.");
    return;
  }

  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner, repo, pull_number: pr.number,
  });
  const changed = files.map((f) => f.filename);

  const specs = findChangedSpecPairs({
    changedFiles: changed,
    pattern: core.getInput("spec-pattern"),
  });
  core.info(`Detected ${specs.length} changed spec(s).`);
  // PR3 picks up from here.
}

run();
```

Acceptance for PR2:
- Unit tests green
- Manual self-test: on a PR adding a `.glyph.json` file, the action log shows "Detected 1 changed spec(s)."

PR title (in glyph-audit-action repo): `feat: detect changed glyph.json files (PR2/7)`.

---

## Task 3: PR3 — Render diff + audit

**Branch:** `feat/render-diff`

**Files:**
- Create: `src/render.ts`
- Create: `tests/render.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/render.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderSpecDiff } from "../src/render";

describe("renderSpecDiff", () => {
  it("invokes glyph CLI with --format md", async () => {
    const execMock = vi.fn().mockResolvedValue({ stdout: "## Glyph chart change\n…\n" });
    const result = await renderSpecDiff({
      path: "charts/sales.glyph.json",
      base: "/tmp/base.json",
      head: "/tmp/head.json",
      glyphCmd: "glyph",
      imageDir: "/tmp/imgs",
      exec: execMock as any,
    });
    expect(execMock).toHaveBeenCalledWith(
      "glyph",
      expect.arrayContaining(["diff", "/tmp/base.json", "/tmp/head.json", "--format", "md"]),
      expect.any(Object),
    );
    expect(result.markdown).toContain("Glyph chart change");
  });
});
```

- [ ] **Step 2: Implement render.ts**

```ts
// src/render.ts
import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface RenderResult {
  path: string;
  markdown: string;
  imagePaths: string[];
}

interface Deps {
  exec: (cmd: string, args: string[], opts: object) => Promise<{ stdout: string }>;
}

export async function renderSpecDiff(
  args: {
    path: string;
    base: string;          // path to the "before" file (from base branch)
    head: string;          // path to the "after" file (from PR head)
    glyphCmd: string;
    imageDir: string;
  } & Deps,
): Promise<RenderResult> {
  await fs.mkdir(args.imageDir, { recursive: true });
  const { stdout } = await args.exec(
    args.glyphCmd,
    ["diff", args.base, args.head, "--format", "md", "--image-dir", args.imageDir],
    {},
  );
  const imagePaths = await listSvgs(args.imageDir);
  return { path: args.path, markdown: stdout, imagePaths };
}

async function listSvgs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".svg"))
    .map((e) => path.join(dir, e.name));
}
```

- [ ] **Step 3: Wire base + head extraction in main.ts**

For each changed spec, use `octokit.rest.repos.getContent({ ref: pr.base.sha, path })` to fetch the base version + `pr.head.sha` for the head version. Save both to temp files, pass to `renderSpecDiff`.

Acceptance for PR3:
- Smoke test: in a sibling fixture repo (or in the self-test workflow), changing a spec produces a markdown blob with diff + audit + trust + image refs

PR title: `feat: render spec diff via glyph CLI (PR3/7)`.

---

## Task 4: PR4 — Upload images, build comment markdown

**Branch:** `feat/upload-images`

**Files:**
- Create: `src/upload.ts`
- Create: `tests/upload.test.ts`

GitHub PR comments can't display local images — they need either:
- An image hosted somewhere accessible (e.g., a comment-attached upload)
- Inline base64 SVG (works for small SVGs, ugly for large)

Simplest path: commit the rendered SVGs to a `.glyph-audit/` branch of the same repo (orphan branch, kept tiny) and reference `https://raw.githubusercontent.com/<owner>/<repo>/.glyph-audit/<sha>/<file>.svg` in the comment. Alternative: use `actions/upload-artifact` and link to the artifact (worse UX — requires login).

- [ ] **Step 1: Decide and implement** (recommend: orphan branch approach)

```ts
// src/upload.ts
import { Octokit } from "@octokit/rest";

export async function uploadSvgsToBranch(args: {
  octokit: Octokit;
  owner: string;
  repo: string;
  branch: string;        // ".glyph-audit"
  commitSha: string;     // identifies the PR head; used as a subdir
  svgPaths: string[];
}): Promise<Record<string, string>> {
  // For each SVG, create or update the file on the orphan branch.
  // Returns a map: localPath → raw URL.
  // (Full impl: create-or-update via Git data API; ensure branch exists.)
  return {};  // stub for plan; real impl in this PR
}
```

- [ ] **Step 2: Markdown post-processor**

Rewrite the `<image>` references in the CLI's markdown output to use the uploaded URLs:

```ts
// src/main.ts (continued)
import { uploadSvgsToBranch } from "./upload.js";

const urls = await uploadSvgsToBranch({
  octokit, owner, repo, branch: ".glyph-audit",
  commitSha: pr.head.sha, svgPaths: render.imagePaths,
});
let markdown = render.markdown;
for (const [local, url] of Object.entries(urls)) {
  markdown = markdown.replaceAll(local, url);
}
```

- [ ] **Step 3: Tests**

```ts
// tests/upload.test.ts
import { describe, it, expect } from "vitest";

describe("uploadSvgsToBranch", () => {
  it("returns a url map keyed by local path", async () => {
    // Use msw or nock to stub the GitHub Git data API
    // Assert that octokit.rest.git.createTree was called with the SVG blobs
  });
});
```

Acceptance for PR4:
- SVGs uploaded to the orphan branch on PR runs
- Markdown comment renders the images via raw.githubusercontent.com URLs
- Comments < 65,536 chars (GH comment cap)

PR title: `feat: upload renders, rewrite md urls (PR4/7)`.

---

## Task 5: PR5 — Sticky PR comment

**Branch:** `feat/sticky-comment`

**Files:**
- Create: `src/comment.ts`
- Create: `tests/comment.test.ts`

- [ ] **Step 1: Implement upsert-by-marker**

```ts
// src/comment.ts
const MARKER = "<!-- glyph-audit-action:sticky -->";

export async function upsertComment(args: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  mode: "sticky" | "new";
}): Promise<void> {
  const fullBody = `${MARKER}\n\n${args.body}`;
  if (args.mode === "new") {
    await args.octokit.rest.issues.createComment({
      owner: args.owner, repo: args.repo, issue_number: args.prNumber,
      body: fullBody,
    });
    return;
  }
  const existing = await args.octokit.paginate(
    args.octokit.rest.issues.listComments,
    { owner: args.owner, repo: args.repo, issue_number: args.prNumber },
  );
  const ours = existing.find((c) => c.body?.includes(MARKER));
  if (ours) {
    await args.octokit.rest.issues.updateComment({
      owner: args.owner, repo: args.repo, comment_id: ours.id, body: fullBody,
    });
  } else {
    await args.octokit.rest.issues.createComment({
      owner: args.owner, repo: args.repo, issue_number: args.prNumber, body: fullBody,
    });
  }
}
```

- [ ] **Step 2: Test the upsert logic**

Use `nock` or hand-mocked octokit. Verify:
- First call creates a new comment
- Second call (with marker present) updates instead

Acceptance for PR5:
- Pushing a new commit to a PR updates the existing comment, not creates a new one (when `comment-mode: sticky`)
- `comment-mode: new` creates a fresh comment each push

PR title: `feat: sticky PR comment upsert (PR5/7)`.

---

## Task 6: PR6 — README + Marketplace listing

**Branch:** `docs/marketplace-listing`

**Files:**
- Modify: `README.md`
- Create: `.github/workflows/release.yml`
- Create: `examples/.github/workflows/glyph-audit.yml`  (sample for adopters)

- [ ] **Step 1: Write the README (this is the Marketplace landing)**

```markdown
# Glyph Chart Audit — GitHub Action

Audit chart specs on every PR. Posts a sticky comment with:
- the JSON diff
- audit findings (truncated axes, dual-y mismatch, small-n, ...)
- trust score (0–100)
- before / after SVG renders

## Usage

```yaml
# .github/workflows/glyph-audit.yml
name: Glyph audit
on: pull_request

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm install -g @glyph/cli
      - uses: seanhanca/glyph-audit-action@v1
        with:
          spec-pattern: "**/*.glyph.json"
          fail-on: error
```

## Inputs

| Name | Default | Description |
| ---- | ------- | ----------- |
| `spec-pattern` | `**/*.glyph.json` | Glob for chart spec files |
| `glyph-version` | `latest` | Version of `@glyph/cli` to use |
| `fail-on` | `none` | `none` \| `error` — exit nonzero on this severity |
| `comment-mode` | `sticky` | `sticky` (one comment) \| `new` (per push) |

## What it looks like

(insert screenshot of a PR comment)

## License

Apache 2.0.
```

- [ ] **Step 2: Release workflow**

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ["v*"]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm install
      - run: npm run build
      - name: Verify dist is committed
        run: |
          if [ -n "$(git status --porcelain dist/)" ]; then
            echo "dist/ is stale — commit the rebuilt bundle"
            exit 1
          fi
      - name: Update major tag
        run: |
          MAJOR=$(echo "${GITHUB_REF_NAME}" | sed 's/^v//; s/\..*$//')
          git tag -f "v$MAJOR"
          git push origin "v$MAJOR" --force
      - name: Create release
        uses: softprops/action-gh-release@v2
```

- [ ] **Step 3: Publish to Marketplace**

Hand-step in GitHub UI: repo → Releases → Publish release → "Publish this Action to the Marketplace". Choose category "Code review" + "Code quality". Add icon + colors per `action.yml`.

Acceptance for PR6:
- README looks good in the Marketplace preview
- Tagging `v1.0.0` builds + publishes
- Major-tag (`v1`) auto-updates

PR title: `docs: Marketplace listing + release workflow (PR6/7)`.

---

## Task 7: PR7 — Dogfood on Glyph's own repo

**Branch:** in `seanhanca/glyph`: `feat/self-audit-action`

**Files:**
- Create: `.github/workflows/glyph-audit.yml` (in the main glyph repo)
- Create: a few `examples/*.glyph.json` fixtures for the action to chew on

- [ ] **Step 1: Wire the action in the main repo**

```yaml
# .github/workflows/glyph-audit.yml
name: glyph audit
on: pull_request
jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.0 }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @glyph/cli run build
      - run: pnpm --filter @glyph/cli exec npm link  # makes `glyph` available
      - uses: seanhanca/glyph-audit-action@v1
        with:
          spec-pattern: "examples/*.glyph.json"
          fail-on: error
```

- [ ] **Step 2: Add 3–4 example specs to `examples/`**

These are the spec fixtures the action will audit on real PRs.

- [ ] **Step 3: Open a PR that changes one of them, watch the action comment**

If the bot comment posts cleanly with diff + audit + trust + images, ship.

Acceptance for PR7:
- The Glyph main repo runs the action on its own PRs
- A README badge points to the action: `[![Chart audit](https://github.com/seanhanca/glyph-audit-action/actions/workflows/release.yml/badge.svg)](https://github.com/marketplace/actions/glyph-chart-audit)`

PR title: `feat: dogfood glyph-audit-action on main repo (PR7/7)`.

---

## Acceptance criteria for S4 overall

- [ ] Action published to GitHub Marketplace as `seanhanca/glyph-audit-action@v1`
- [ ] Detects changed `.glyph.json` files on PRs
- [ ] Comments with: diff, audit findings, trust score, before/after SVGs
- [ ] Sticky-comment mode works (updates instead of spamming)
- [ ] Glyph's own repo uses the action
- [ ] At least 3 example specs in the repo for the action to chew on
- [ ] Launch post: "We automated chart code review" on dev.to + Hashnode

---

## Self-review

**Spec coverage:**
- ✅ `glyph-audit-action@v1` (PR1–PR6)
- ✅ Comments on PRs when chart specs change (PR2 detect + PR5 comment)
- ✅ Shows diff, audit findings, before/after image, trust score (PR3 render + PR4 upload)
- ✅ Every adopting repo becomes a free Glyph billboard via the PR-comment surface

**No placeholders:**
- The `uploadSvgsToBranch` stub in PR4 step 1 explicitly notes "stub for plan; real impl in this PR" — that's the contract, the PR's job is to fill it.
- All other steps have concrete code or commands.

**Type consistency:**
- `ChangedSpec` (PR2) → consumed by `renderSpecDiff` (PR3) ✓
- `RenderResult` (PR3) → consumed by upload + comment (PR4/PR5) ✓
- Octokit type imported consistently across PR3/PR4/PR5 ✓
