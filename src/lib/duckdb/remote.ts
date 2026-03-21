import { loadBufferAsTable } from "./files";
import { fileExtension, sanitizeTableName } from "../utils";
import type { TableInfo } from "@/types";

const SUPPORTED_EXTENSIONS = ["parquet", "csv", "tsv", "json", "jsonl", "ndjson", "xlsx"];

export async function loadRemoteFileAsTable(url: string): Promise<{
  table: TableInfo;
  fileName: string;
  data: Uint8Array;
}> {
  // Extract filename from URL
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split("/").filter(Boolean);
  const fileName = pathParts[pathParts.length - 1] || "remote_data";
  const ext = fileExtension(fileName);

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Unsupported file type: .${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`
    );
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(
      "Failed to fetch URL. This may be due to CORS restrictions. Ensure the server allows cross-origin requests."
    );
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  const tableName = sanitizeTableName(fileName);
  const table = await loadBufferAsTable(tableName, fileName, buffer);

  return { table, fileName, data: new Uint8Array(buffer) };
}
