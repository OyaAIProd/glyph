# Releasing `glyph-charts` to PyPI

This package publishes through GitHub Actions via **PyPI trusted publishing**
(OIDC, no API token). The workflow lives at
`.github/workflows/publish-python.yml` and fires on every `python-v*` tag push.

## One-time setup (maintainer)

Before the first release, register a trusted publisher on PyPI. **Do these
in order** — if you push a `python-v*` tag before the GitHub environment
exists, the workflow fails with an environment-protection error.

1. **GitHub first.** Create an environment named `release` under
   *Settings -> Environments*. Recommended (not required) protection rules:
   - Add at least one required reviewer (gates accidental tag pushes).
   - Restrict deployment branches to tags matching `python-v*` (deny tags
     pushed to feature branches or other tag namespaces from triggering
     this workflow).

2. **PyPI second.** Register the trusted publisher. The first publish
   needs a **pending** publisher because the project doesn't exist on PyPI
   yet: <https://pypi.org/manage/account/publishing/>
   Fill the "Add a new pending publisher" form with:
   - **PyPI Project Name:** `glyph-charts`
   - **Owner:** `seanhanca`
   - **Repository name:** `glyph`
   - **Workflow name:** `publish-python.yml` (the workflow filename — not
     the `name:` value inside the YAML)
   - **Environment name:** `release`

Once the first release lands, PyPI auto-promotes the pending publisher to a
regular trusted publisher — no further action needed for subsequent tags.

Reference: <https://docs.pypi.org/trusted-publishers/>

## Cutting a release

From a clean `main` checkout:

```bash
# 1. Bump the version in pyproject.toml AND src/glyph/__init__.py.
#    Keep them in sync — the wheel metadata comes from pyproject, but
#    `glyph.__version__` is what callers read.
$EDITOR bindings/python/pyproject.toml bindings/python/src/glyph/__init__.py

# 2. Commit the bump.
git add bindings/python/pyproject.toml bindings/python/src/glyph/__init__.py
git commit -m "chore(python): release 0.1.0a2"

# 3. Tag with the `python-v` prefix (NOT plain `v` — that's reserved for
#    any future TypeScript-side npm release tooling).
git tag python-v0.1.0a2

# 4. Push commit + tag. The workflow fires on the tag push.
git push origin main
git push origin python-v0.1.0a2
```

Watch the run at
<https://github.com/seanhanca/glyph/actions/workflows/publish-python.yml> —
the smoke-install step catches broken wheels *before* they hit PyPI (a
published bad wheel can't be replaced, only yanked).

## Pre-release naming

PEP 440 pre-release segments — use these for everything before the first
stable `0.1.0`:

| Stage           | Version string  | Tag             |
| --------------- | --------------- | --------------- |
| Alpha           | `0.1.0a1`       | `python-v0.1.0a1` |
| Beta            | `0.1.0b1`       | `python-v0.1.0b1` |
| Release candidate | `0.1.0rc1`    | `python-v0.1.0rc1` |
| Stable          | `0.1.0`         | `python-v0.1.0` |

`pip install glyph-charts` installs the latest stable; pre-releases require
`pip install --pre glyph-charts` (or pinning the exact version).

## Testing the build locally before tagging

Always dry-run the wheel before pushing the tag — the workflow does the same
checks, but iterating locally is faster than waiting on Actions:

```bash
cd bindings/python
rm -rf dist build *.egg-info
python -m build
pip install dist/*.whl --force-reinstall
python -c "import glyph; print(glyph.__version__)"

# Sanity-check that py.typed shipped (PEP 561 marker — without it,
# downstream mypy/pyright won't honor the package's type hints):
python -c "import zipfile, glob; w=sorted(glob.glob('dist/*.whl'))[-1]; print([n for n in zipfile.ZipFile(w).namelist() if 'py.typed' in n])"
```

If the smoke import fails or `py.typed` is missing, fix it *before* tagging.
