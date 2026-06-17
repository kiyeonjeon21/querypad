import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  cardinalityShapeScore,
  confidence,
  isTypeCompatible,
  nameSimilarity,
  singularize,
  splitTokens,
  typeMatchScore,
} from "../src/lib/discovery/signals";
import { discoverRelationships, relationshipKey } from "../src/lib/discovery/relationships";
import { createNodeDb } from "../src/lib/duckdb-node/connection";
import { loadFolder } from "../src/lib/duckdb-node/load";
import { profileTable } from "../src/lib/duckdb-node/profile";

// ---- Pure signal unit tests ---------------------------------------------------

test("relationshipKey is directional and stable", () => {
  const forward = relationshipKey({
    from: { table: "payments", column: "user_id" },
    to: { table: "users", column: "id" },
    confidence: 100,
    cardinality: "many-to-one",
    signals: { valueOverlap: 1, nameSimilarity: 1, typeMatch: 1, cardinalityShape: 1 },
  });
  const reversed = relationshipKey({
    from: { table: "users", column: "id" },
    to: { table: "payments", column: "user_id" },
    confidence: 100,
    cardinality: "many-to-one",
    signals: { valueOverlap: 1, nameSimilarity: 1, typeMatch: 1, cardinalityShape: 1 },
  });
  assert.equal(forward, "payments.user_id->users.id");
  assert.notEqual(forward, reversed);
});

test("splitTokens handles snake_case and camelCase", () => {
  assert.deepEqual(splitTokens("user_id"), ["user", "id"]);
  assert.deepEqual(splitTokens("customerId"), ["customer", "id"]);
});

test("singularize covers common plural forms", () => {
  assert.equal(singularize("users"), "user");
  assert.equal(singularize("companies"), "company");
  assert.equal(singularize("addresses"), "address");
});

test("nameSimilarity rewards canonical FK conventions", () => {
  // events.user_id ↳ users.id
  assert.equal(nameSimilarity("user_id", "id", "users"), 1);
  // payments.customer_id ↳ subscriptions.customer_id
  assert.equal(nameSimilarity("customer_id", "customer_id", "subscriptions"), 1);
});

test("nameSimilarity stays weak for bare surrogate ids", () => {
  // events.id vs payments.id — only the shared "id" token
  assert.ok(nameSimilarity("id", "id", "payments") < 0.6);
  // payments.user_id vs events.id — wrong table reference
  assert.ok(nameSimilarity("user_id", "id", "events") < 0.6);
});

test("type compatibility and match scoring", () => {
  assert.ok(isTypeCompatible("numeric", "numeric"));
  assert.ok(isTypeCompatible("numeric", "text"));
  assert.ok(!isTypeCompatible("numeric", "date"));
  assert.equal(typeMatchScore("BIGINT", "BIGINT", "numeric", "numeric"), 1);
  assert.equal(typeMatchScore("INTEGER", "BIGINT", "numeric", "numeric"), 0.85);
});

test("cardinality shape distinguishes many-to-one from one-to-one", () => {
  assert.equal(cardinalityShapeScore(true, false), 1);
  assert.equal(cardinalityShapeScore(true, true), 0.8);
  assert.equal(cardinalityShapeScore(false, false), 0);
});

test("confidence is 100 for a perfect FK and lower for a weak name", () => {
  assert.equal(
    confidence({ valueOverlap: 1, nameSimilarity: 1, typeMatch: 1, cardinalityShape: 1 }),
    100
  );
  const weakName = confidence({
    valueOverlap: 1,
    nameSimilarity: 0.33,
    typeMatch: 1,
    cardinalityShape: 1,
  });
  assert.ok(weakName < 90 && weakName > 50);
});

// ---- Engine integration test (real Node DuckDB over fixtures) ------------------

test("inspect fixtures yields exactly the two true relationships", async () => {
  const folder = path.resolve(process.cwd(), "fixtures/data");
  const db = await createNodeDb();
  try {
    const { tables } = await loadFolder(folder, db.runner);
    assert.equal(tables.length, 3);

    const now = 1_700_000_000_000;
    const profiles = [];
    for (const table of tables) {
      profiles.push(await profileTable(table, db.runner, now));
    }

    const relationships = await discoverRelationships(profiles, db.runner);
    const edges = relationships.map(
      (rel) => `${rel.from.table}.${rel.from.column}->${rel.to.table}.${rel.to.column}`
    );

    assert.deepEqual(
      new Set(edges),
      new Set(["payments.user_id->users.id", "events.user_id->users.id"])
    );
    for (const rel of relationships) {
      assert.equal(rel.confidence, 100);
      assert.equal(rel.cardinality, "many-to-one");
    }
    // No spurious edges into surrogate id columns of other tables.
    assert.ok(!edges.some((edge) => edge.endsWith("events.id")));
    assert.ok(!edges.some((edge) => edge.endsWith("payments.id")));
  } finally {
    db.close();
  }
});
