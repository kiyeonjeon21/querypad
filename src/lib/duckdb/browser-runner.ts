import type { QueryRunner } from "@/lib/discovery/relationships";
import { getConnection } from "./instance";

/**
 * A browser `QueryRunner` backed by DuckDB-Wasm — lets the engine-agnostic discovery
 * core (`discoverRelationships`) run in the browser, mirroring the Node CLI's runner.
 */
export function createBrowserQueryRunner(): QueryRunner {
  return async (sql: string) => {
    const conn = await getConnection();
    const result = await conn.query(sql);
    return result.toArray() as Record<string, unknown>[];
  };
}
