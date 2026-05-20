// site/play/duckdb.js
// Lazy-loads DuckDB-wasm from jsdelivr, exposes a tiny API.

import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm";

let _db = null;

export async function getDuckDb() {
  if (_db) return _db;
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  _db = db;
  return db;
}

export async function loadCsv(tableName, csv) {
  const db = await getDuckDb();
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
