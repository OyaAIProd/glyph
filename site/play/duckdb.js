// site/play/duckdb.js
// Lazy-loads DuckDB-wasm from jsdelivr, exposes a tiny API.
//
// SUPPLY-CHAIN NOTE: this module imports JavaScript from jsdelivr at page-load
// time. SRI/integrity hashes aren't applicable to ESM imports. A jsdelivr
// compromise would execute attacker code in the user's browser. Mitigated by
// (a) pinning the exact version below, (b) running entirely client-side with
// no auth context or user data leaving the page. A future PR will self-host
// the wasm + js artifacts under site/play/vendor/ to remove this dependency.

import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm";

let _db = null;

export async function getDuckDb() {
  if (_db) return _db;
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  );
  const worker = new Worker(workerUrl);
  // Worker has already loaded the source by the time `new Worker(url)` returns,
  // so we can release the blob URL immediately. Hygiene; not a leak in
  // practice since this code runs once per page (singleton).
  URL.revokeObjectURL(workerUrl);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  _db = db;
  return db;
}

export async function loadCsv(tableName, csv) {
  const db = await getDuckDb();
  // `safe` is whitelist-filtered to [a-zA-Z0-9_], so it's safe to interpolate
  // as a SQL identifier below. Do NOT broaden this regex without revisiting
  // the SQL composition.
  const safe = tableName.replace(/[^a-zA-Z0-9_]/g, "_");
  await db.registerFileText(`${safe}.csv`, csv);
  const conn = await db.connect();
  try {
    await conn.query(
      `CREATE OR REPLACE TABLE ${safe} AS SELECT * FROM read_csv_auto('${safe}.csv')`,
    );
  } finally {
    await conn.close();
  }
  return safe;
}

export async function queryRows(sql) {
  const db = await getDuckDb();
  const conn = await db.connect();
  try {
    const result = await conn.query(sql);
    return result.toArray().map((r) => Object.fromEntries(Object.entries(r)));
  } finally {
    await conn.close();
  }
}

export async function describeTable(tableName) {
  return queryRows(`DESCRIBE ${tableName}`);
}
