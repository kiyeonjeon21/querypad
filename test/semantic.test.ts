import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSemanticModel,
  entityName,
  renderSemanticYaml,
} from "../src/lib/discovery/semantic-model";
import { buildAskContext } from "../src/lib/agent/ask-context";
import type { Relationship } from "../src/types/discovery";

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

test("renderSemanticYaml emits entities with associations", () => {
  const model = buildSemanticModel(
    ["users", "payments"],
    [rel("payments", "user_id", "users", "id")],
    1700000000000
  );
  const yaml = renderSemanticYaml(model);
  assert.match(yaml, /entities:/);
  assert.match(yaml, /- name: User\n {4}table: users\n {4}has_many:\n {6}- Payment/);
  assert.match(yaml, /- name: Payment\n {4}table: payments\n {4}belongs_to:\n {6}- User/);
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
