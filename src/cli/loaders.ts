import { readFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";

/** A glossary document normalized to text for LLM extraction. */
export interface LoadedDoc {
  path: string;
  text: string;
}

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".ndjson",
  "",
]);

/** Load one glossary document, normalizing spreadsheets to CSV text. */
export async function loadDoc(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls" || ext === ".ods") {
    const workbook = XLSX.readFile(filePath);
    return workbook.SheetNames.map(
      (name) => `# ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`
    ).join("\n\n");
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return readFile(filePath, "utf8");
  }
  throw new Error(
    `Unsupported glossary file type "${ext || "(none)"}" (${filePath}). ` +
      "Supported: .md, .txt, .csv, .tsv, .json, .xlsx."
  );
}

/** Load several glossary documents in parallel. */
export async function loadDocs(paths: string[]): Promise<LoadedDoc[]> {
  return Promise.all(paths.map(async (p) => ({ path: p, text: await loadDoc(p) })));
}
