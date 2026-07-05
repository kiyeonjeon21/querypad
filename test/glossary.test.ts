import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import { runEnrich, type GlossaryAi } from "../src/cli/enrich";
import { loadDoc } from "../src/cli/loaders";
import { mergeGlossary, parseGlossary } from "../src/lib/discovery/glossary";
import type { SemanticModel } from "../src/types/discovery";

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
      measures: [{ name: "users_count", agg: "count" }],
      belongsTo: [],
      hasMany: [],
      hasOne: [],
    },
  ],
};

// ---- Loaders ------------------------------------------------------------------

test("loadDoc reads text formats and normalizes xlsx to csv", async () => {
  const md = await tempFile("g.md", "# Glossary\nMRR = monthly recurring revenue");
  assert.match(await loadDoc(md), /monthly recurring revenue/);

  const csv = await tempFile("g.csv", "term,definition\nplan,subscription tier");
  assert.match(await loadDoc(csv), /subscription tier/);

  const sheet = XLSX.utils.aoa_to_sheet([
    ["term", "definition"],
    ["plan", "subscription tier"],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Terms");
  const dir = await mkdtemp(path.join(tmpdir(), "grain-xlsx-"));
  const xlsxPath = path.join(dir, "g.xlsx");
  XLSX.writeFile(wb, xlsxPath);
  const text = await loadDoc(xlsxPath);
  assert.match(text, /subscription tier/);
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
    folder: "fixtures/data",
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
    await readFile("fixtures/data/.querypad/glossary.json", "utf8")
  ) as { entries: unknown[] };
  assert.ok(Array.isArray(glossary.entries) && glossary.entries.length === 2);
});
