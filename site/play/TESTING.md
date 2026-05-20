# Glyph Playground — Manual Test Plan

This file tracks manual smoke tests for each PR until Playwright e2e
coverage lands (planned in S3 PR6). The `play/` folder ships only static
ES modules — there is no Vitest runner for the browser glue.

## PR2 — CSV upload + DuckDB-wasm

Prereqs:
- Run `pnpm run build:playground` once to refresh `site/play/glyph-bundle.js`.
- Serve the `site/` directory with any static server, e.g.
  `npx -y http-server site -p 8000`.

Steps:

1. Open `http://localhost:8000/play/` in a Chromium-based browser.
2. Open DevTools → Console. You should see:
   - `playground booting…`
   - `@glyph/core exports: [...]` (first ten exports listed)
3. Paste this into the textarea:
   ```
   hour,rides
   0,42
   1,38
   ```
   Click outside the textarea to fire the `blur` event.
4. Status text below the textarea shows
   `Loaded 2 rows, 2 columns` (allow ~1s for DuckDB-wasm to instantiate
   the first time).
5. Console logs `data loaded:` followed by an object containing
   `table`, `rows` (length 2), and `columns` (length 2).
6. Open the "— or load example —" dropdown → pick
   `rides.csv (12 rows)`.
7. Textarea fills with the rides fixture (`pickup_hour,fare,rides` +
   12 data rows). Status text updates to
   `Loaded 12 rows, 3 columns`.
8. Use the file picker: select any local `.csv` file. Status updates
   with that file's row + column count. Console logs the dataset.

Pass criteria:
- DuckDB-wasm loads from the jsdelivr CDN with no console errors.
- All three input paths (paste/blur, example dropdown, file picker)
  populate the status text and fire the `onLoaded` callback.
- Errors (e.g. malformed CSV) surface in the status text rather than
  crashing the page.
- Status shows `Initializing DuckDB…` on first paint, then `Ready —
  paste, upload, or pick an example.` once the wasm engine is warm.
- Pasting a CSV larger than 10 MB shows `CSV too large (X.X MB, max
  10 MB).` without freezing the tab.

Also verify on the **deployed GitHub Pages URL**, not just localhost:

9. Open `https://seanhanca.github.io/glyph/play/` after the `pages.yml`
   workflow has run. Repeat steps 2 + 4 above.
10. In DevTools → Network, confirm the DuckDB bundle that loads is the
    `mvp` variant (single-threaded) — GitHub Pages does not serve the
    cross-origin-isolation headers (COOP/COEP) needed for the
    SharedArrayBuffer-based threaded bundle. `selectBundle` falls back
    automatically; this step just confirms it.

## Known limitations (PR2)

- DuckDB-wasm imports from jsdelivr at runtime. SRI hashes don't apply
  to ESM imports; a jsdelivr compromise would execute attacker JS in
  the user's browser. The playground holds no auth context and no user
  data leaves the page, but we'll self-host the wasm + js under
  `site/play/vendor/` in a future PR.

## PR3 — Spec editor (Monaco via CDN)

Prereqs:
- Run `pnpm run build:playground` once. The build now also copies
  `packages/core/dist/spec.schema.json` → `site/play/spec.schema.json`
  (Monaco fetches it at runtime for autocomplete + validation).
- Serve the `site/` directory as in PR2.

Steps:

1. Open `http://localhost:8000/play/` in a Chromium-based browser.
2. The Spec pane shows a Monaco editor pre-filled with:
   ```json
   {
     "layers": [
       {
         "mark": "bar",
         "encoding": { "x": "hour", "y": "rides" }
       }
     ]
   }
   ```
   Initial paint may flash blank for ~300 ms while Monaco's AMD loader
   and language workers fetch from jsdelivr.
3. Place the cursor inside the `"mark"` value and replace `"bar"` with
   `"ba`. Within ~200 ms the suggestion popup should list valid marks
   (`bar`, `bar-stacked`, `line`, etc.) — autocomplete is sourced from
   the JSON schema's `enum`.
4. Replace `"mark"` with `"invalid"`. A red squiggle appears under the
   string; hovering shows
   `Value is not accepted. Valid values: "bar", "bar-stacked", ...`.
   This proves schema validation is wired.
5. Type any character. DevTools Console logs
   `spec changed: N chars` on every keystroke — confirms the
   `onChange` callback (used by PR4 to drive live render) fires.
6. In DevTools → Network, confirm the editor chunks load from
   `cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/...` (pinned
   minor version) and `./spec.schema.json` 200s from the same origin.

Pass criteria:
- Monaco editor mounts inside `#spec-editor` (no placeholder text).
- Autocomplete + red squiggles work against the Glyph schema.
- Editor failure (e.g. CDN blocked) shows the fallback message
  `Editor failed to load: …` instead of a blank pane.

## Known limitations (PR3)

- Monaco loads from jsdelivr at runtime — same CDN trust caveat as
  DuckDB-wasm in PR2. We'll evaluate self-hosting in a later PR.
- The schema is fetched once on mount. If `@glyph/core`'s spec
  contract changes between page-load and edit, the user has to
  refresh to see the new validation rules.
