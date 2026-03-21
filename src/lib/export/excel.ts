import type { QueryResult } from "@/types";
import * as XLSX from "xlsx";

export function exportExcel(result: QueryResult): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(result.rows, { header: result.columns });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "QueryPad");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}
