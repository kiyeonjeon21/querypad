import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ColumnInfo, TableInfo } from "../../types";
import type { QueryRunner } from "../discovery/relationships";
import { fileExtension, sanitizeTableName } from "../utils";
import { quoteIdent } from "../duckdb/sql-utils";

/** File types DuckDB can read directly from disk in Node. */
const SUPPORTED_EXTENSIONS = new Set(["parquet", "csv", "tsv", "json", "jsonl", "ndjson"]);

export interface LoadFolderResult {
  tables: TableInfo[];
  /** Files present in the folder that were skipped (unsupported type). */
  skipped: string[];
}

function escapeLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function readFunction(ext: string, absolutePath: string): string | null {
  const literal = `'${escapeLiteral(absolutePath)}'`;
  switch (ext) {
    case "parquet":
      return `read_parquet(${literal})`;
    case "csv":
    case "tsv":
      return `read_csv_auto(${literal})`;
    case "json":
    case "jsonl":
    case "ndjson":
      return `read_json_auto(${literal})`;
    default:
      return null;
  }
}

/** Ensure a table name is unique within this load (e.g. users.csv vs users.parquet). */
function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  const name = `${base}_${suffix}`;
  taken.add(name);
  return name;
}

async function describeTable(name: string, runner: QueryRunner): Promise<ColumnInfo[]> {
  const rows = await runner(`DESCRIBE ${quoteIdent(name)}`);
  return rows.map((row) => ({
    name: String(row.column_name),
    type: String(row.column_type),
  }));
}

async function countRows(name: string, runner: QueryRunner): Promise<number> {
  const rows = await runner(`SELECT COUNT(*) AS cnt FROM ${quoteIdent(name)}`);
  return Number(rows[0]?.cnt ?? 0);
}

/**
 * Scan a folder (top level) and register every supported data file as a DuckDB table.
 * Returns the loaded tables plus any files that were skipped.
 */
export async function loadFolder(
  folder: string,
  runner: QueryRunner
): Promise<LoadFolderResult> {
  const entries = await readdir(folder, { withFileTypes: true });
  const tables: TableInfo[] = [];
  const skipped: string[] = [];
  const taken = new Set<string>();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = fileExtension(entry.name);
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      skipped.push(entry.name);
      continue;
    }

    const absolutePath = path.resolve(folder, entry.name);
    const readFn = readFunction(ext, absolutePath);
    if (!readFn) {
      skipped.push(entry.name);
      continue;
    }

    const name = uniqueName(sanitizeTableName(entry.name), taken);
    await runner(`CREATE OR REPLACE TABLE ${quoteIdent(name)} AS SELECT * FROM ${readFn}`);
    const columns = await describeTable(name, runner);
    const rowCount = await countRows(name, runner);
    tables.push({ name, columns, rowCount });
  }

  return { tables, skipped };
}
