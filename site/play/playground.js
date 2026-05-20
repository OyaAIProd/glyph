// site/play/playground.js
// Main controller. PR2 wires CSV upload + DuckDB-wasm; PR3 mounts the
// Monaco spec editor; PR4 turns the (spec, dataset) pair into a live
// SVG chart. Later PRs add audit panel + share.
import { describeTable, getDuckDb, loadCsv, queryRows } from "./duckdb.js";
import * as glyph from "./glyph-bundle.js";
import { compileAndRender, runAudit } from "./glyph-runtime.js";
import { mountSpecEditor } from "./monaco-bootstrap.js";

console.log("playground booting…");
console.log("@glyph/core exports:", Object.keys(glyph).slice(0, 10));

// Default spec used on first paint. Stringified once so the editor's
// model and our local `currentSpec` start in lockstep.
const DEFAULT_SPEC = JSON.stringify(
  { layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }] },
  null,
  2,
);
let currentSpec = DEFAULT_SPEC;

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
const chartHost = document.getElementById("chart-preview");
const auditHost = document.getElementById("audit-findings");
const trustHost = document.getElementById("trust");
let dataset = null;

// Compile + render the current spec against the current dataset and
// paint the result into the chart pane. Called whenever either input
// changes. We swallow errors here (not via the editor's validation)
// because the spec is still legal JSON Schema-wise but might point at
// a column that doesn't exist in the user's CSV — that's a runtime
// concern, surfaced as a readable message in the chart pane.
function rerender() {
  // Parse first — both chart and audit need the spec object. If the editor
  // contents aren't legal JSON, surface the error in both panes (chart pane
  // gets a red pre; audit pane gets a placeholder + the trust chip cleared)
  // and bail before touching the dataset path.
  let spec;
  try {
    spec = JSON.parse(currentSpec);
  } catch (e) {
    if (chartHost) {
      chartHost.innerHTML = `<pre class="error">JSON parse error: ${escapeHtml(e.message)}</pre>`;
    }
    renderAuditError(`JSON parse error: ${e.message}`);
    return;
  }

  // Audit is dataset-independent — runs on the spec alone. Row count is
  // passed when available so AUDIT-04 (excessive aggregation) can fire.
  renderAuditPanel(spec, dataset?.rows?.length);

  // Defensive guard: a malformed dataset (e.g. an upstream PR's onLoaded
  // callback firing before rows/columns are set) would otherwise throw
  // an uncaught TypeError inside the compile block below and leave the
  // previous chart visible. Fail soft: just no-op the chart render until
  // the next call — audit panel already updated above.
  if (!dataset || !Array.isArray(dataset.columns) || !Array.isArray(dataset.rows)) {
    return;
  }
  try {
    // DuckDB DESCRIBE returns `column_name` / `column_type`; the @glyph/core
    // compiler expects `name` / `type`. Translate here so PR2's dataset
    // shape stays opaque to glyph-runtime.js.
    const schema = dataset.columns.map((c) => ({
      name: c.column_name ?? c.name,
      type: c.column_type ?? c.type ?? "VARCHAR",
    }));
    const svg = compileAndRender(spec, dataset.rows, schema);
    chartHost.innerHTML = svg;
  } catch (e) {
    // Compile errors from @glyph/core (Zod paths in particular) can be
    // hundreds of lines of JSON-ish issues. Clamp at 1 KB so the chart
    // pane doesn't get overwhelmed; full error is still in DevTools console.
    const raw = String(e?.message ?? e);
    const msg =
      raw.length > 1000
        ? `${raw.slice(0, 1000)}\n\n… (truncated, see DevTools console for full message)`
        : raw;
    if (raw.length > 1000) console.error("Glyph compile error (full):", e);
    chartHost.innerHTML = `<pre class="error">Compile error: ${escapeHtml(msg)}</pre>`;
  }
}

// Paint the audit panel + trust chip for a (already-parsed) spec.
// Lives outside rerender() so it stays single-purpose and so PR6's share
// flow can call it directly after restoring a spec from a URL hash.
function renderAuditPanel(spec, rowCount) {
  if (!auditHost || !trustHost) return;
  let result;
  try {
    result = runAudit(spec, { rowCount });
  } catch (e) {
    renderAuditError(`audit error: ${e.message ?? e}`);
    return;
  }
  paintTrustChip(result.trust);
  if (result.findings.length === 0) {
    auditHost.innerHTML = '<li class="clean">✓ no findings</li>';
    return;
  }
  // Findings are already sorted high → low by @glyph/core. Render each as
  // a list item carrying the severity class (consumed by styles.css) plus
  // the rule_id, message, and optional suggestion + JSON pointer.
  auditHost.innerHTML = result.findings
    .map((f) => {
      const sev =
        f.severity === "high" || f.severity === "medium" || f.severity === "low"
          ? f.severity
          : "low";
      const suggestionHtml = f.suggestion
        ? `<div class="audit-suggestion">${escapeHtml(f.suggestion)}</div>`
        : "";
      const pathHtml = f.path ? `<code class="audit-path">${escapeHtml(f.path)}</code>` : "";
      return `<li class="severity-${sev}">
        <div class="audit-head"><strong>${escapeHtml(f.rule_id)}</strong> <span class="audit-sev">${sev}</span></div>
        <div class="audit-msg">${escapeHtml(f.message)}</div>
        ${suggestionHtml}
        ${pathHtml}
      </li>`;
    })
    .join("");
}

// Paint the `#trust` chip. Wrapped in helpers so PR6's screenshot can hook
// the `.trust-score` span specifically. Severity bands match the plan:
// red < 50, amber < 80, green ≥ 80.
function paintTrustChip(trust) {
  const color = trust < 50 ? "var(--red)" : trust < 80 ? "#d4a017" : "var(--green)";
  trustHost.innerHTML = `<span class="trust-score">${trust}</span><span class="trust-label"> / 100</span>`;
  trustHost.style.color = color;
}

function renderAuditError(message) {
  if (!auditHost || !trustHost) return;
  auditHost.innerHTML = `<li class="severity-high">${escapeHtml(message)}</li>`;
  trustHost.innerHTML = "";
  trustHost.style.color = "";
}

// Minimal HTML escape for error messages. Errors from the compiler can
// echo back user-supplied identifiers; we don't want a craftily-named
// column to inject markup into the chart pane.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

mountCsvUpload(csvHost, (loaded) => {
  dataset = loaded;
  console.log("data loaded:", dataset);
  rerender();
});

// Mount the Monaco spec editor. The onChange handler updates the
// in-memory copy of the spec and triggers a re-render against the
// most recent dataset.
const specHost = document.getElementById("spec-editor");
mountSpecEditor(specHost, DEFAULT_SPEC, (next) => {
  currentSpec = next;
  console.log("spec changed:", currentSpec.length, "chars");
  rerender();
})
  .then(() => {
    // Monaco fires onChange only on user edits, so the default-spec audit
    // wouldn't render until the first keystroke. Paint once on successful
    // mount so the user sees the audit panel populated immediately.
    rerender();
  })
  .catch((e) => {
    console.error("monaco mount failed:", e);
    specHost.innerHTML = `<p class="placeholder">Editor failed to load: ${e.message ?? e}</p>`;
  });
