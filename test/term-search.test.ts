import assert from "node:assert/strict";
import test from "node:test";
import { buildTermCatalog, formatTarget } from "../src/core/discovery/term-catalog";
import { lexicalScore, resolveTerms } from "../src/core/discovery/term-search";
import type { SemanticModel } from "../src/core/types/discovery";

const MODEL: SemanticModel = {
  generatedAt: 1,
  entities: [
    {
      name: "User",
      table: "users",
      synonyms: ["users", "customer"],
      dimensions: [{ name: "plan", column: "plan", kind: "categorical", values: ["free", "paid"] }],
      measures: [{ name: "users_count", agg: "count" }],
      belongsTo: [],
      hasMany: ["Payment"],
      hasOne: [],
    },
    {
      name: "Payment",
      table: "payments",
      synonyms: ["payments"],
      dimensions: [],
      measures: [{ name: "sum_amount", agg: "sum", column: "amount" }],
      belongsTo: ["User"],
      hasMany: [],
      hasOne: [],
    },
  ],
};

test("buildTermCatalog flattens entities, synonyms, dimensions, measures", () => {
  const catalog = buildTermCatalog(MODEL);
  const terms = catalog.map((e) => `${e.kind}:${e.term}`);
  assert.ok(terms.includes("entity:User"));
  assert.ok(terms.includes("synonym:customer"));
  assert.ok(terms.includes("dimension:plan"));
  assert.ok(terms.includes("measure:sum_amount"));

  const plan = catalog.find((e) => e.term === "plan")!;
  assert.equal(formatTarget(plan.target), "users.plan");
  const sum = catalog.find((e) => e.term === "sum_amount")!;
  assert.equal(formatTarget(sum.target), "sum_amount");
});

test("lexicalScore is 1 on exact match and rewards token overlap", () => {
  assert.equal(lexicalScore("plan", "plan"), 1);
  assert.equal(lexicalScore("USERS", "users"), 1);
  assert.ok(lexicalScore("sum amount", "sum_amount") > 0);
  assert.equal(lexicalScore("zzz", "plan"), 0);
});

test("resolveTerms (lexical only) maps a synonym to its entity", () => {
  const catalog = buildTermCatalog(MODEL);
  // "customers" → singularizes to "customer", the User synonym.
  const [top] = resolveTerms(catalog, "customers");
  assert.equal(top.entry.target.entity, "User");
});

test("resolveTerms fuses vectors so a semantic hit outranks lexical", () => {
  const catalog = buildTermCatalog(MODEL);
  const sumIndex = catalog.findIndex((e) => e.term === "sum_amount");
  // "revenue" shares no tokens with any term; steer it via vectors toward sum_amount.
  const entryVectors = catalog.map((_, i) => (i === sumIndex ? [1, 0] : [0, 1]));
  const queryVector = [1, 0];
  const [top] = resolveTerms(catalog, "revenue", { queryVector, entryVectors });
  assert.equal(top.entry.term, "sum_amount");
});
