import { buildAskContext } from "../core/agent/ask-context";
import { mergeGlossary, type GlossaryEntry } from "../core/discovery/glossary";
import { discoverRelationships } from "../core/discovery/relationships";
import { buildSemanticModel } from "../core/discovery/semantic-model";
import { applyVerdicts } from "../core/discovery/verdicts";
import type { QueryRunner } from "../core/discovery/relationships";
import type { TableInfo, TableProfile } from "../core/types";
import type { Relationship, SemanticModel } from "../core/types/discovery";
import { profileTable } from "../engine/duckdb/profile";
import { readArtifacts, readGlossary, readVerdicts } from "./cli/artifacts";
import type { Source } from "./cli/source";

export interface PrepareDatasetOptions {
  /**
   * Glossary entries to apply, overriding `.datactx/glossary.json`. The eval harness
   * uses this to point at a committed glossary, since it deliberately reads no cache.
   */
  glossary?: GlossaryEntry[];
}

/** A loaded, curated, grounded dataset — everything a surface needs to reason. */
export interface PreparedDataset {
  tables: TableInfo[];
  /** Undefined when cached artifacts supplied relationships but not profiles. */
  profiles: TableProfile[] | undefined;
  /** Inferred relationships after user curation (verdicts.json) is applied. */
  relationships: Relationship[];
  model: SemanticModel;
  /** Grounding text: schema + relationships + entities. */
  context: string;
}

/**
 * Load a source and derive everything downstream of it: profiles, curated
 * relationships, the semantic model, and the grounding context.
 *
 * Shared by every surface — `ask`, the MCP server, and the eval harness — so
 * they cannot drift on which relationships or entities the agent is grounded in.
 * Prefers cached `.datactx/` artifacts and always honors the two curation files,
 * `verdicts.json` (which joins are real) and `glossary.json` (what things mean).
 */
export async function prepareDataset(
  source: Source,
  runner: QueryRunner,
  now = Date.now(),
  options: PrepareDatasetOptions = {}
): Promise<PreparedDataset> {
  const { tables } = await source.load(runner);
  if (tables.length === 0) throw new Error(source.emptyMessage);

  const cached = await readArtifacts(source.outDir);
  let profiles = cached.profiles ?? undefined;
  let inferred: Relationship[];
  if (cached.relationships) {
    inferred = cached.relationships;
  } else {
    profiles = profiles ?? (await Promise.all(tables.map((t) => profileTable(t, runner, now))));
    inferred = await discoverRelationships(profiles, runner);
  }

  // Honor user curation (idempotent when the cache was already curated).
  const { relationships } = applyVerdicts(inferred, await readVerdicts(source.outDir));

  // Profiles enrich the model with dimensions/measures; undefined → entities only.
  const derived = buildSemanticModel(
    tables.map((t) => t.name),
    relationships,
    now,
    profiles
  );

  // The second curation layer: business meaning the schema cannot express. Without
  // this, `enrich --apply` wrote descriptions and synonyms that nothing ever read.
  const entries = options.glossary ?? (await readGlossary(source.outDir))?.entries ?? [];
  const model = entries.length > 0 ? mergeGlossary(derived, entries).model : derived;

  return {
    tables,
    profiles,
    relationships,
    model,
    context: buildAskContext({ tables, relationships, semanticModel: model }),
  };
}
