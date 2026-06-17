import path from "node:path";
import { discoverRelationships } from "../lib/discovery/relationships";
import { createNodeDb } from "../lib/duckdb-node/connection";
import { loadFolder } from "../lib/duckdb-node/load";
import { profileTable } from "../lib/duckdb-node/profile";
import type { DiscoveryReport } from "../types/discovery";
import { writeArtifacts } from "./artifacts";

/**
 * `querypad inspect <folder>`: load every supported file in the folder, profile it,
 * infer relationships, and write `.querypad/` artifacts. Returns the report.
 */
export async function runInspect(folder: string, now: number): Promise<DiscoveryReport> {
  const resolved = path.resolve(folder);
  const db = await createNodeDb();
  try {
    console.log(`Inspecting ${resolved} ...`);
    const { tables, skipped } = await loadFolder(resolved, db.runner);

    if (tables.length === 0) {
      console.error(
        "No supported data files found (.parquet, .csv, .tsv, .json, .jsonl, .ndjson)."
      );
      const report: DiscoveryReport = { generatedAt: now, profiles: [], relationships: [] };
      await writeArtifacts(resolved, report, skipped);
      return report;
    }

    console.log(`Loaded ${tables.length} table(s). Profiling ...`);
    const profiles = [];
    for (const table of tables) {
      profiles.push(await profileTable(table, db.runner, now));
    }

    console.log("Discovering relationships ...");
    const relationships = await discoverRelationships(profiles, db.runner);

    const report: DiscoveryReport = { generatedAt: now, profiles, relationships };
    const artifacts = await writeArtifacts(resolved, report, skipped);

    console.log("");
    console.log(`Tables:        ${profiles.length}`);
    console.log(`Relationships: ${relationships.length}`);
    for (const rel of relationships) {
      console.log(
        `  ${rel.from.table}.${rel.from.column} ↳ ${rel.to.table}.${rel.to.column}` +
          `  (${rel.confidence}%, ${rel.cardinality})`
      );
    }
    if (skipped.length > 0) {
      console.log(`Skipped:       ${skipped.length} unsupported file(s)`);
    }
    console.log("");
    console.log(`Wrote artifacts to ${artifacts.dir}`);

    return report;
  } finally {
    db.close();
  }
}
