import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppliedChange, GlossaryEntry } from "../../core/discovery/glossary";
import type { OkfFile } from "../../core/discovery/okf-export";
import { renderSemanticYaml } from "../../core/discovery/semantic-model";
import type { TermEntry } from "../../core/discovery/term-catalog";
import type { TableProfile } from "../../core/types";
import type { DiscoveryReport, Relationship, SemanticModel } from "../../core/types/discovery";

const ARTIFACT_DIR = ".querypad";
const TERM_EMBEDDINGS_FILE = "term-embeddings.json";
const GLOSSARY_FILE = "glossary.json";
const SEMANTIC_MODEL_FILE = "semantic-model.yaml";
const SEMANTIC_MODEL_JSON = "semantic-model.json";
const OKF_DIR = "okf";

export interface CachedArtifacts {
  relationships: Relationship[] | null;
  profiles: TableProfile[] | null;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Read previously written `.querypad/` artifacts for context reuse (null when absent). */
export async function readArtifacts(folder: string): Promise<CachedArtifacts> {
  const dir = path.resolve(folder, ARTIFACT_DIR);
  const relDoc = await readJson<{ relationships: Relationship[] }>(
    path.join(dir, "relationships.json")
  );
  const schemaDoc = await readJson<{ tables: TableProfile[] }>(path.join(dir, "schema.json"));
  return {
    relationships: relDoc?.relationships ?? null,
    profiles: schemaDoc?.tables ?? null,
  };
}

/** A precomputed term index: the catalog with a vector per entry. */
export interface TermEmbeddings {
  model: string;
  dim: number;
  entries: Array<TermEntry & { vector: number[] }>;
}

/** Write the term-embeddings cache used for hybrid term resolution. */
export async function writeTermEmbeddings(folder: string, data: TermEmbeddings): Promise<string> {
  const dir = path.resolve(folder, ARTIFACT_DIR);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, TERM_EMBEDDINGS_FILE);
  await writeFile(filePath, JSON.stringify(data));
  return filePath;
}

/** Read the term-embeddings cache (null when absent). */
export async function readTermEmbeddings(folder: string): Promise<TermEmbeddings | null> {
  const dir = path.resolve(folder, ARTIFACT_DIR);
  return readJson<TermEmbeddings>(path.join(dir, TERM_EMBEDDINGS_FILE));
}

/** Write the extracted glossary + applied-change summary. */
export async function writeGlossary(
  folder: string,
  data: { generatedAt: number; entries: GlossaryEntry[]; applied: AppliedChange[] }
): Promise<string> {
  const dir = path.resolve(folder, ARTIFACT_DIR);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, GLOSSARY_FILE);
  await writeFile(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

/** Rewrite `semantic-model.yaml` + `.json` from a (possibly enriched) model. */
export async function writeSemanticModel(folder: string, model: SemanticModel): Promise<string> {
  const dir = path.resolve(folder, ARTIFACT_DIR);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, SEMANTIC_MODEL_FILE);
  await writeFile(filePath, renderSemanticYaml(model));
  await writeFile(path.join(dir, SEMANTIC_MODEL_JSON), JSON.stringify(model, null, 2));
  return filePath;
}

/** Read the persisted semantic model (null when absent). */
export async function readSemanticModel(folder: string): Promise<SemanticModel | null> {
  const dir = path.resolve(folder, ARTIFACT_DIR);
  return readJson<SemanticModel>(path.join(dir, SEMANTIC_MODEL_JSON));
}

/** Write an OKF bundle (Markdown+frontmatter files) under `.querypad/okf/`. */
export async function writeOkfBundle(folder: string, files: OkfFile[]): Promise<string> {
  const dir = path.resolve(folder, ARTIFACT_DIR, OKF_DIR);
  await mkdir(dir, { recursive: true });
  for (const file of files) await writeFile(path.join(dir, file.path), file.content);
  return dir;
}

export interface WrittenArtifacts {
  dir: string;
  schemaPath: string;
  relationshipsPath: string;
  semanticModelPath: string;
  summaryPath: string;
}

/** Write schema.json, relationships.json, semantic-model.yaml and inspect-summary.md. */
export async function writeArtifacts(
  folder: string,
  report: DiscoveryReport,
  skipped: string[]
): Promise<WrittenArtifacts> {
  const dir = path.resolve(folder, ARTIFACT_DIR);
  await mkdir(dir, { recursive: true });

  const schemaPath = path.join(dir, "schema.json");
  const relationshipsPath = path.join(dir, "relationships.json");
  const semanticModelPath = path.join(dir, "semantic-model.yaml");
  const summaryPath = path.join(dir, "inspect-summary.md");

  await writeFile(
    schemaPath,
    JSON.stringify({ generatedAt: report.generatedAt, tables: report.profiles }, null, 2)
  );
  await writeFile(
    relationshipsPath,
    JSON.stringify(
      { generatedAt: report.generatedAt, relationships: report.relationships },
      null,
      2
    )
  );
  await writeFile(semanticModelPath, renderSemanticYaml(report.semanticModel));
  await writeFile(
    path.join(dir, SEMANTIC_MODEL_JSON),
    JSON.stringify(report.semanticModel, null, 2)
  );
  await writeFile(summaryPath, buildSummary(report, skipped));

  return { dir, schemaPath, relationshipsPath, semanticModelPath, summaryPath };
}

/** Human- and agent-readable markdown overview of the inspection. */
export function buildSummary(report: DiscoveryReport, skipped: string[]): string {
  const lines: string[] = ["# QueryPad Inspection", ""];
  lines.push(`Generated: ${new Date(report.generatedAt).toISOString()}`, "");

  lines.push(`## Tables (${report.profiles.length})`, "");
  for (const table of report.profiles) {
    lines.push(
      `### ${table.tableName}`,
      `Rows: ${table.rowCount.toLocaleString()} · Columns: ${table.columnCount}`,
      "",
      "| Column | Type | Null | Distinct |",
      "| --- | --- | --- | --- |"
    );
    for (const column of table.columns) {
      const nullPercent = `${column.nullPercent.toFixed(column.nullPercent >= 10 ? 0 : 1)}%`;
      lines.push(
        `| ${column.name} | ${column.type} | ${nullPercent} | ${column.distinctCount?.toLocaleString() ?? "n/a"} |`
      );
    }
    lines.push("");
  }

  lines.push(`## Relationships (${report.relationships.length})`, "");
  if (report.relationships.length === 0) {
    lines.push("No relationships inferred above the confidence threshold.", "");
  } else {
    lines.push("| Foreign | References | Confidence | Cardinality | Overlap |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const rel of report.relationships) {
      const from = `${rel.from.table}.${rel.from.column}`;
      const to = `${rel.to.table}.${rel.to.column}`;
      const overlap = `${Math.round(rel.signals.valueOverlap * 100)}%`;
      lines.push(`| ${from} | ${to} | ${rel.confidence}% | ${rel.cardinality} | ${overlap} |`);
    }
    lines.push("");
  }

  const entities = report.semanticModel.entities;
  lines.push(`## Entities (${entities.length})`, "");
  if (entities.length === 0) {
    lines.push("No entities derived.", "");
  } else {
    for (const entity of entities) {
      const assoc = [
        entity.belongsTo.length > 0 ? `belongs_to: ${entity.belongsTo.join(", ")}` : null,
        entity.hasMany.length > 0 ? `has_many: ${entity.hasMany.join(", ")}` : null,
        entity.hasOne.length > 0 ? `has_one: ${entity.hasOne.join(", ")}` : null,
      ].filter(Boolean);
      const detail = assoc.length > 0 ? ` — ${assoc.join("; ")}` : "";
      lines.push(`- ${entity.name} (${entity.table})${detail}`);
    }
    lines.push("");
  }

  if (skipped.length > 0) {
    lines.push(`## Skipped files (${skipped.length})`, "");
    lines.push(skipped.map((name) => `- ${name} (unsupported type)`).join("\n"), "");
  }

  lines.push(
    "## Next steps",
    "",
    "- Review inferred relationships and entities, and adjust as needed.",
    "- Feed `.querypad/schema.json`, `relationships.json`, and `semantic-model.yaml` to an AI agent to reason about the dataset.",
    ""
  );

  return lines.join("\n");
}
