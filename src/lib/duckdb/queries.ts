import { getConnection } from "./instance";
import type { QueryResult } from "@/types";
import { DataType } from "apache-arrow";

const MAX_ROWS = 10_000;

function isDateType(type: DataType): boolean {
  return DataType.isDate(type);
}

function isTimestampType(type: DataType): boolean {
  return DataType.isTimestamp(type);
}

function formatDateValue(val: unknown): string | unknown {
  if (val === null || val === undefined) return val;
  const num = typeof val === "bigint" ? Number(val) : val;
  if (typeof num !== "number") return val;
  return new Date(num).toISOString().split("T")[0];
}

function formatTimestampValue(val: unknown): string | unknown {
  if (val === null || val === undefined) return val;
  const num = typeof val === "bigint" ? Number(val) : val;
  if (typeof num !== "number") return val;
  return new Date(num).toISOString();
}

/**
 * Split SQL text into individual statements, respecting string literals and comments.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    // Single-quoted string literal
    if (ch === "'") {
      current += ch;
      i++;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === "'" && sql[i + 1] !== "'") { i++; break; }
        if (sql[i] === "'" && sql[i + 1] === "'") { current += sql[++i]; } // escaped quote
        i++;
      }
      continue;
    }

    // Double-quoted identifier
    if (ch === '"') {
      current += ch;
      i++;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }

    // Line comment
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") { current += sql[i]; i++; }
      continue;
    }

    // Block comment
    if (ch === "/" && sql[i + 1] === "*") {
      current += "/*";
      i += 2;
      while (i < sql.length) {
        if (sql[i] === "*" && sql[i + 1] === "/") { current += "*/"; i += 2; break; }
        current += sql[i];
        i++;
      }
      continue;
    }

    // Semicolon — statement separator
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);

  return statements;
}

export async function executeQuery(sql: string): Promise<QueryResult> {
  const conn = await getConnection();
  const statements = splitStatements(sql);

  if (statements.length === 0) {
    return { columns: [], columnTypes: [], rows: [], rowCount: 0, executionTimeMs: 0 };
  }

  const start = performance.now();

  // Execute all preceding statements (DDL, INSERT, etc.)
  for (let s = 0; s < statements.length - 1; s++) {
    try {
      await conn.query(statements[s]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Statement ${s + 1}: ${msg}`);
    }
  }

  // Execute last statement and return its result
  let result;
  try {
    result = await conn.query(statements[statements.length - 1]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(statements.length > 1 ? `Statement ${statements.length}: ${msg}` : msg);
  }

  const executionTimeMs = Math.round(performance.now() - start);

  const schema = result.schema;
  const columns = schema.fields.map((f) => f.name);
  const columnTypes = schema.fields.map((f) => String(f.type));

  // Build per-column type flags for fast lookup
  const dateFlags = schema.fields.map((f) => isDateType(f.type));
  const tsFlags = schema.fields.map((f) => isTimestampType(f.type));

  const allRows = result.toArray();
  const rows = allRows.slice(0, MAX_ROWS).map((row: Record<string, unknown>) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      let val = row[col];

      // Extract primitive from Arrow wrapper objects
      if (val !== null && val !== undefined && typeof val === "object" && "valueOf" in val) {
        val = (val as { valueOf(): unknown }).valueOf();
      }
      if (typeof val === "bigint") {
        val = Number(val);
      }

      // Format date/timestamp types as ISO strings
      if (dateFlags[i]) {
        obj[col] = formatDateValue(val);
      } else if (tsFlags[i]) {
        obj[col] = formatTimestampValue(val);
      } else {
        obj[col] = val;
      }
    }
    return obj;
  });

  return {
    columns,
    columnTypes,
    rows,
    rowCount: allRows.length,
    executionTimeMs,
  };
}
