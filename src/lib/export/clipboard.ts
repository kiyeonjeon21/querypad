import type { QueryResult } from "@/types";
import { formatValue } from "@/lib/utils";

export async function copyToClipboard(result: QueryResult): Promise<void> {
  const header = result.columns.join("\t");
  const rows = result.rows.map((row) =>
    result.columns.map((col) => formatValue(row[col])).join("\t")
  );
  const tsv = [header, ...rows].join("\n");
  await navigator.clipboard.writeText(tsv);
}
