import type { QueryResult } from "@/types";

export function exportJson(result: QueryResult): string {
  return JSON.stringify(
    {
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      executionTimeMs: result.executionTimeMs,
    },
    null,
    2
  );
}
