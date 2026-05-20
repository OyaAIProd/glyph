// site/play/playground.js
// Main controller. PR2 wires CSV upload + DuckDB-wasm. Later PRs add spec
// editor, live chart, audit panel, and share.
import { describeTable, getDuckDb, loadCsv, queryRows } from "./duckdb.js";
import * as glyph from "./glyph-bundle.js";

console.log("playground booting…");
console.log("@glyph/core exports:", Object.keys(glyph).slice(0, 10));

// 10 MB cap on pasted/uploaded CSVs. Anything larger hangs the tab while
// DuckDB-wasm tries to parse + materialize the file; a public playground
// should fail fast with a readable message instead.
const CSV_SIZE_CAP_BYTES = 10 * 1024 * 1024;

function mountCsvUpload(host, onLoaded) {
  host.innerHTML = `
    <input type="file" id="csv-file" accept=".csv,text/csv" />
    <p class="hint">or paste:</p>
    <textarea id="csv-paste" placeholder="hour,rides&#10;0,42&#10;1,38&#10;..." rows="8"></textarea>
    <p id="csv-status" class="hint">Initializing DuckDB…</p>
    <select id="csv-example" disabled>
      <option value="">— or load example —</option>
      <option value="examples/rides.csv">rides.csv (12 rows)</option>
    </select>
  `;
  const status = host.querySelector("#csv-status");
  const selectExample = host.querySelector("#csv-example");

  // Eagerly warm DuckDB so the user finds out about wasm/SAB/COEP problems
  // immediately on page load, not on first paste.
  getDuckDb().then(
    () => {
      status.textContent = "Ready — paste, upload, or pick an example.";
      selectExample.disabled = false;
    },
    (e) => {
      status.textContent = `DuckDB init failed: ${e.message ?? e}`;
    },
  );

  // In-flight token. Each load increments; stale callbacks are dropped.
  // Prevents a paste-then-pick-example race from emitting onLoaded out of
  // order or against a stale CREATE OR REPLACE target.
  let loadToken = 0;

  const handle = async (csv) => {
    if (csv.length > CSV_SIZE_CAP_BYTES) {
      const mb = (csv.length / 1024 / 1024).toFixed(1);
      status.textContent = `CSV too large (${mb} MB, max 10 MB).`;
      return;
    }
    const myToken = ++loadToken;
    status.textContent = "Loading…";
    try {
      const table = await loadCsv("data", csv);
      const cols = await describeTable(table);
      const count = (await queryRows(`SELECT COUNT(*) AS n FROM ${table}`))[0].n;
      const rows = await queryRows(`SELECT * FROM ${table}`);
      if (myToken !== loadToken) return; // a newer load won; drop this one
      status.textContent = `Loaded ${count} rows, ${cols.length} columns`;
      onLoaded({ table, rows, columns: cols });
    } catch (e) {
      if (myToken !== loadToken) return;
      status.textContent = `Error: ${e.message ?? e}`;
    }
  };

  host.querySelector("#csv-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) handle(await file.text());
  });
  host.querySelector("#csv-paste").addEventListener("blur", (e) => {
    if (e.target.value) handle(e.target.value);
  });
  selectExample.addEventListener("change", async (e) => {
    if (!e.target.value) return;
    const res = await fetch(e.target.value);
    const csv = await res.text();
    host.querySelector("#csv-paste").value = csv;
    handle(csv);
  });
}

const csvHost = document.getElementById("csv-upload");
let dataset = null;
mountCsvUpload(csvHost, (loaded) => {
  dataset = loaded;
  console.log("data loaded:", dataset);
});
