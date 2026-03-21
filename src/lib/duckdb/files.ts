import { getDB, getConnection } from "./instance";
import { fileExtension, sanitizeTableName } from "../utils";
import type { TableInfo, ColumnInfo } from "@/types";

export async function loadFileAsTable(
  file: File
): Promise<TableInfo> {
  const db = await getDB();
  const conn = await getConnection();
  const ext = fileExtension(file.name);
  const tableName = sanitizeTableName(file.name);
  const buffer = new Uint8Array(await file.arrayBuffer());

  const virtualPath = `/${file.name}`;

  let readFn: string;
  switch (ext) {
    case "xlsx": {
      const { xlsxToCsv } = await import("@/lib/xlsx/parse");
      const csvBuffer = xlsxToCsv(buffer);
      const csvPath = `/${file.name}.csv`;
      await db.registerFileBuffer(csvPath, csvBuffer);
      readFn = `read_csv_auto('${csvPath}')`;
      break;
    }
    default: {
      await db.registerFileBuffer(virtualPath, buffer);
      switch (ext) {
        case "parquet":
          readFn = `read_parquet('${virtualPath}')`;
          break;
        case "csv":
        case "tsv":
          readFn = `read_csv_auto('${virtualPath}')`;
          break;
        case "json":
        case "jsonl":
        case "ndjson":
          readFn = `read_json_auto('${virtualPath}')`;
          break;
        default: {
          // Check plugin file loaders
          const sql = await tryPluginFileLoader(ext, buffer, file.name);
          if (sql) {
            await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
            await conn.query(`CREATE TABLE "${tableName}" AS ${sql}`);
            const columns = await describeTable(tableName);
            const countResult = await conn.query(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
            const rowCount = Number(countResult.toArray()[0]?.cnt ?? 0);
            return { name: tableName, columns, rowCount };
          }
          throw new Error(`Unsupported file type: .${ext}`);
        }
      }
    }
  }

  await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
  await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM ${readFn}`);

  const columns = await describeTable(tableName);
  const countResult = await conn.query(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
  const rowCount = Number(countResult.toArray()[0]?.cnt ?? 0);

  return { name: tableName, columns, rowCount };
}

export async function loadBufferAsTable(
  name: string,
  fileName: string,
  buffer: Uint8Array
): Promise<TableInfo> {
  const db = await getDB();
  const conn = await getConnection();
  const ext = fileExtension(fileName);
  const virtualPath = `/${fileName}`;

  let readFn: string;
  switch (ext) {
    case "xlsx": {
      const { xlsxToCsv } = await import("@/lib/xlsx/parse");
      const csvBuffer = xlsxToCsv(buffer);
      const csvPath = `/${fileName}.csv`;
      await db.registerFileBuffer(csvPath, csvBuffer);
      readFn = `read_csv_auto('${csvPath}')`;
      break;
    }
    default: {
      await db.registerFileBuffer(virtualPath, buffer);
      switch (ext) {
        case "parquet":
          readFn = `read_parquet('${virtualPath}')`;
          break;
        case "csv":
        case "tsv":
          readFn = `read_csv_auto('${virtualPath}')`;
          break;
        case "json":
        case "jsonl":
        case "ndjson":
          readFn = `read_json_auto('${virtualPath}')`;
          break;
        default:
          throw new Error(`Unsupported file type: .${ext}`);
      }
    }
  }

  await conn.query(`DROP TABLE IF EXISTS "${name}"`);
  await conn.query(`CREATE TABLE "${name}" AS SELECT * FROM ${readFn}`);

  const columns = await describeTable(name);
  const countResult = await conn.query(`SELECT COUNT(*) as cnt FROM "${name}"`);
  const rowCount = Number(countResult.toArray()[0]?.cnt ?? 0);

  return { name, columns, rowCount };
}

async function tryPluginFileLoader(
  ext: string,
  buffer: Uint8Array,
  fileName: string
): Promise<string | null> {
  try {
    const { useWorkspaceStore } = await import("@/stores/workspace-store");
    const plugins = useWorkspaceStore.getState().plugins;
    for (const plugin of plugins) {
      for (const extension of plugin.manifest.extensions) {
        if (
          extension.type === "fileLoader" &&
          extension.extensions.includes(ext)
        ) {
          return await extension.load(buffer, fileName);
        }
      }
    }
  } catch {
    // Plugin system not available, ignore
  }
  return null;
}

async function describeTable(tableName: string): Promise<ColumnInfo[]> {
  const conn = await getConnection();
  const result = await conn.query(`DESCRIBE "${tableName}"`);
  const rows = result.toArray();
  return rows.map((row: Record<string, unknown>) => ({
    name: String(row.column_name),
    type: String(row.column_type),
  }));
}
