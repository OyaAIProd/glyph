// site/play/playground.js
// Main controller. PR2 wires CSV upload + DuckDB-wasm. Later PRs add spec
// editor, live chart, audit panel, and share.
import { describeTable, loadCsv, queryRows } from "./duckdb.js";
import * as glyph from "./glyph-bundle.js";

console.log("playground booting…");
console.log("@glyph/core exports:", Object.keys(glyph).slice(0, 10));

function mountCsvUpload(host, onLoaded) {
  host.innerHTML = `
    <input type="file" id="csv-file" accept=".csv,text/csv" />
    <p class="hint">or paste:</p>
    <textarea id="csv-paste" placeholder="hour,rides&#10;0,42&#10;1,38&#10;..." rows="8"></textarea>
    <p id="csv-status" class="hint"></p>
    <select id="csv-example">
      <option value="">— or load example —</option>
      <option value="examples/rides.csv">rides.csv (12 rows)</option>
    </select>
  `;
  const status = host.querySelector("#csv-status");

  const handle = async (csv) => {
    status.textContent = "Loading…";
    try {
      const table = await loadCsv("data", csv);
      const cols = await describeTable(table);
      const count = (await queryRows(`SELECT COUNT(*) AS n FROM ${table}`))[0].n;
      status.textContent = `Loaded ${count} rows, ${cols.length} columns`;
      onLoaded({
        table,
        rows: await queryRows(`SELECT * FROM ${table}`),
        columns: cols,
      });
    } catch (e) {
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
  host.querySelector("#csv-example").addEventListener("change", async (e) => {
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
