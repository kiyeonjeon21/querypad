import { readFile } from "node:fs/promises";
import path from "node:path";

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

/** Load one glossary document as text. */
export async function loadDoc(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls" || ext === ".ods") {
    throw new Error(
      `Spreadsheet input is not supported (${filePath}). ` +
        "Export the sheet as CSV and pass the .csv file instead."
    );
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return readFile(filePath, "utf8");
  }
  throw new Error(
    `Unsupported glossary file type "${ext || "(none)"}" (${filePath}). ` +
      "Supported: .md, .txt, .csv, .tsv, .json."
  );
}

/** Load several glossary documents in parallel. */
export async function loadDocs(paths: string[]): Promise<LoadedDoc[]> {
  return Promise.all(paths.map(async (p) => ({ path: p, text: await loadDoc(p) })));
}
