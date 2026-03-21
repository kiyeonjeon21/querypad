import * as duckdb from "@duckdb/duckdb-wasm";

let dbInstance: duckdb.AsyncDuckDB | null = null;
let connInstance: duckdb.AsyncDuckDBConnection | null = null;
let initPromise: Promise<duckdb.AsyncDuckDB> | null = null;

export async function getDB(): Promise<duckdb.AsyncDuckDB> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
      mvp: {
        mainModule: "/duckdb/duckdb-eh.wasm",
        mainWorker: new URL(
          "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js",
          import.meta.url
        ).toString(),
      },
      eh: {
        mainModule: "/duckdb/duckdb-eh.wasm",
        mainWorker: new URL(
          "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js",
          import.meta.url
        ).toString(),
      },
    };

    const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    dbInstance = db;
    return db;
  })();

  return initPromise;
}

export async function getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
  if (connInstance) return connInstance;
  const db = await getDB();
  connInstance = await db.connect();
  return connInstance;
}

export async function resetConnection(): Promise<void> {
  if (connInstance) {
    await connInstance.close();
    connInstance = null;
  }
}
