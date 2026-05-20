# Contributing to Glyph

Thanks for considering a contribution. Glyph is pre-alpha; the surface is moving fast.

## Setup

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Node 20+ and pnpm 9+ required.

## Workflow

1. Open an issue first if the change is non-trivial.
2. Branch from `main`. Prefix branch names: `feat/`, `fix/`, `chore/`, `docs/`.
3. Conventional Commits style (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
4. Every PR must pass lint + typecheck + test on the full CI matrix.
5. Snapshot tests must remain byte-identical across OS/Node combinations. If your change intentionally updates output, regenerate the snapshot corpus and explain why in the PR description.

## Scope

See [mvp.md](./mvp.md) for the active milestone. Out-of-scope contributions will be politely declined or deferred.

## Releasing the MCP server + workspace packages

Glyph publishes four npm packages that all move at the same version: `@glyph/core`, `@glyph/duckdb`, `@glyph/preview-server`, `@glyph/mcp`. The other workspace packages (`@glyph/cli`, `@glyph/canvas`, `@glyph/live`) are marked `"private": true` and are NOT published until they are intentionally released — this keeps an accidental `pnpm publish -r` from pushing them at `0.0.0`.

### Version policy

- The 4 publishable packages share the same major + minor. Patches may diverge.
- The `version` in `server.json` (repo root) must match `@glyph/mcp`'s `package.json` `version` byte-identical.
- `mcpName` in `packages/mcp/package.json` must match `name` in `server.json` byte-identical.

### One-time setup (per package, in the npmjs.com UI)

For each of `@glyph/core`, `@glyph/duckdb`, `@glyph/preview-server`, `@glyph/mcp`:

1. Visit the package settings on npmjs.com
2. Publishing → "Add trusted publisher"
3. Publisher: GitHub Actions
4. Organization: `seanhanca`
5. Repository: `glyph`
6. Workflow file: `.github/workflows/publish-mcp.yml`
7. Environment: `release`

Once configured, no `NPM_TOKEN` secret is required — the publish workflow authenticates via OIDC.

### Cutting a release

```bash
# 1. Bump the 4 publishable packages + server.json to the same new version
# 2. Commit, push, get the PR merged
# 3. Tag and push
git tag mcp-v0.1.0
git push origin mcp-v0.1.0
# 4. Watch the publish workflow
gh run watch
# 5. Refresh the MCP Registry entry (requires GitHub device-flow auth)
brew install mcp-publisher    # one-time
mcp-publisher login github
mcp-publisher publish
```

## License

By contributing you agree your contributions are licensed under Apache 2.0.
