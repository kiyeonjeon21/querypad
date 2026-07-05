import { complete } from "../lib/ai/complete";
import {
  mergeGlossary,
  parseGlossary,
  type AppliedChange,
  type GlossaryEntry,
} from "../lib/discovery/glossary";
import { discoverRelationships } from "../lib/discovery/relationships";
import { buildSemanticModel } from "../lib/discovery/semantic-model";
import { createNodeDb } from "../lib/duckdb-node/connection";
import { loadFolder } from "../lib/duckdb-node/load";
import { profileTable } from "../lib/duckdb-node/profile";
import type { SemanticModel } from "../types/discovery";
import { resolveAiCredentials } from "./ai-env";
import { writeGlossary, writeSemanticModel } from "./artifacts";
import { loadDocs, type LoadedDoc } from "./loaders";

const GLOSSARY_SYSTEM_PROMPT = `You extract a data glossary from business documents.
You are given the real schema (tables and their columns) and one or more glossary documents.
For each business term you find, output an entry that maps it to a REAL table (and column when it
describes a specific field). Use ONLY tables and columns from the provided schema; omit any term
you cannot map. Output ONLY a JSON array, no prose, each item:
{ "term": string, "definition": string, "synonyms": string[], "mapsTo": { "table": string, "column"?: string }, "confidence": number }
confidence is 0..1. Omit "column" for a whole-entity term.`;

/** Injectable extraction surface so the pipeline can be tested without network calls. */
export interface GlossaryAi {
  extract(input: { docs: LoadedDoc[]; schema: string }): Promise<GlossaryEntry[]>;
}

export interface RunEnrichOptions {
  folder: string;
  glossaryPaths: string[];
  apply?: boolean;
  provider?: string;
  ai?: GlossaryAi;
  log?: (line: string) => void;
}

export interface EnrichResult {
  entries: GlossaryEntry[];
  applied: AppliedChange[];
  model: SemanticModel;
}

function realGlossaryAi(provider: string | undefined): GlossaryAi {
  const creds = resolveAiCredentials(provider);
  return {
    extract: async ({ docs, schema }) => {
      const input =
        `Schema:\n${schema}\n\nGlossary documents:\n` +
        docs.map((d) => `--- ${d.path} ---\n${d.text}`).join("\n\n");
      const out = await complete({
        provider: creds.provider,
        apiKey: creds.apiKey,
        system: GLOSSARY_SYSTEM_PROMPT,
        input,
        maxTokens: 2000,
      });
      return parseGlossary(out);
    },
  };
}

export async function runEnrich(options: RunEnrichOptions): Promise<EnrichResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const ai = options.ai ?? realGlossaryAi(options.provider);

  const db = await createNodeDb();
  try {
    const { tables } = await loadFolder(options.folder, db.runner);
    if (tables.length === 0) {
      throw new Error(`No supported data files found in ${options.folder}.`);
    }

    const now = Date.now();
    const profiles = await Promise.all(tables.map((t) => profileTable(t, db.runner, now)));
    const relationships = await discoverRelationships(profiles, db.runner);
    const model = buildSemanticModel(
      tables.map((t) => t.name),
      relationships,
      now,
      profiles
    );

    const schema = profiles
      .map((p) => `${p.tableName}: ${p.columns.map((c) => c.name).join(", ")}`)
      .join("\n");

    const docs = await loadDocs(options.glossaryPaths);
    const entries = await ai.extract({ docs, schema });
    const { model: merged, applied } = mergeGlossary(model, entries);

    await writeGlossary(options.folder, { generatedAt: now, entries, applied });

    log(`Extracted ${entries.length} glossary term(s); ${applied.length} applicable to the model.`);
    for (const change of applied) log(`  ${change.target} · ${change.field}: ${change.value}`);

    if (options.apply && applied.length > 0) {
      await writeSemanticModel(options.folder, merged);
      log("Applied to semantic-model.yaml.");
    } else if (applied.length > 0) {
      log("Re-run with --apply to write these into semantic-model.yaml.");
    }

    return { entries, applied, model: options.apply ? merged : model };
  } finally {
    db.close();
  }
}
