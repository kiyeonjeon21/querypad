/** External database engines DuckDB can attach through an extension. */
export type AttachEngine = "postgres" | "mysql" | "sqlite";

export interface AttachSpec {
  engine: AttachEngine;
  /** The connection string handed to DuckDB's ATTACH, prefix stripped. */
  target: string;
  /** Credential-free label safe to print and to write into artifacts. */
  label: string;
}

/** DuckDB's ATTACH `TYPE` keyword per engine. */
export const ATTACH_TYPE: Record<AttachEngine, string> = {
  postgres: "POSTGRES",
  mysql: "MYSQL",
  sqlite: "SQLITE",
};

const SQLITE_FILE_EXTENSIONS = [".db", ".sqlite", ".sqlite3", ".duckdb"];

/**
 * Strip credentials from a connection string so it can be logged and stored.
 * Handles both URI form (`postgres://user:pw@host/db`) and libpq keyword form
 * (`host=x password=secret dbname=y`).
 */
export function redactConnectionString(value: string): string {
  let out = value.replace(/\/\/[^/@]*@/, "//");
  out = out.replace(/\b(password|passwd|pwd)\s*=\s*("[^"]*"|'[^']*'|\S+)/gi, "$1=***");
  return out;
}

function looksLikeSqliteFile(value: string): boolean {
  const withoutQuery = value.split("?")[0].toLowerCase();
  return SQLITE_FILE_EXTENSIONS.some((ext) => withoutQuery.endsWith(ext));
}

/**
 * Parse a `--db` value into an engine + target.
 *
 * Accepted forms:
 *   postgres://user:pw@host:5432/db     postgresql:// also works
 *   postgres:dbname=shop host=localhost (libpq keyword form)
 *   mysql://user:pw@host:3306/db
 *   sqlite:./shop.db                    or sqlite://./shop.db
 *   ./shop.db                           (bare path with a SQLite-ish extension)
 */
export function parseConnectionString(value: string): AttachSpec {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Empty --db connection string.");
  }

  const uriMatch = /^([a-z][a-z0-9+.-]*):(\/\/)?/i.exec(trimmed);
  const scheme = uriMatch?.[1]?.toLowerCase();

  let engine: AttachEngine | null = null;
  let target = trimmed;

  switch (scheme) {
    case "postgres":
    case "postgresql":
      engine = "postgres";
      // DuckDB accepts the full URI; only the bare keyword form needs the prefix removed.
      target = uriMatch?.[2] ? trimmed : trimmed.slice(scheme.length + 1);
      break;
    case "mysql":
      engine = "mysql";
      target = uriMatch?.[2] ? trimmed : trimmed.slice(scheme.length + 1);
      break;
    case "sqlite":
    case "sqlite3":
      engine = "sqlite";
      target = trimmed.slice(scheme.length + (uriMatch?.[2] ? 3 : 1));
      break;
    default:
      if (!scheme && looksLikeSqliteFile(trimmed)) engine = "sqlite";
      break;
  }

  if (!engine) {
    throw new Error(
      `Unrecognized --db connection string: "${redactConnectionString(trimmed)}". ` +
        "Use postgres://…, mysql://…, sqlite:<path>, or a path to a .db/.sqlite file."
    );
  }

  if (!target.trim()) {
    throw new Error(`--db is missing a target after "${scheme}:".`);
  }

  return { engine, target: target.trim(), label: redactConnectionString(trimmed) };
}
