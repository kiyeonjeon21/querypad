import assert from "node:assert/strict";
import test from "node:test";
import { compileMetric } from "../src/lib/discovery/compile-metric";
import type { Relationship, SemanticModel } from "../src/types/discovery";

const MODEL: SemanticModel = {
  generatedAt: 1,
  entities: [
    {
      name: "User",
      table: "users",
      synonyms: [],
      dimensions: [{ name: "plan", column: "plan", kind: "categorical", values: ["free", "paid"] }],
      measures: [{ name: "users_count", agg: "count" }],
      belongsTo: [],
      hasMany: ["Payment"],
      hasOne: [],
    },
    {
      name: "Payment",
      table: "payments",
      synonyms: [],
      dimensions: [{ name: "method", column: "method", kind: "categorical" }],
      measures: [
        { name: "payments_count", agg: "count" },
        { name: "sum_amount", agg: "sum", column: "amount" },
      ],
      belongsTo: ["User"],
      hasMany: [],
      hasOne: [],
    },
  ],
};

const RELS: Relationship[] = [
  {
    from: { table: "payments", column: "user_id" },
    to: { table: "users", column: "id" },
    confidence: 100,
    cardinality: "many-to-one",
    signals: { valueOverlap: 1, nameSimilarity: 1, typeMatch: 1, cardinalityShape: 1 },
  },
];

test("compiles a bare aggregate metric", () => {
  const r = compileMetric(MODEL, RELS, { metric: "sum_amount" });
  if (!r.ok) return assert.fail(r.error);
  assert.equal(r.sql, 'SELECT SUM("payments"."amount") AS "sum_amount" FROM "payments"');
});

test("groups by a dimension on a many-to-one parent (guarded join)", () => {
  const r = compileMetric(MODEL, RELS, { metric: "sum_amount", dimensions: ["plan"] });
  if (!r.ok) return assert.fail(r.error);
  assert.match(r.sql, /JOIN "users" ON "payments"\."user_id" = "users"\."id"/);
  assert.match(r.sql, /"users"\."plan" AS "plan"/);
  assert.match(r.sql, /GROUP BY "users"\."plan"/);
});

test("refuses a grouping that would fan out the measure", () => {
  const r = compileMetric(MODEL, RELS, { metric: "users_count", dimensions: ["method"] });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /fan out/i);
});

test("rejects an unknown metric", () => {
  const r = compileMetric(MODEL, RELS, { metric: "nope" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Unknown metric/);
});

test("applies a filter as a WHERE clause with a guarded join", () => {
  const r = compileMetric(MODEL, RELS, {
    metric: "sum_amount",
    filters: [{ column: "plan", op: "=", value: "paid" }],
  });
  if (!r.ok) return assert.fail(r.error);
  assert.match(r.sql, /JOIN "users"/);
  assert.match(r.sql, /WHERE "users"\."plan" = 'paid'/);
});

test("resolves a numeric filter on a measure column", () => {
  const r = compileMetric(MODEL, RELS, {
    metric: "payments_count",
    filters: [{ column: "amount", op: ">", value: 100 }],
  });
  if (!r.ok) return assert.fail(r.error);
  assert.match(r.sql, /WHERE "payments"\."amount" > 100/);
});

test("escapes string filter values", () => {
  const r = compileMetric(MODEL, RELS, {
    metric: "payments_count",
    filters: [{ column: "method", op: "=", value: "o'brien" }],
  });
  if (!r.ok) return assert.fail(r.error);
  assert.match(r.sql, /= 'o''brien'/);
});
