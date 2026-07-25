import { readFile } from "node:fs/promises";
import path from "node:path";
import { compileMetric } from "../core/discovery/compile-metric";
import type { GlossaryEntry } from "../core/discovery/glossary";
import { relationshipKey, type QueryRunner } from "../core/discovery/relationships";
import { buildTermCatalog, formatTarget } from "../core/discovery/term-catalog";
import { resolveTerms } from "../core/discovery/term-search";
import { createNodeDb } from "../engine/duckdb/connection";
import { prepareDataset, type PreparedDataset } from "../adapters/dataset";
import { resolveSource } from "../adapters/cli/source";
import type { CaseResult, EngineCase, SuiteReport } from "./types";

/** Where the committed eval dataset and cases live, relative to the repo root. */
export const EVAL_DATASET = "evals/dataset";
export const ENGINE_CASES = "evals/cases/engine.json";

export async function loadEngineCases(file = ENGINE_CASES): Promise<EngineCase[]> {
  return JSON.parse(await readFile(path.resolve(file), "utf8")) as EngineCase[];
}

export interface EngineSuiteOptions extends EvalDatasetOptions {
  casesFile?: string;
}

/** Which dataset (and optional glossary) a suite run scores. */
export interface EvalDatasetOptions {
  datasetDir?: string;
  /**
   * A committed glossary to apply, e.g. `evals/dataset-hard/glossary.json`. The suites read
   * no `.datactx/` cache, so curation has to be passed in explicitly.
   */
  glossaryFile?: string;
}

/** Read a committed glossary file (the `writeGlossary` doc shape, or a bare entry array). */
export async function loadGlossary(file: string): Promise<GlossaryEntry[]> {
  const parsed = JSON.parse(await readFile(path.resolve(file), "utf8")) as
    | { entries?: GlossaryEntry[] }
    | GlossaryEntry[];
  return Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
}

/**
 * Load the dataset a suite grades. Shared by the engine and agent suites so the two
 * cannot drift on which dataset or curation the engine was grounded in. Cached
 * artifacts are deliberately ignored: the suite grades what the engine derives now.
 */
export async function loadEvalDataset(
  options: EvalDatasetOptions,
  runner: QueryRunner
): Promise<PreparedDataset> {
  const glossary = options.glossaryFile ? await loadGlossary(options.glossaryFile) : undefined;
  return prepareDataset(
    { ...resolveSource({ folder: options.datasetDir ?? EVAL_DATASET }), outDir: "/dev/null" },
    runner,
    Date.now(),
    { glossary }
  );
}

function gradeRelationship(testCase: EngineCase, dataset: PreparedDataset): string {
  const found = dataset.relationships.find((rel) => relationshipKey(rel) === testCase.edge);
  if (testCase.absent) {
    return found ? `edge was inferred at ${found.confidence}% but must be absent` : "";
  }
  if (!found) {
    const near = dataset.relationships
      .map(relationshipKey)
      .filter((key) => key.startsWith(testCase.edge!.split(".")[0]));
    return `edge not inferred${near.length > 0 ? ` (found: ${near.join(", ")})` : ""}`;
  }
  const floor = testCase.minConfidence ?? 0;
  return found.confidence < floor
    ? `confidence ${found.confidence}% below floor ${floor}%`
    : "";
}

function gradeEntity(testCase: EngineCase, dataset: PreparedDataset): string {
  const entity = dataset.model.entities.find((e) => e.name === testCase.entity);
  if (!entity) {
    return `entity not derived (have: ${dataset.model.entities.map((e) => e.name).join(", ")})`;
  }
  const problems: string[] = [];
  if (testCase.table && entity.table !== testCase.table) {
    problems.push(`table ${entity.table}, expected ${testCase.table}`);
  }
  const measures = new Set(entity.measures.map((m) => m.name));
  for (const name of testCase.measures ?? []) {
    if (!measures.has(name)) {
      problems.push(`missing measure ${name} (have: ${[...measures].join(", ") || "none"})`);
    }
  }
  const dimensions = new Set(entity.dimensions.map((d) => d.name));
  for (const name of testCase.dimensions ?? []) {
    if (!dimensions.has(name)) {
      problems.push(`missing dimension ${name} (have: ${[...dimensions].join(", ") || "none"})`);
    }
  }
  return problems.join("; ");
}

function gradeMetric(testCase: EngineCase, dataset: PreparedDataset): string {
  const compiled = compileMetric(dataset.model, dataset.relationships, {
    metric: testCase.metric!.metric,
    dimensions: testCase.metric!.dimensions,
  });
  if (testCase.expectRefusal) {
    return compiled.ok ? `compiled but should have been refused:\n    ${compiled.sql}` : "";
  }
  return compiled.ok ? "" : `refused: ${compiled.error}`;
}

async function gradeTerm(testCase: EngineCase, dataset: PreparedDataset): Promise<string> {
  const catalog = buildTermCatalog(dataset.model);
  const results = await resolveTerms(catalog, testCase.term!);
  if (results.length === 0) return "no match";
  const targets = results.map((r) => formatTarget(r.entry.target));
  return targets.includes(testCase.resolvesTo!)
    ? ""
    : `resolved to ${targets.slice(0, 3).join(", ")}, expected ${testCase.resolvesTo}`;
}

/**
 * Run the deterministic suite: relationship inference, semantic-model
 * derivation, metric compilation (including the refusals that protect against
 * fan-out), and term resolution. Needs no API key, so it runs in CI.
 */
export async function runEngineSuite(
  options: EngineSuiteOptions = {}
): Promise<SuiteReport> {
  const cases = await loadEngineCases(options.casesFile);
  const db = await createNodeDb();
  let dataset: PreparedDataset;
  try {
    dataset = await loadEvalDataset(options, db.runner);

    const results: CaseResult[] = [];
    for (const testCase of cases) {
      let detail: string;
      try {
        switch (testCase.kind) {
          case "relationship":
            detail = gradeRelationship(testCase, dataset);
            break;
          case "entity":
            detail = gradeEntity(testCase, dataset);
            break;
          case "metric":
            detail = gradeMetric(testCase, dataset);
            break;
          case "term":
            detail = await gradeTerm(testCase, dataset);
            break;
          default:
            detail = `unknown case kind "${testCase.kind}"`;
        }
      } catch (err) {
        results.push({
          id: testCase.id,
          outcome: "error",
          detail: err instanceof Error ? err.message : String(err),
          trap: testCase.kind,
        });
        continue;
      }
      results.push({
        id: testCase.id,
        outcome: detail ? "fail" : "pass",
        detail,
        trap: testCase.kind,
      });
    }

    const passed = results.filter((r) => r.outcome === "pass").length;
    const failed = results.filter((r) => r.outcome === "fail").length;
    const errored = results.filter((r) => r.outcome === "error").length;
    return {
      suite: "engine",
      generatedAt: Date.now(),
      dataset: options.datasetDir ?? EVAL_DATASET,
      casesFile: options.casesFile ?? ENGINE_CASES,
      glossary: Boolean(options.glossaryFile),
      total: results.length,
      passed,
      failed,
      errored,
      score: results.length > 0 ? passed / results.length : 0,
      results,
    };
  } finally {
    db.close();
  }
}
