import type {
  ColumnInfo,
  ColumnProfile,
  ProfileTopValue,
  TableInfo,
  TableProfile,
} from "@/types";
import { getConnection } from "./instance";
import { classifyType, quoteIdent } from "./sql-utils";

function unwrapDuckValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "valueOf" in value) {
    const unwrapped = (value as { valueOf(): unknown }).valueOf();
    if (unwrapped !== value) return unwrapDuckValue(unwrapped);
  }
  return value;
}

function toNumber(value: unknown): number | null {
  const unwrapped = unwrapDuckValue(value);
  if (typeof unwrapped === "number" && Number.isFinite(unwrapped)) return unwrapped;
  if (typeof unwrapped === "string" && unwrapped.trim() !== "") {
    const parsed = Number(unwrapped);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toProfileScalar(value: unknown): string | number | null {
  const unwrapped = unwrapDuckValue(value);
  if (unwrapped === null || unwrapped === undefined) return null;
  if (typeof unwrapped === "number") return Number.isFinite(unwrapped) ? unwrapped : String(unwrapped);
  if (typeof unwrapped === "string") return unwrapped;
  if (typeof unwrapped === "boolean") return String(unwrapped);
  return String(unwrapped);
}

async function readSingleRow(sql: string): Promise<Record<string, unknown> | null> {
  const conn = await getConnection();
  const result = await conn.query(sql);
  return (result.toArray()[0] as Record<string, unknown> | undefined) ?? null;
}

async function readTopValues(tableName: string, columnName: string): Promise<ProfileTopValue[]> {
  const table = quoteIdent(tableName);
  const column = quoteIdent(columnName);
  const conn = await getConnection();
  const result = await conn.query(`
    SELECT CAST(${column} AS VARCHAR) AS value, COUNT(*) AS value_count
    FROM ${table}
    WHERE ${column} IS NOT NULL
    GROUP BY 1
    ORDER BY value_count DESC, value ASC
    LIMIT 5
  `);

  return result.toArray().map((row) => ({
    value: String(toProfileScalar((row as Record<string, unknown>).value) ?? ""),
    count: toNumber((row as Record<string, unknown>).value_count) ?? 0,
  }));
}

async function profileColumn(
  tableName: string,
  rowCount: number,
  column: ColumnInfo
): Promise<ColumnProfile> {
  const table = quoteIdent(tableName);
  const columnName = quoteIdent(column.name);
  const kind = classifyType(column.type);

  let nullCount = 0;
  let distinctCount: number | null = null;
  try {
    const base = await readSingleRow(`
      SELECT
        COUNT(*) - COUNT(${columnName}) AS null_count,
        COUNT(DISTINCT ${columnName}) AS distinct_count
      FROM ${table}
    `);
    nullCount = toNumber(base?.null_count) ?? 0;
    distinctCount = toNumber(base?.distinct_count);
  } catch (err) {
    console.error(`Failed to profile ${tableName}.${column.name}:`, err);
  }

  let min: string | number | null = null;
  let max: string | number | null = null;
  let avg: number | null = null;
  if (kind === "numeric") {
    const stats = await readSingleRow(`
      SELECT
        MIN(${columnName}) AS min_value,
        MAX(${columnName}) AS max_value,
        AVG(${columnName}) AS avg_value
      FROM ${table}
      WHERE ${columnName} IS NOT NULL
    `);
    min = toProfileScalar(stats?.min_value);
    max = toProfileScalar(stats?.max_value);
    avg = toNumber(stats?.avg_value);
  } else if (kind === "date") {
    const stats = await readSingleRow(`
      SELECT
        MIN(${columnName}) AS min_value,
        MAX(${columnName}) AS max_value
      FROM ${table}
      WHERE ${columnName} IS NOT NULL
    `);
    min = toProfileScalar(stats?.min_value);
    max = toProfileScalar(stats?.max_value);
  }

  let topValues: ProfileTopValue[] = [];
  if (kind === "text" || kind === "boolean" || kind === "other") {
    try {
      topValues = await readTopValues(tableName, column.name);
    } catch (err) {
      console.error(`Failed to read top values for ${tableName}.${column.name}:`, err);
    }
  }

  return {
    name: column.name,
    type: column.type,
    kind,
    nullCount,
    nullPercent: rowCount === 0 ? 0 : (nullCount / rowCount) * 100,
    distinctCount,
    min,
    max,
    avg,
    topValues,
  };
}

export async function profileTable(table: TableInfo): Promise<TableProfile> {
  const columns: ColumnProfile[] = [];
  for (const column of table.columns) {
    columns.push(await profileColumn(table.name, table.rowCount, column));
  }

  return {
    tableName: table.name,
    rowCount: table.rowCount,
    columnCount: table.columns.length,
    generatedAt: Date.now(),
    columns,
  };
}
