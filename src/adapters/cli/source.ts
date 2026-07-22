import path from "node:path";
import type { QueryRunner } from "../../core/discovery/relationships";
import type { TableInfo } from "../../core/types";
import { attachDatabase } from "../../engine/attach/load";
import { parseConnectionString } from "../../engine/attach/connection-string";
import { loadFolder } from "../../engine/duckdb/load";

export interface LoadedSource {
  tables: TableInfo[];
  /** Files or tables present at the source but not registered. */
  skipped: string[];
}

/**
 * Where the tables come from. A folder of files and an attached external
 * database are interchangeable to everything above this line: both end up as
 * queryable relations behind the same `QueryRunner`.
 */
export interface Source {
  /** Directory the `.datactx/` artifacts are written to and read from. */
  outDir: string;
  /** Credential-free description for logs and error messages. */
  label: string;
  /** Message shown when the source yields no tables. */
  emptyMessage: string;
  load(runner: QueryRunner): Promise<LoadedSource>;
}

export interface SourceOptions {
  /** Positional folder argument (defaults to the current directory). */
  folder?: string;
  /** `--db` connection string; when present the source is an external database. */
  db?: string;
  /** `--schema` restricts an external database to one schema. */
  schema?: string;
  /** `--out` overrides where artifacts are written (external databases only). */
  out?: string;
}

const FOLDER_FILE_TYPES = ".parquet, .csv, .tsv, .json, .jsonl, .ndjson";

/**
 * Build a `Source` from CLI options. Without `--db` this is the folder scan that
 * QueryPad has always done; with `--db` it attaches Postgres/MySQL/SQLite
 * read-only and exposes its tables as local views.
 */
export function resolveSource(options: SourceOptions): Source {
  if (options.db) {
    const spec = parseConnectionString(options.db);
    const outDir = path.resolve(options.out ?? options.folder ?? ".");
    return {
      outDir,
      label: spec.label,
      emptyMessage:
        `No tables found in ${spec.label}` +
        (options.schema ? ` (schema "${options.schema}")` : "") +
        ".",
      load: (runner) => attachDatabase(spec, runner, { schema: options.schema }),
    };
  }

  const folder = path.resolve(options.folder ?? ".");
  return {
    outDir: folder,
    label: folder,
    emptyMessage: `No supported data files found in ${folder} (${FOLDER_FILE_TYPES}).`,
    load: (runner) => loadFolder(folder, runner),
  };
}
