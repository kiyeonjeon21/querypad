import type {
  ColumnInfo,
  ColumnProfile,
  ProfileTopValue,
  TableInfo,
  TableProfile,
} from "../../types";
import type { QueryRunner } from "../discovery/relationships";
import { classifyType, quoteIdent } from "../../core/sql/sql-utils";

function toNumber(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toScalar(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function readSingleRow(
  runner: QueryRunner,
  sql: string
): Promise<Record<string, unknown> | null> {
  const rows = await runner(sql);
  return rows[0] ?? null;
}

async function readTopValues(
  runner: QueryRunner,
  tableName: string,
  columnName: string
): Promise<ProfileTopValue[]> {
  const table = quoteIdent(tableName);
  const column = quoteIdent(columnName);
  const rows = await runner(`
    SELECT CAST(${column} AS VARCHAR) AS value, COUNT(*) AS value_count
    FROM ${table}
    WHERE ${column} IS NOT NULL
    GROUP BY 1
    ORDER BY value_count DESC, value ASC
    LIMIT 5
  `);
  return rows.map((row) => ({
    value: String(toScalar(row.value) ?? ""),
    count: toNumber(row.value_count) ?? 0,
  }));
}

async function profileColumn(
  runner: QueryRunner,
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
    const base = await readSingleRow(
      runner,
      `SELECT COUNT(*) - COUNT(${columnName}) AS null_count, COUNT(DISTINCT ${columnName}) AS distinct_count FROM ${table}`
    );
    nullCount = toNumber(base?.null_count) ?? 0;
    distinctCount = toNumber(base?.distinct_count);
  } catch (err) {
    console.error(`Failed to profile ${tableName}.${column.name}:`, err);
  }

  let min: string | number | null = null;
  let max: string | number | null = null;
  let avg: number | null = null;
  if (kind === "numeric") {
    const stats = await readSingleRow(
      runner,
      `SELECT MIN(${columnName}) AS min_value, MAX(${columnName}) AS max_value, AVG(${columnName}) AS avg_value FROM ${table} WHERE ${columnName} IS NOT NULL`
    );
    min = toScalar(stats?.min_value);
    max = toScalar(stats?.max_value);
    avg = toNumber(stats?.avg_value);
  } else if (kind === "date") {
    const stats = await readSingleRow(
      runner,
      `SELECT MIN(${columnName}) AS min_value, MAX(${columnName}) AS max_value FROM ${table} WHERE ${columnName} IS NOT NULL`
    );
    min = toScalar(stats?.min_value);
    max = toScalar(stats?.max_value);
  }

  let topValues: ProfileTopValue[] = [];
  if (kind === "text" || kind === "boolean" || kind === "other") {
    try {
      topValues = await readTopValues(runner, tableName, column.name);
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

/** Profile a single loaded table using the Node DuckDB runner. */
export async function profileTable(
  table: TableInfo,
  runner: QueryRunner,
  now: number
): Promise<TableProfile> {
  const columns: ColumnProfile[] = [];
  for (const column of table.columns) {
    columns.push(await profileColumn(runner, table.name, table.rowCount, column));
  }
  return {
    tableName: table.name,
    rowCount: table.rowCount,
    columnCount: table.columns.length,
    generatedAt: now,
    columns,
  };
}
