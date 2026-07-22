import type { QueryResult } from "../types";
import { formatValue } from "../utils";

function escapeCsvField(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n") || val.includes("\r")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

export function exportCsv(result: QueryResult): string {
  const header = result.columns.map(escapeCsvField).join(",");
  const rows = result.rows.map((row) =>
    result.columns.map((col) => escapeCsvField(formatValue(row[col]))).join(",")
  );
  return [header, ...rows].join("\r\n") + "\r\n";
}
