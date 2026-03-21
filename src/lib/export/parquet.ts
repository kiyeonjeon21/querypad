import { getDB, getConnection } from "@/lib/duckdb/instance";

const EXPORT_PATH = "/tmp_querypad_export.parquet";

export async function exportParquet(query: string): Promise<Uint8Array> {
  const db = await getDB();
  const conn = await getConnection();
  await conn.query(`COPY (${query}) TO '${EXPORT_PATH}' (FORMAT PARQUET)`);
  const buffer = await db.copyFileToBuffer(EXPORT_PATH);
  return new Uint8Array(buffer);
}
