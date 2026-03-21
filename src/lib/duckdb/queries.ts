import { getConnection } from "./instance";
import type { QueryResult } from "@/types";

const MAX_ROWS = 10_000;

export async function executeQuery(sql: string): Promise<QueryResult> {
  const conn = await getConnection();
  const start = performance.now();
  const result = await conn.query(sql);
  const executionTimeMs = Math.round(performance.now() - start);

  const schema = result.schema;
  const columns = schema.fields.map((f) => f.name);
  const allRows = result.toArray();
  const rows = allRows.slice(0, MAX_ROWS).map((row: Record<string, unknown>) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      const val = row[col];
      // Convert BigInt and other non-primitive types to plain values
      if (typeof val === "bigint") {
        obj[col] = Number(val);
      } else if (val !== null && typeof val === "object" && "valueOf" in val) {
        const prim = (val as { valueOf(): unknown }).valueOf();
        obj[col] = typeof prim === "bigint" ? Number(prim) : prim;
      } else {
        obj[col] = val;
      }
    }
    return obj;
  });

  return {
    columns,
    rows,
    rowCount: allRows.length,
    executionTimeMs,
  };
}
