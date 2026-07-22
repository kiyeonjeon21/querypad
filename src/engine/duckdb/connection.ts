import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { QueryRunner } from "../../core/discovery/relationships";

export interface QueryResultRows {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface NodeDb {
  /** Engine-agnostic runner consumed by the discovery + profiling code. */
  runner: QueryRunner;
  /** Like `runner`, but also returns ordered column names (for result display). */
  query: (sql: string) => Promise<QueryResultRows>;
  connection: DuckDBConnection;
  close: () => void;
}

/** Create an in-memory Node DuckDB instance and expose it as a QueryRunner. */
export async function createNodeDb(): Promise<NodeDb> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  const runner: QueryRunner = async (sql) => {
    const reader = await connection.runAndReadAll(sql);
    return reader.getRowObjects() as Record<string, unknown>[];
  };

  const query = async (sql: string): Promise<QueryResultRows> => {
    const reader = await connection.runAndReadAll(sql);
    return {
      columns: reader.columnNames(),
      rows: reader.getRowObjects() as Record<string, unknown>[],
    };
  };

  return {
    runner,
    query,
    connection,
    close: () => connection.closeSync(),
  };
}
