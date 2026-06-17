import type { QueryResultRows } from "../lib/duckdb-node/connection";

const DEFAULT_ROW_CAP = 50;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("valueOf" in value) {
      const unwrapped = (value as { valueOf(): unknown }).valueOf();
      if (unwrapped !== value) return formatCell(unwrapped);
    }
    return JSON.stringify(value);
  }
  return String(value);
}

/** Render a query result as a fixed-width text table, capped at `rowCap` rows. */
export function renderTable(result: QueryResultRows, rowCap = DEFAULT_ROW_CAP): string {
  const { columns, rows } = result;
  if (columns.length === 0) return "(no columns)";
  if (rows.length === 0) return "(0 rows)";

  const shown = rows.slice(0, rowCap);
  const cells = shown.map((row) => columns.map((col) => formatCell(row[col])));
  const widths = columns.map((col, i) =>
    Math.max(col.length, ...cells.map((row) => row[i].length))
  );

  const pad = (text: string, width: number) => text.padEnd(width);
  const header = columns.map((col, i) => pad(col, widths[i])).join("  ");
  const divider = widths.map((w) => "-".repeat(w)).join("  ");
  const body = cells.map((row) => row.map((cell, i) => pad(cell, widths[i])).join("  "));

  const lines = [header, divider, ...body];
  const omitted = rows.length - shown.length;
  if (omitted > 0) lines.push(`… ${omitted.toLocaleString()} more row(s) not shown`);
  return lines.join("\n");
}
