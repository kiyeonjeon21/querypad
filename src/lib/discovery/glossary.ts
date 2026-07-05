import type { SemanticModel } from "../../types/discovery";
import { stripSqlFences } from "./sql-safety";

/**
 * Glossary ingestion: turn extracted business terms into descriptions/synonyms on the
 * semantic model, grounded on the real schema. Pure — no IO. Field names borrow from SKOS
 * (synonyms = altLabel) and carry provenance + confidence for review.
 */

export interface GlossaryEntry {
  term: string;
  definition: string;
  synonyms: string[];
  /** The schema object this term describes. Entity-level when `column` is omitted. */
  mapsTo?: { table: string; column?: string };
  /** 0..1. Entries below the floor are not applied. */
  confidence: number;
  source?: string;
}

export interface AppliedChange {
  target: string;
  field: "description" | "synonyms";
  value: string;
}

/** Minimum confidence for an extracted entry to be applied. */
export const CONFIDENCE_FLOOR = 0.5;

/** Parse an LLM's JSON array of glossary entries into a clean, typed list. */
export function parseGlossary(text: string): GlossaryEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripSqlFences(text));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const entries: GlossaryEntry[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const term = typeof obj.term === "string" ? obj.term.trim() : "";
    if (!term) continue;
    const mapsTo =
      obj.mapsTo && typeof obj.mapsTo === "object"
        ? (() => {
            const m = obj.mapsTo as Record<string, unknown>;
            if (typeof m.table !== "string") return undefined;
            return {
              table: m.table,
              column: typeof m.column === "string" ? m.column : undefined,
            };
          })()
        : undefined;
    entries.push({
      term,
      definition: typeof obj.definition === "string" ? obj.definition.trim() : "",
      synonyms: Array.isArray(obj.synonyms)
        ? obj.synonyms.filter((s): s is string => typeof s === "string")
        : [],
      mapsTo,
      confidence: typeof obj.confidence === "number" ? obj.confidence : CONFIDENCE_FLOOR,
      source: typeof obj.source === "string" ? obj.source : undefined,
    });
  }
  return entries;
}

function cloneModel(model: SemanticModel): SemanticModel {
  return {
    generatedAt: model.generatedAt,
    entities: model.entities.map((e) => ({
      ...e,
      synonyms: [...e.synonyms],
      dimensions: e.dimensions.map((d) => ({ ...d })),
      measures: e.measures.map((m) => ({ ...m })),
      belongsTo: [...e.belongsTo],
      hasMany: [...e.hasMany],
      hasOne: [...e.hasOne],
    })),
  };
}

/**
 * Apply glossary entries to a copy of the model: entity- or dimension-level descriptions and
 * entity synonyms. Entries are dropped when below the confidence floor or when `mapsTo` names
 * a table/column that doesn't exist (schema grounding). Existing descriptions are not overwritten.
 */
export function mergeGlossary(
  model: SemanticModel,
  entries: GlossaryEntry[],
  floor = CONFIDENCE_FLOOR
): { model: SemanticModel; applied: AppliedChange[] } {
  const next = cloneModel(model);
  const byTable = new Map(next.entities.map((e) => [e.table, e]));
  const applied: AppliedChange[] = [];

  for (const entry of entries) {
    if (entry.confidence < floor || !entry.mapsTo) continue;
    const entity = byTable.get(entry.mapsTo.table);
    if (!entity) continue; // unknown table → drop

    if (entry.mapsTo.column) {
      const dim = entity.dimensions.find((d) => d.column === entry.mapsTo!.column);
      if (!dim) continue; // unknown column → drop
      if (entry.definition && !dim.description) {
        dim.description = entry.definition;
        applied.push({
          target: `${entity.table}.${dim.column}`,
          field: "description",
          value: entry.definition,
        });
      }
      continue;
    }

    if (entry.definition && !entity.description) {
      entity.description = entry.definition;
      applied.push({ target: entity.name, field: "description", value: entry.definition });
    }
    const added: string[] = [];
    for (const synonym of entry.synonyms) {
      const clean = synonym.trim();
      if (clean && clean !== entity.name && !entity.synonyms.includes(clean)) {
        entity.synonyms.push(clean);
        added.push(clean);
      }
    }
    if (added.length > 0) {
      applied.push({ target: entity.name, field: "synonyms", value: added.join(", ") });
    }
  }

  return { model: next, applied };
}
