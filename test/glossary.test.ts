import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runEnrich, type GlossaryAi } from "../src/adapters/cli/enrich";
import { loadDoc } from "../src/adapters/cli/loaders";
import { resolveSource } from "../src/adapters/cli/source";
import { mergeGlossary, parseGlossary } from "../src/core/discovery/glossary";
import type { SemanticModel } from "../src/core/types/discovery";

async function tempFile(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "grain-glossary-"));
  const filePath = path.join(dir, name);
  await writeFile(filePath, content);
  return filePath;
}

const MODEL: SemanticModel = {
  generatedAt: 1,
  entities: [
    {
      name: "User",
      table: "users",
      synonyms: ["users"],
      dimensions: [{ name: "plan", column: "plan", kind: "categorical" }],
      measures: [
        { name: "users_count", agg: "count" },
        { name: "sum_amt_c", agg: "sum", column: "amt_c" },
      ],
      belongsTo: [],
      hasMany: [],
      hasOne: [],
    },
  ],
};

// ---- Loaders ------------------------------------------------------------------

test("loadDoc reads text formats", async () => {
  const md = await tempFile("g.md", "# Glossary\nMRR = monthly recurring revenue");
  assert.match(await loadDoc(md), /monthly recurring revenue/);

  const csv = await tempFile("g.csv", "term,definition\nplan,subscription tier");
  assert.match(await loadDoc(csv), /subscription tier/);
});

test("loadDoc rejects spreadsheets with a CSV hint", async () => {
  const xlsx = await tempFile("g.xlsx", "not-a-real-workbook");
  await assert.rejects(loadDoc(xlsx), /Export the sheet as CSV/);
});

test("loadDoc rejects unsupported types", async () => {
  const bin = await tempFile("g.png", "x");
  await assert.rejects(loadDoc(bin), /Unsupported/);
});

// ---- parseGlossary ------------------------------------------------------------

test("parseGlossary parses a fenced JSON array and coerces defaults", () => {
  const raw =
    '```json\n[{"term":"MRR","definition":"d","mapsTo":{"table":"users","column":"plan"}},' +
    '{"nope":1},"bad"]\n```';
  const entries = parseGlossary(raw);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].term, "MRR");
  assert.deepEqual(entries[0].synonyms, []);
  assert.equal(entries[0].confidence, 0.5);
  assert.deepEqual(entries[0].mapsTo, { table: "users", column: "plan" });
});

test("parseGlossary returns [] on non-JSON", () => {
  assert.deepEqual(parseGlossary("sorry, no JSON here"), []);
});

// ---- mergeGlossary ------------------------------------------------------------

test("mergeGlossary applies descriptions + synonyms and grounds on the schema", () => {
  const { model, applied } = mergeGlossary(MODEL, [
    { term: "tier", definition: "The plan.", synonyms: [], mapsTo: { table: "users", column: "plan" }, confidence: 0.9 },
    { term: "account", definition: "A user.", synonyms: ["member", "customer"], mapsTo: { table: "users" }, confidence: 0.9 },
    { term: "ghost", definition: "x", synonyms: [], mapsTo: { table: "nope" }, confidence: 0.9 }, // dropped: unknown table
    { term: "col", definition: "y", synonyms: [], mapsTo: { table: "users", column: "unknown" }, confidence: 0.9 }, // dropped: unknown column
    { term: "weak", definition: "z", synonyms: [], mapsTo: { table: "users" }, confidence: 0.2 }, // dropped: low confidence
  ]);

  const user = model.entities[0];
  assert.equal(user.description, "A user.");
  assert.ok(user.synonyms.includes("member") && user.synonyms.includes("customer"));
  assert.equal(user.dimensions[0].description, "The plan.");
  // The original model is untouched (pure).
  assert.equal(MODEL.entities[0].description, undefined);
  assert.ok(applied.some((c) => c.target === "users.plan"));
});

test("mergeGlossary does not overwrite an existing description", () => {
  const seeded: SemanticModel = {
    ...MODEL,
    entities: [{ ...MODEL.entities[0], description: "Original." }],
  };
  const { model } = mergeGlossary(seeded, [
    { term: "u", definition: "New.", synonyms: [], mapsTo: { table: "users" }, confidence: 1 },
  ]);
  assert.equal(model.entities[0].description, "Original.");
});

// ---- runEnrich pipeline (stub extractor, real DuckDB model) --------------------

test("runEnrich builds the model, applies extracted terms, and writes glossary.json", async () => {
  const doc = await tempFile("glossary.md", "plan = the subscription tier a user is on");
  const stub: GlossaryAi = {
    extract: async () => [
      { term: "subscription tier", definition: "The plan a user is on.", synonyms: [], mapsTo: { table: "users", column: "plan" }, confidence: 0.9 },
      { term: "account", definition: "A registered user.", synonyms: ["member"], mapsTo: { table: "users" }, confidence: 0.9 },
    ],
  };

  const result = await runEnrich({
    source: resolveSource({ folder: "fixtures/data" }),
    glossaryPaths: [doc],
    apply: true,
    ai: stub,
    log: () => {},
  });

  const user = result.model.entities.find((e) => e.name === "User")!;
  assert.equal(user.description, "A registered user.");
  assert.ok(user.synonyms.includes("member"));
  assert.equal(user.dimensions.find((d) => d.column === "plan")!.description, "The plan a user is on.");
  assert.ok(result.applied.length >= 2);

  // glossary.json was written (readTermEmbeddings shares the dir; just check the file exists).
  const { readFile } = await import("node:fs/promises");
  const glossary = JSON.parse(
    await readFile("fixtures/data/.datactx/glossary.json", "utf8")
  ) as { entries: unknown[] };
  assert.ok(Array.isArray(glossary.entries) && glossary.entries.length === 2);
});

// ---- glossary reaches term resolution -----------------------------------------

test("mergeGlossary annotates a measure, so money terms are no longer dropped", () => {
  // `amt_c` is numeric, so it becomes a measure and never a dimension. Before this
  // path existed, every glossary entry naming a money column was silently discarded.
  const { model, applied } = mergeGlossary(MODEL, [
    {
      term: "revenue",
      definition: "Money billed to customers.",
      synonyms: ["net revenue", "billings"],
      mapsTo: { table: "users", column: "amt_c" },
      confidence: 0.9,
    },
  ]);

  const measure = model.entities[0].measures.find((m) => m.column === "amt_c");
  assert.equal(measure?.description, "Money billed to customers.");
  assert.deepEqual(measure?.synonyms, ["net revenue", "billings"]);
  assert.ok(applied.some((c) => c.target === "users.amt_c" && c.field === "synonyms"));
  // Purity: the shared fixture is not mutated.
  assert.equal(MODEL.entities[0].measures[1].synonyms, undefined);
});

test("mergeGlossary adds dimension synonyms and skips its own column name", () => {
  const { model } = mergeGlossary(MODEL, [
    {
      term: "tier",
      definition: "The subscription tier.",
      synonyms: ["tier", "plan", " "],
      mapsTo: { table: "users", column: "plan" },
      confidence: 0.9,
    },
  ]);
  // "plan" is the column's own name and " " is blank; only "tier" is a new surface term.
  assert.deepEqual(model.entities[0].dimensions[0].synonyms, ["tier"]);
});

test("a business word resolves to an opaque measure only once the glossary is applied", async () => {
  const { buildTermCatalog, formatTarget } = await import("../src/core/discovery/term-catalog");
  const { resolveTerms } = await import("../src/core/discovery/term-search");

  const bare = await resolveTerms(buildTermCatalog(MODEL), "net revenue");
  assert.equal(bare.length, 0, "sum_amt_c shares no token with 'net revenue'");

  const { model } = mergeGlossary(MODEL, [
    {
      term: "revenue",
      definition: "Money billed.",
      synonyms: ["net revenue"],
      mapsTo: { table: "users", column: "amt_c" },
      confidence: 0.9,
    },
  ]);
  const hits = await resolveTerms(buildTermCatalog(model), "net revenue");
  assert.ok(hits.length > 0, "the glossary synonym must be searchable");
  assert.equal(formatTarget(hits[0].entry.target), "sum_amt_c");
});

test("the grounding context surfaces glossary descriptions and synonyms", async () => {
  const { buildAskContext } = await import("../src/core/agent/ask-context");

  const plain = buildAskContext({ tables: [], relationships: [], semanticModel: MODEL });
  assert.doesNotMatch(plain, /Money billed/);

  const { model } = mergeGlossary(MODEL, [
    { term: "account", definition: "A paying customer.", synonyms: ["account"], mapsTo: { table: "users" }, confidence: 1 },
    {
      term: "revenue",
      definition: "Money billed.",
      synonyms: ["net revenue"],
      mapsTo: { table: "users", column: "amt_c" },
      confidence: 1,
    },
  ]);
  const enriched = buildAskContext({ tables: [], relationships: [], semanticModel: model });
  assert.match(enriched, /A paying customer\./);
  assert.match(enriched, /also called: users, account/);
  assert.match(enriched, /aka net revenue - Money billed\./);
});

test("prepareDataset applies glossary.json as curation, like verdicts.json", async () => {
  const { createNodeDb } = await import("../src/engine/duckdb/connection");
  const { prepareDataset } = await import("../src/adapters/dataset");
  const { writeGlossary } = await import("../src/adapters/cli/artifacts");

  // A real folder source so the model is derived from actual profiles.
  const dir = await mkdtemp(path.join(tmpdir(), "querypad-prep-"));
  await writeFile(
    path.join(dir, "sales.csv"),
    "id,region,amount\n1,west,10.5\n2,east,20.25\n3,west,5.0\n4,east,1.75\n"
  );
  const entries = [
    {
      term: "revenue",
      definition: "Money billed.",
      synonyms: ["net revenue"],
      mapsTo: { table: "sales", column: "amount" },
      confidence: 0.9,
    },
  ];
  await writeGlossary(dir, { generatedAt: 1, entries, applied: [] });

  const db = await createNodeDb();
  try {
    const source = resolveSource({ folder: dir });
    const curated = await prepareDataset(source, db.runner);
    const measure = curated.model.entities[0].measures.find((m) => m.column === "amount");
    assert.deepEqual(measure?.synonyms, ["net revenue"], "glossary.json must be honored");
    assert.match(curated.context, /aka net revenue/);

    // outDir elsewhere (what the eval harness does) means no curation is picked up,
    // and the explicit override is the way back in.
    const noCache = { ...source, outDir: "/dev/null" };
    const bare = await prepareDataset(noCache, db.runner);
    assert.equal(
      bare.model.entities[0].measures.find((m) => m.column === "amount")?.synonyms,
      undefined
    );
    const injected = await prepareDataset(noCache, db.runner, Date.now(), { glossary: entries });
    assert.deepEqual(
      injected.model.entities[0].measures.find((m) => m.column === "amount")?.synonyms,
      ["net revenue"]
    );
  } finally {
    db.close();
  }
});
