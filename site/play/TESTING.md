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
