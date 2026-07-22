import type { QueryResult } from "@/types";
import { formatValue } from "../utils";

function escapeMd(val: string): string {
  return val.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function exportMarkdown(result: QueryResult): string {
  const header = "| " + result.columns.map(escapeMd).join(" | ") + " |";
  const separator = "| " + result.columns.map(() => "---").join(" | ") + " |";
  const rows = result.rows.map(
    (row) =>
      "| " +
      result.columns.map((col) => escapeMd(formatValue(row[col]))).join(" | ") +
      " |"
  );
  return [header, separator, ...rows].join("\n") + "\n";
}
