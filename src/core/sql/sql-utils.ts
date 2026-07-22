import type { ProfileColumnKind } from "../types";

/** Quote a SQL identifier (table or column name), escaping embedded double quotes. */
export function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/** Bucket a DuckDB column type into a coarse kind used for profiling and discovery. */
export function classifyType(type: string): ProfileColumnKind {
  const normalized = type.toUpperCase();
  if (/(HUGEINT|BIGINT|INTEGER|SMALLINT|TINYINT|DOUBLE|FLOAT|DECIMAL|NUMERIC|REAL|UBIGINT|UINTEGER|USMALLINT|UTINYINT|INT)/.test(normalized)) {
    return "numeric";
  }
  if (/(TIMESTAMP|DATE|TIME|INTERVAL)/.test(normalized)) {
    return "date";
  }
  if (/BOOL/.test(normalized)) {
    return "boolean";
  }
  if (/(CHAR|VARCHAR|TEXT|STRING|UUID|JSON)/.test(normalized)) {
    return "text";
  }
  return "other";
}
