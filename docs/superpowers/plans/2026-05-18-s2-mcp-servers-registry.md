# S2 — Publish Glyph to the MCP Registry

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (inline). The master PR cycle template lives in `2026-05-18-tier-s-master.md`.

**Goal:** Land Glyph in the official **MCP Registry** at `https://registry.modelcontextprotocol.io/` so it appears in the first place every agent dev looks for tools.

**Architecture:** The registry-as-PR model was retired. The new path:
1. Publish `@glyph/mcp` to npm with an `mcpName: "io.github.seanhanca/glyph"` property in `package.json`.
2. Create a `server.json` at the repo root with the registry metadata.
3. Authenticate `mcp-publisher` via GitHub device flow.
4. Run `mcp-publisher publish`.

**Tech stack:**
- npm — package registry
- `mcp-publisher` CLI (`brew install mcp-publisher` or pre-built binary)
- GitHub OIDC trusted publishing for the npm release workflow (no `NPM_TOKEN` secret needed)
- `server.json` at repo root (matches schema `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`)

**Effort:** S (3–4 hours of work: npm publish setup + server.json + first registry publish). Subsequent version bumps are 5 minutes.

**Calendar:** Week 1.

**PR count:** 2 internal PRs.

---

## Task 1: PR1 — Prep `@glyph/mcp` for npm + write `server.json`

**Branch:** `feat/s2-registry-prep`

**Files:**
- Modify: `packages/mcp/package.json` (add `mcpName`, set version, add `repository`, ensure `bin`, `files`, `publishConfig`)
- Create: `server.json` at repo root
- Create: `.github/workflows/publish-mcp.yml` (OIDC trusted publishing to npm + registry update on tag)
- Modify: `README.md` (add a Registry badge once the publish lands)
- Modify: `packages/mcp/README.md` (add `mcpName` + registry usage block)

- [ ] **Step 1: Update `packages/mcp/package.json`**

```jsonc
{
  "name": "@glyph/mcp",
  "version": "0.1.0",
  "mcpName": "io.github.seanhanca/glyph",
  "description": "Glyph MCP server — 49 verbs for deterministic chart rendering, query, audit, anomaly, forecast, decompose, explain, story planning, and Whyboard analytics.",
  "license": "Apache-2.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "glyph-mcp": "./dist/bin.js"
  },
  "files": ["dist", "README.md"],
  "repository": {
    "type": "git",
    "url": "https://github.com/seanhanca/glyph.git",
    "directory": "packages/mcp"
  },
  "homepage": "https://github.com/seanhanca/glyph",
  "bugs": "https://github.com/seanhanca/glyph/issues",
  "keywords": ["mcp", "charts", "visualization", "duckdb", "agents", "data-viz"],
  "publishConfig": {
    "access": "public",
    "provenance": true
  },
  "scripts": {
    "build": "tsc -p tsconfig.json && node ../cli/scripts/make-bin-executable.js",
    "test": "vitest run --testTimeout=15000"
  },
  "dependencies": {
    "@glyph/core": "workspace:*",
    "@glyph/duckdb": "workspace:*",
    "@glyph/preview-server": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.4",
    "@resvg/resvg-js": "^2.6.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.3"
  }
}
```

Important:
- `mcpName: "io.github.seanhanca/glyph"` is required by the registry (auth-prefix verifies the GitHub org owns the name)
- `version: "0.1.0"` — first publishable version (was `0.0.0`)
- `publishConfig.provenance: true` enables sigstore provenance via GitHub OIDC
- The workspace `@glyph/core`, `@glyph/duckdb`, `@glyph/preview-server` deps must also be published. They're currently `0.0.0` — need their own versions and publishes. **This is a prerequisite blocker.**

- [ ] **Step 2: Decide workspace version policy + bump siblings**

`@glyph/mcp` cannot publish until its workspace deps are also published. The cleanest path: publish all four packages at the same version, coordinated via a single release.

Add to each of `packages/core/package.json`, `packages/duckdb/package.json`, `packages/preview-server/package.json`:

- `"version": "0.1.0"`
- `"publishConfig": { "access": "public", "provenance": true }`
- `"repository"`, `"homepage"`, `"bugs"`, `"keywords"`

(`@glyph/canvas`, `@glyph/cli`, `@glyph/live` are not mcp deps; they can ship at their own pace, but coordinated 0.1.0 across the workspace is cleaner.)

The S4 plan's PR0 (extending `@glyph/cli`) becomes easier if `@glyph/cli` is also at 0.1.0.

Document the policy in `CONTRIBUTING.md`:

> Workspace packages share a major+minor version. Patches are independent.

- [ ] **Step 3: Write `server.json` at repo root**

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.seanhanca/glyph",
  "description": "Deterministic chart compiler with 49 agent-callable verbs. Render JSON specs to byte-stable SVG, query the underlying DuckDB view, audit charts (8 rules) for misleading patterns, forecast and detect anomalies, decompose time series, build cross-agent analytic narratives (Whyboard) — all via one MCP server.",
  "repository": {
    "url": "https://github.com/seanhanca/glyph",
    "source": "github"
  },
  "version": "0.1.0",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@glyph/mcp",
      "version": "0.1.0",
      "transport": {
        "type": "stdio"
      }
    }
  ]
}
```

The `name` here **must** match `mcpName` in `packages/mcp/package.json`.

- [ ] **Step 4: Write `.github/workflows/publish-mcp.yml`**

```yaml
name: publish-mcp
on:
  push:
    tags:
      - "mcp-v*"
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    environment: release
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.0 }
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"
          registry-url: "https://registry.npmjs.org"
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r --filter @glyph/core --filter @glyph/duckdb --filter @glyph/preview-server --filter @glyph/mcp run build
      - name: Publish workspace packages (in dep order)
        run: |
          pnpm --filter @glyph/core publish --no-git-checks
          pnpm --filter @glyph/duckdb publish --no-git-checks
          pnpm --filter @glyph/preview-server publish --no-git-checks
          pnpm --filter @glyph/mcp publish --no-git-checks
        env:
          NPM_CONFIG_PROVENANCE: "true"

  # NOTE: a separate job that runs `mcp-publisher publish` could go here, but
  # it requires interactive `mcp-publisher login github` device flow. For v1
  # we run that step manually after the npm publish completes; see Step 8.
```

- [ ] **Step 5: Update `packages/mcp/README.md`**

Add a section right at the top:

```markdown
# @glyph/mcp

Glyph MCP server — 49 verbs. Listed in the official [MCP Registry](https://registry.modelcontextprotocol.io/) as `io.github.seanhanca/glyph`.

## Quickstart

```bash
npx -y @glyph/mcp
```

Register with Claude Code:

```bash
claude mcp add glyph -- npx -y @glyph/mcp
```

## Identifiers

- npm: `@glyph/mcp`
- MCP Registry: `io.github.seanhanca/glyph`
- Transport: stdio

(Rest of README unchanged.)
```

- [ ] **Step 6: Configure npm trusted publishing (one-time, manual)**

On npmjs.com → packages `@glyph/core`, `@glyph/duckdb`, `@glyph/preview-server`, `@glyph/mcp` → Settings → Publishing → "Add trusted publisher":
- Publisher: GitHub Actions
- Organization: `seanhanca`
- Repository: `glyph`
- Workflow file: `.github/workflows/publish-mcp.yml`
- Environment: `release`

This is a hand-step. Document it in `CONTRIBUTING.md` so future maintainers can repeat it for new packages.

- [ ] **Step 7: Run the standard PR cycle**

Acceptance for PR1:
- `pnpm install --frozen-lockfile` succeeds with the version + mcpName changes
- `pnpm -r run build` clean
- `pnpm -r run test` clean (the version bumps shouldn't affect tests)
- CI green
- README + packages/mcp/README updated

PR title: `feat: prep @glyph/mcp for MCP Registry publish (PR1/2)`.

---

## Task 2: PR2 — First publish to npm + registry

This is the cutover. Once PR1 is merged + trusted publishing is configured:

- [ ] **Step 1: Tag the release in main**

```bash
git checkout main
git pull
git tag mcp-v0.1.0
git push origin mcp-v0.1.0
```

- [ ] **Step 2: Watch the publish workflow**

```bash
gh run watch
```

Expected: 4 packages published to npm (`@glyph/core`, `@glyph/duckdb`, `@glyph/preview-server`, `@glyph/mcp`), each with sigstore provenance.

Verify:

```bash
npm view @glyph/mcp version          # should print 0.1.0
npx -y @glyph/mcp                    # should boot the server (Ctrl+C to exit)
```

- [ ] **Step 3: Install `mcp-publisher` locally**

```bash
brew install mcp-publisher
# or download the binary from https://github.com/modelcontextprotocol/registry/releases/latest
mcp-publisher --help
```

- [ ] **Step 4: Authenticate via GitHub device flow**

```bash
mcp-publisher login github
```

Visit the printed device URL, enter the code, authorize.

- [ ] **Step 5: Publish `server.json` to the registry**

From the repo root:

```bash
mcp-publisher publish
```

Expected: `Successfully published io.github.seanhanca/glyph@0.1.0`.

Verify:

```bash
curl -s https://registry.modelcontextprotocol.io/v0/servers | jq '.[] | select(.name == "io.github.seanhanca/glyph")'
```

Or open `https://registry.modelcontextprotocol.io/` and search for "glyph".

- [ ] **Step 6: Internal follow-up PR — README badge + landing site link**

**Branch:** `docs/registry-badge`

```diff
 [![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
+[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.seanhanca%2Fglyph-blue)](https://registry.modelcontextprotocol.io/?search=glyph)
 [![Tests](https://img.shields.io/badge/tests-679%20passing-brightgreen.svg)](#status)
```

In `site/index.html`, add to the hero or get-started block:

```html
<p class="meta">
  Listed in the official
  <a href="https://registry.modelcontextprotocol.io/?search=glyph">MCP Registry</a>
  as <code>io.github.seanhanca/glyph</code>.
</p>
```

Run the standard PR cycle.

PR title: `docs: MCP Registry badge after publish (PR2/2)`.

---

## Task 3: Subsequent version bumps (template, not a one-time task)

Once 0.1.0 is live:

- [ ] **For every release** (e.g., 0.1.1 → 0.2.0):
  1. Bump versions in workspace packages (use `changesets` or manual bump)
  2. Bump `server.json` `version` to match `@glyph/mcp` version
  3. Tag `mcp-v0.1.1`
  4. Push → npm workflow publishes → run `mcp-publisher publish` to refresh the registry entry

Document this in `CONTRIBUTING.md` → "Releasing the MCP server".

---

## Acceptance criteria

- [ ] All 4 packages (`@glyph/core`, `@glyph/duckdb`, `@glyph/preview-server`, `@glyph/mcp`) live on npm at version `0.1.0`+
- [ ] `npx -y @glyph/mcp` works from a clean machine
- [ ] `io.github.seanhanca/glyph` queryable via the MCP Registry API
- [ ] README has Registry badge
- [ ] Process documented in `CONTRIBUTING.md`

---

## Self-review

**Spec coverage:**
- ✅ Glyph submitted + landed in the official MCP registry (the new one, not the retired `servers` repo)
- ✅ Fallback registries (`awesome-mcp-servers`) noted in master plan risk register

**No placeholders:** every step has concrete commands. Manual hand-steps (npm trusted publishing config, `mcp-publisher login`) are explicitly called out so they're not forgotten.

**Type consistency:** server.json `name` matches package.json `mcpName` ✓. Versions aligned across `server.json` and `packages/mcp/package.json` ✓.

---

## Why the original "PR to servers repo" plan is gone

`CONTRIBUTING.md` in `modelcontextprotocol/servers` (read 2026-05-18):

> The README no longer contains a list of third-party MCP servers — that list has been retired in favor of the MCP Server Registry. To make your server discoverable, follow the quickstart guide to publish it there.

So all paths now route through the registry. The new path is heavier (npm publish prerequisite) but ultimately more durable: registry entries carry version history, multiple package types (npm/PyPI/NuGet/OCI), and structured metadata.
