import path from "node:path";
import { discoverRelationships } from "../../core/discovery/relationships";
import { buildSemanticModel } from "../../core/discovery/semantic-model";
import { buildTermCatalog } from "../../core/discovery/term-catalog";
import { applyVerdicts } from "../../core/discovery/verdicts";
import { createNodeDb } from "../../engine/duckdb/connection";
import { loadFolder } from "../../engine/duckdb/load";
import { profileTable } from "../../engine/duckdb/profile";
import { EMBED_DIM, EMBED_MODEL, type Embedder } from "../../embed/embedder";
import type { DiscoveryReport } from "../../core/types/discovery";
import { readVerdicts, writeArtifacts, writeTermEmbeddings } from "./artifacts";

export interface InspectOptions {
  /** When set, precompute a term-embeddings cache for hybrid resolution. */
  embedder?: Embedder;
}

/**
 * `querypad inspect <folder>`: load every supported file in the folder, profile it,
 * infer relationships, and write `.datactx/` artifacts. Returns the report.
 */
export async function runInspect(
  folder: string,
  now: number,
  options: InspectOptions = {}
): Promise<DiscoveryReport> {
  const resolved = path.resolve(folder);
  const db = await createNodeDb();
  try {
    console.log(`Inspecting ${resolved} ...`);
    const { tables, skipped } = await loadFolder(resolved, db.runner);

    if (tables.length === 0) {
      console.error(
        "No supported data files found (.parquet, .csv, .tsv, .json, .jsonl, .ndjson)."
      );
      const report: DiscoveryReport = {
        generatedAt: now,
        profiles: [],
        relationships: [],
        semanticModel: { generatedAt: now, entities: [] },
      };
      await writeArtifacts(resolved, report, skipped);
      return report;
    }

    console.log(`Loaded ${tables.length} table(s). Profiling ...`);
    const profiles = [];
    for (const table of tables) {
      profiles.push(await profileTable(table, db.runner, now));
    }

    console.log("Discovering relationships ...");
    const inferred = await discoverRelationships(profiles, db.runner);
    const { relationships, summary: curation } = applyVerdicts(
      inferred,
      await readVerdicts(resolved)
    );
    if (curation.rejected + curation.overridden + curation.added > 0) {
      console.log(
        `Applied verdicts.json: ${curation.rejected} rejected, ` +
          `${curation.overridden} overridden, ${curation.added} added.`
      );
    }
    const semanticModel = buildSemanticModel(
      profiles.map((profile) => profile.tableName),
      relationships,
      now,
      profiles
    );

    const report: DiscoveryReport = { generatedAt: now, profiles, relationships, semanticModel };
    const artifacts = await writeArtifacts(resolved, report, skipped);

    if (options.embedder) {
      console.log("Embedding terms ...");
      const catalog = buildTermCatalog(semanticModel);
      const vectors = await options.embedder(catalog.map((entry) => entry.text));
      await writeTermEmbeddings(resolved, {
        model: EMBED_MODEL,
        dim: EMBED_DIM,
        entries: catalog.map((entry, i) => ({ ...entry, vector: vectors[i] })),
      });
      console.log(`Embedded ${catalog.length} term(s) → term-embeddings.json`);
    }

    console.log("");
    console.log(`Tables:        ${profiles.length}`);
    console.log(`Relationships: ${relationships.length}`);
    for (const rel of relationships) {
      console.log(
        `  ${rel.from.table}.${rel.from.column} ↳ ${rel.to.table}.${rel.to.column}` +
          `  (${rel.confidence}%, ${rel.cardinality})`
      );
    }
    console.log(`Entities:      ${semanticModel.entities.length}`);
    for (const entity of semanticModel.entities) {
      const links = [...entity.hasMany, ...entity.hasOne];
      const detail = links.length > 0 ? `  → ${links.join(", ")}` : "";
      console.log(`  ${entity.name} (${entity.table})${detail}`);
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
