import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSemanticModel,
  entityName,
  renderSemanticYaml,
} from "../src/core/discovery/semantic-model";
import { buildAskContext } from "../src/core/agent/ask-context";
import type { ColumnProfile, TableProfile } from "../src/core/types";
import type { Relationship } from "../src/core/types/discovery";

function rel(
  fromTable: string,
  fromCol: string,
  toTable: string,
  toCol: string,
  cardinality: Relationship["cardinality"] = "many-to-one"
): Relationship {
  return {
    from: { table: fromTable, column: fromCol },
    to: { table: toTable, column: toCol },
    confidence: 100,
    cardinality,
    signals: { valueOverlap: 1, nameSimilarity: 1, typeMatch: 1, cardinalityShape: 1 },
  };
}

function col(
  name: string,
  kind: ColumnProfile["kind"],
  opts: Partial<ColumnProfile> = {}
): ColumnProfile {
  return {
    name,
    type: "VARCHAR",
    kind,
    nullCount: 0,
    nullPercent: 0,
    distinctCount: null,
    min: null,
    max: null,
    avg: null,
    topValues: [],
    ...opts,
  };
}

function tableProfile(tableName: string, rowCount: number, columns: ColumnProfile[]): TableProfile {
  return { tableName, rowCount, columnCount: columns.length, generatedAt: 1, columns };
}

// `id` is a unique, non-null PK candidate; `created_at` a date; `plan` low-cardinality text.
const USERS_PROFILE = tableProfile("users", 10, [
  col("id", "numeric", { distinctCount: 10, nullPercent: 0 }),
  col("plan", "text", {
    distinctCount: 2,
    topValues: [
      { value: "free", count: 6 },
      { value: "paid", count: 4 },
    ],
  }),
  col("created_at", "date", { distinctCount: 9 }),
  // Unique + non-null but NOT a key: must still become a `sum` measure (not excluded as a PK).
  col("age", "numeric", { distinctCount: 10, nullPercent: 0 }),
]);

// `user_id` is a relationship endpoint (FK), so it must be excluded from measures.
const PAYMENTS_PROFILE = tableProfile("payments", 20, [
  col("id", "numeric", { distinctCount: 20, nullPercent: 0 }),
  col("user_id", "numeric", { distinctCount: 10, nullPercent: 0 }),
  col("amount", "numeric", { distinctCount: 18 }),
]);

test("entityName singularizes and PascalCases", () => {
  assert.equal(entityName("users"), "User");
  assert.equal(entityName("payments"), "Payment");
  assert.equal(entityName("order_items"), "OrderItem");
  assert.equal(entityName("companies"), "Company");
});

test("buildSemanticModel derives associations from relationships", () => {
  const model = buildSemanticModel(
    ["users", "payments", "events"],
    [rel("payments", "user_id", "users", "id"), rel("events", "user_id", "users", "id")],
    1
  );
  const byName = Object.fromEntries(model.entities.map((e) => [e.name, e]));

  assert.deepEqual(Object.keys(byName).sort(), ["Event", "Payment", "User"]);
  assert.deepEqual(byName.User.hasMany.sort(), ["Event", "Payment"]);
  assert.deepEqual(byName.Payment.belongsTo, ["User"]);
  assert.deepEqual(byName.Event.belongsTo, ["User"]);
  assert.deepEqual(byName.User.belongsTo, []);
});

test("buildSemanticModel uses has_one for one-to-one", () => {
  const model = buildSemanticModel(
    ["users", "profiles"],
    [rel("profiles", "user_id", "users", "id", "one-to-one")],
    1
  );
  const user = model.entities.find((e) => e.name === "User")!;
  assert.deepEqual(user.hasOne, ["Profile"]);
  assert.deepEqual(user.hasMany, []);
});

test("entity name collisions are de-duplicated", () => {
  // "users" and "user" both singularize to "User".
  const model = buildSemanticModel(["users", "user"], [], 1);
  const names = model.entities.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, `names should be unique: ${names}`);
});

test("renderSemanticYaml emits entities with synonyms and associations", () => {
  const model = buildSemanticModel(
    ["users", "payments"],
    [rel("payments", "user_id", "users", "id")],
    1700000000000
  );
  const yaml = renderSemanticYaml(model);
  assert.match(yaml, /entities:/);
  assert.match(yaml, /- name: User\n {4}table: users\n {4}synonyms: \[users, user\]\n {4}has_many:\n {6}- Payment/);
  assert.match(yaml, /- name: Payment\n {4}table: payments\n {4}synonyms: \[payments, payment\]\n {4}belongs_to:\n {6}- User/);
});

// ---- Mechanical enrichment: dimensions, measures, synonyms ---------------------

test("buildSemanticModel derives dimensions and measures from profiles", () => {
  const model = buildSemanticModel(
    ["users", "payments"],
    [rel("payments", "user_id", "users", "id")],
    1,
    [USERS_PROFILE, PAYMENTS_PROFILE]
  );
  const byName = Object.fromEntries(model.entities.map((e) => [e.name, e]));

  // Dimensions: categorical (with values) + time, PK excluded.
  assert.deepEqual(byName.User.dimensions.find((d) => d.name === "plan"), {
    name: "plan",
    column: "plan",
    kind: "categorical",
    values: ["free", "paid"],
  });
  assert.ok(
    byName.User.dimensions.some((d) => d.name === "created_at" && d.kind === "time" && d.grain === "day")
  );
  assert.ok(!byName.User.dimensions.some((d) => d.column === "id"));

  // Measures: a row count + sums of numeric non-key columns.
  assert.ok(byName.User.measures.some((m) => m.name === "users_count" && m.agg === "count"));
  assert.ok(
    byName.User.measures.some((m) => m.name === "sum_age" && m.agg === "sum" && m.column === "age")
  );

  // Payments: both the PK (`id`) and the FK (`user_id`) are excluded from measures.
  assert.ok(!byName.Payment.measures.some((m) => m.column === "id"));
  assert.ok(!byName.Payment.measures.some((m) => m.column === "user_id"));
  assert.ok(byName.Payment.measures.some((m) => m.name === "sum_amount"));
});

test("buildSemanticModel derives synonyms from the table name", () => {
  const model = buildSemanticModel(["order_items"], [], 1);
  const entity = model.entities[0];
  assert.equal(entity.name, "OrderItem");
  assert.ok(entity.synonyms.includes("order_items"));
  assert.ok(entity.synonyms.includes("order items"));
  assert.ok(!entity.synonyms.includes("OrderItem"));
});

test("buildSemanticModel without profiles leaves dimensions/measures empty", () => {
  const model = buildSemanticModel(
    ["users", "payments"],
    [rel("payments", "user_id", "users", "id")],
    1
  );
  const user = model.entities.find((e) => e.name === "User")!;
  assert.deepEqual(user.dimensions, []);
  assert.deepEqual(user.measures, []);
});

test("renderSemanticYaml emits dimensions and measures as compact flow maps", () => {
  const yaml = renderSemanticYaml(buildSemanticModel(["users"], [], 1, [USERS_PROFILE]));
  assert.match(
    yaml,
    /dimensions:\n {6}- \{name: plan, column: plan, kind: categorical, values: \[free, paid\]\}/
  );
  assert.match(yaml, /- \{name: created_at, column: created_at, kind: time, grain: day\}/);
  assert.match(yaml, /measures:\n {6}- \{name: users_count, agg: count\}/);
  assert.match(yaml, /- \{name: sum_age, agg: sum, column: age\}/);
});

test("buildAskContext surfaces dimensions and measures for grounding", () => {
  const model = buildSemanticModel(["users"], [], 1, [USERS_PROFILE]);
  const context = buildAskContext({
    tables: [{ name: "users", columns: [{ name: "plan", type: "VARCHAR" }], rowCount: 10 }],
    relationships: [],
    semanticModel: model,
  });
  assert.match(context, /dimensions: .*plan \(categorical\)/);
  assert.match(context, /measures: .*users_count \(count\)/);
});

test("buildAskContext includes the business entities block", () => {
  const model = buildSemanticModel(
    ["users", "payments"],
    [rel("payments", "user_id", "users", "id")],
    1
  );
  const context = buildAskContext({
    tables: [
      { name: "users", columns: [{ name: "id", type: "BIGINT" }], rowCount: 5 },
      { name: "payments", columns: [{ name: "user_id", type: "BIGINT" }], rowCount: 8 },
    ],
    relationships: [rel("payments", "user_id", "users", "id")],
    semanticModel: model,
  });
  assert.match(context, /Business entities:/);
  assert.match(context, /User \(table users\) has_many Payment/);
});
