import { copyFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dest = join(root, "public", "duckdb");
const src = join(root, "node_modules", "@duckdb", "duckdb-wasm", "dist");

mkdirSync(dest, { recursive: true });

const files = ["duckdb-eh.wasm"];
for (const f of files) {
  const srcPath = join(src, f);
  if (existsSync(srcPath)) {
    copyFileSync(srcPath, join(dest, f));
    console.log(`Copied ${f} → public/duckdb/`);
  } else {
    console.warn(`Warning: ${srcPath} not found`);
  }
}
