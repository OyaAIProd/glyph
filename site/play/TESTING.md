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

## PR4 — Live chart preview + glyph-runtime

Prereqs:
- Run `pnpm run build:playground` once.
- Serve the `site/` directory as in PR2/PR3.

Steps:

1. Open `http://localhost:8000/play/` in a Chromium-based browser.
2. Chart pane is empty (no placeholder text) until a dataset loads.
3. From the example dropdown, pick `rides.csv (12 rows)`. The chart
   pane fills with an SVG bar chart. Default spec uses
   `x: "hour"` / `y: "rides"`, but rides.csv has `pickup_hour` — so on
   first paint expect a readable `Compile error:` red box. That's the
   error path working; proceed to step 4.
4. In the Spec editor, change `"x": "hour"` → `"x": "pickup_hour"`.
   The chart pane updates within ~50 ms with a bar chart of rides
   over pickup hour.
5. Change `"mark": "bar"` → `"mark": "point"`. The chart redraws as
   a scatter/point chart. Confirms onChange → rerender wiring.
6. Type a stray `{` at the start of the spec to break JSON. Chart
   pane shows a red `<pre>` block:
   `JSON parse error: ...`. The previous chart is replaced — no
   partial state lingers.
7. Restore valid JSON, then change `"mark": "bar"` → `"mark": "bogus"`.
   Monaco shows a red squiggle (schema validation, PR3) and the chart
   pane shows `Compile error: ...` describing the unknown mark.
8. **Byte-identity check.** Open the page in two tabs. In both: load
   `rides.csv`, set the same spec (e.g. `pickup_hour` / `rides` bar).
   In DevTools Console in each tab run:
   ```js
   document.getElementById('chart-preview').innerHTML.length
   ```
   The two lengths must be identical. Then run
   ```js
   document.getElementById('chart-preview').innerHTML
   ```
   in each — strings should be character-for-character identical.
   (The compiler is pure; if these diverge, file a bug.)

Pass criteria:
- First spec edit after data loads paints an SVG within ~50 ms.
- JSON syntax errors and compile errors both surface as red `<pre>`
  blocks in the chart pane (no console-only failures, no white pane).
- Byte-identity check passes for repeated renders of the same inputs.
- Chart never overflows the pane (CSS `max-width: 100%; height: auto;`).

## Known limitations (PR4)

- Re-render runs synchronously on every keystroke. For specs that
  produce large SVGs (>1000 marks) typing may stutter. PR6 may add a
  debounce or a Web Worker if benchmarks justify it.
- Compile errors are surfaced as `e.message`. If the compiler throws
  a `ZodError`, the message is the raw JSON-ish issue list — readable
  but not pretty. Better formatting can land alongside the audit
  panel (PR5).

## PR5 — Audit panel + trust score

Prereqs:
- Run `pnpm run build:playground` once.
- Serve the `site/` directory as in PR2/PR3/PR4.

Steps:

1. Open `http://localhost:8000/play/` in a Chromium-based browser.
2. On first paint (no CSV loaded yet), the Audit pane should already
   show findings for the default spec (`bar` / `hour` / `rides`).
   At minimum: `AUDIT-04` (excessive aggregation) does NOT fire yet
   because no row count is known — that's expected; we only feed
   `rowCount` to the auditor once data loads. Trust chip in the header
   shows `NN / 100` colored according to severity bands.
3. From the example dropdown, pick `rides.csv (12 rows)`. The chart
   pane fills with a `Compile error:` (default spec uses `hour`, not
   `pickup_hour`). The audit panel re-runs with the now-known row count
   and may add `AUDIT-04` if aggregation is excessive.
4. In the Spec editor, change `"x": "hour"` → `"x": "pickup_hour"`.
   Chart renders. Audit re-runs on the same keystroke. No layout
   thrash — findings list and trust chip both update in place.
5. **Trigger a high-severity finding.** Add a `scale` block under
   the `y` channel that pins the domain above zero:
   ```json
   {
     "layers": [
       {
         "mark": "bar",
         "encoding": {
           "x": "pickup_hour",
           "y": { "field": "rides", "scale": { "domain": [20, 60] } }
         }
       }
     ]
   }
   ```
   `AUDIT-01` ("bar chart y-axis domain starts at 20, not 0…") fires
   with a red left border (severity-high). Trust score drops by 15.
6. **Trigger a low-severity finding.** Inflate the rendering width
   to force AUDIT-07 (extreme aspect ratio):
   ```json
   { "width": 1200, "height": 200, "layers": [...] }
   ```
   `AUDIT-07` should appear with a blue (accent) left border
   (severity-low). Trust score drops by 3 from the previous value.
7. **Clean spec → empty state.** Restore the spec to a vanilla
   `bar` chart with `pickup_hour` / `rides`. The findings list
   collapses to a single green `✓ no findings` item. Trust chip
   reads `100 / 100` in green.
8. **JSON parse error path.** Type a stray `{` at the start of the
   spec. Audit pane shows a red `JSON parse error: …` line; trust
   chip clears (empty). Restore valid JSON — both repopulate.
9. **Severity color spot-check.** With one finding visible at each
   tier (force them by editing the spec), confirm:
   - high → red left border (`#c0392b`)
   - medium → amber left border (`#d4a017`)
   - low → accent-blue left border (`#4c78a8`)
   And the trust chip color:
   - `>=80` → green
   - `>=50` → amber
   - `<50`  → red

Pass criteria:
- Audit panel populates on initial mount (no need to load data first).
- Findings re-render on every spec edit, with stable severity classes
  (`severity-high` / `severity-medium` / `severity-low`).
- Trust chip renders as `<span class="trust-score">NN</span><span
  class="trust-label"> / 100</span>` so PR6's share screenshot can
  highlight it.
- Empty findings → green `✓ no findings` placeholder, trust = 100.
- JSON parse error wipes audit + clears trust chip (no stale data).

## Known limitations (PR5)

- The trust-score formula is a temporary playground-local fallback
  (`100 - Σ(15·high + 7·medium + 3·low)`). `@glyph/core` does not yet
  export a `computeTrust` helper; once it does, delete the fallback
  in `site/play/glyph-runtime.js`. The MCP verb `glyph_trust` is a
  separate concept (provenance/freshness) and is intentionally NOT
  what this score reports.
- Findings re-render synchronously on every keystroke. For very large
  specs this can stutter; deferred to PR6's perf pass if benchmarks
  justify a debounce.

## PR6 — Share via URL hash + GitHub Gist, launch

Prereqs: same as PR5.

Steps — URL hash share:

1. Load `http://localhost:8000/play/` and pick the `rides.csv (12 rows)`
   example. Audit panel should populate.
2. Click **Share URL**. A toast at the bottom-right reads
   `Copied N-char share URL`.
3. Paste the URL into a new tab. The page boots, then a toast reads
   `Loaded from shared URL`. The spec editor and CSV textarea are
   populated; the chart + audit panel match the source tab byte-for-byte.
4. Open DevTools → Network. No request hit `api.github.com` — URL hash
   mode is fully offline.

Steps — Gist share (anonymous):

1. From the loaded playground, click **Save to Gist**. The toast reads
   `Creating gist…` then `Saved gist · URL copied`.
2. Paste the URL (`…/play/?gist=<id>`) into a new tab. Toast:
   `Loaded gist <prefix>…`. Spec + CSV restored.
3. Visit `https://gist.github.com/<id>` in another tab. Two files:
   `playground.glyph.json` and `data.csv`. Both round-trip byte-clean.

Steps — rate-limit fallback ("Save to my account"):

1. To force the 403 path, temporarily edit `share.js` and `throw new
   GistRateLimitError("test")` at the top of `createAnonymousGist`.
2. Click **Save to Gist**. The error toast surfaces; a confirm dialog
   asks `Open GitHub to save manually?`.
3. Accept. A new tab opens at `https://gist.github.com/`. Clipboard
   contains the spec + CSV block (paste into the new gist's body).
4. Revert the test throw.

Steps — URL-too-long path:

1. Load a large dataset (~5K rows). Click **Share URL**.
2. If the URL > 7500 chars, the prompt offers Gist fallback. Accept;
   the Gist flow takes over.

Steps — `Submit to gallery` link:

1. Click the topbar "Submit to gallery" link.
2. New tab opens at the repo's GitHub Discussions new-form with the
   `playground` category preselected. Form fields: Name, Playground URL,
   Notes, License acknowledgement.

Pass criteria:

- Roundtrip is identity: encode → decode produces byte-equal spec + CSV.
- All three share paths copy to clipboard on success; the prompt fallback
  works when clipboard is blocked (test in Safari).
- 403 from GitHub triggers the typed `GistRateLimitError` and the
  `openSaveToMyAccount` fallback path runs.
- Loading a malformed `#h=` hash shows an error toast and leaves the
  default spec intact (no crash, no white page).

## Known limitations (PR6)

- `og-playground.png` is checked in as an SVG source
  (`site/og-playground.svg`) — the PNG rendering step needs `rsvg-convert`
  or ImageMagick on a developer machine. Until that runs, social-card
  previews fall back to no image (the `og:image` meta still points at
  the future PNG path).
- Anonymous gist creation is rate-limited at ~60/hour per IP by GitHub.
  Once limits matter we add an "open my account" path that's already in
  place as the fallback.
